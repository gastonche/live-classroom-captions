// First-run download of the speech models (docs/v2-desktop.md). One-time, ~467 MB, asked
// for by the teacher (school networks and mobile data cost money). Downloads resume after
// interruptions, retry on network errors, and every file is checked against a pinned
// SHA-256 before it is used. Only the expected files are taken from the archive.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

const RELEASE: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models";

/// Parakeet TDT 0.6B v3 (int8). Checksum published by GitHub for the release asset.
const ARCHIVE: Download = Download {
    name: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2",
    size: 487_170_055,
    sha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf",
};
/// Silero voice detection v5. GitHub publishes no checksum for it; pinned from our verified copy.
const VAD: Download = Download {
    name: "silero_vad_v5.onnx",
    size: 2_313_101,
    sha256: "6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396",
};
pub const PARAKEET_DIR: &str = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
/// The files the app needs from the archive, with their checksums (identical to the copies
/// benchmarked in bench/, and to the Hugging Face mirror's published hashes).
const EXTRACT: [(&str, u64, &str); 4] = [
    ("encoder.int8.onnx", 652_184_281, "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247"),
    ("decoder.int8.onnx", 11_845_275, "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e"),
    ("joiner.int8.onnx", 6_355_277, "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3"),
    ("tokens.txt", 93_939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"),
];

struct Download {
    name: &'static str,
    size: u64,
    sha256: &'static str,
}

/// Total bytes a first-run setup downloads.
pub const TOTAL_BYTES: u64 = ARCHIVE.size + VAD.size;

#[derive(Serialize, Clone, Debug)]
pub struct Progress {
    /// "download", "verify", "unpack", "done", "error" or "cancelled"
    pub stage: &'static str,
    pub done: u64,
    pub total: u64,
    pub detail: String,
}

/// True when every model file is in place with the right size (the full checksum check runs
/// once, after download, and is recorded by the marker file).
pub fn ready(dir: &Path) -> bool {
    let d = dir.join(PARAKEET_DIR);
    dir.join(".verified").exists()
        && size_of(&dir.join(VAD.name)) == Some(VAD.size)
        && EXTRACT.iter().all(|(f, size, _)| size_of(&d.join(f)) == Some(*size))
}

/// Same, for a folder filled by hand or by the benchmark (no marker needed): sizes only.
pub fn present(dir: &Path) -> bool {
    let d = dir.join(PARAKEET_DIR);
    size_of(&dir.join(VAD.name)) == Some(VAD.size) && EXTRACT.iter().all(|(f, size, _)| size_of(&d.join(f)) == Some(*size))
}

fn size_of(p: &Path) -> Option<u64> {
    fs::metadata(p).ok().map(|m| m.len())
}

/// Downloads, verifies and unpacks everything into `dir`. Blocking: run it on its own thread.
pub fn install(dir: &Path, cancel: &AtomicBool, progress: &dyn Fn(Progress)) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let report = |stage, done, detail: String| progress(Progress { stage, done, total: TOTAL_BYTES, detail });

    // 1. The small voice-detection model, then the archive. Both resumable.
    let vad = dir.join(VAD.name);
    if !(size_of(&vad) == Some(VAD.size) && sha256_file(&vad)? == VAD.sha256) {
        fetch(&VAD, &vad, 0, cancel, &|n| report("download", n, VAD.name.into()))?;
    }
    let archive = dir.join(ARCHIVE.name);
    let d = dir.join(PARAKEET_DIR);
    let extracted_ok = EXTRACT.iter().all(|(f, size, _)| size_of(&d.join(f)) == Some(*size));
    if !extracted_ok {
        fetch(&ARCHIVE, &archive, VAD.size, cancel, &|n| report("download", n, ARCHIVE.name.into()))?;

        // 2. Unpack only the expected files, then check each one.
        report("unpack", TOTAL_BYTES, "unpacking".into());
        unpack(&archive, &d, cancel)?;
    }
    report("verify", TOTAL_BYTES, "checking files".into());
    for (f, size, sha) in EXTRACT {
        let p = d.join(f);
        if size_of(&p) != Some(size) || sha256_file(&p)? != sha {
            let _ = fs::remove_file(&p);
            return Err(format!("{f} failed its integrity check; it will be downloaded again"));
        }
    }
    let _ = fs::remove_file(&archive); // 465 MB no longer needed
    fs::write(dir.join(".verified"), "ok\n").map_err(|e| e.to_string())?;
    report("done", TOTAL_BYTES, String::new());
    Ok(())
}

/// Downloads `what` to `dest` (via dest.part) in CHUNK-sized ranges, so a slow link only
/// has to move one chunk per request, and a partial file resumes where it stopped. Gives up
/// only after MAX_STALLS failures in a row with no progress. `offset` shifts the reported
/// progress (bytes of earlier downloads).
const CHUNK: u64 = 8 * 1024 * 1024;
const MAX_STALLS: u32 = 8;

fn fetch(what: &Download, dest: &Path, offset: u64, cancel: &AtomicBool, progress: &dyn Fn(u64)) -> Result<(), String> {
    let part = dest.with_extension(format!("{}.part", dest.extension().and_then(|e| e.to_str()).unwrap_or("")));
    let url = format!("{RELEASE}/{}", what.name);
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        // Per chunk: 8 MB in 3 minutes is ~45 KB/s, slower than any usable school link.
        .timeout_recv_body(Some(Duration::from_secs(180)))
        .build()
        .into();
    let mut stalls = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let have = size_of(&part).unwrap_or(0);
        if have > what.size {
            let _ = fs::remove_file(&part); // corrupt: start over
            continue;
        }
        if have == what.size {
            break;
        }
        let end = (have + CHUNK).min(what.size) - 1;
        match fetch_range(&agent, &url, &part, have, end, offset, cancel, progress) {
            Ok(()) => stalls = 0,
            Err(e) if e == "cancelled" => return Err(e),
            Err(e) => {
                let progressed = size_of(&part).unwrap_or(0) > have;
                stalls = if progressed { 0 } else { stalls + 1 };
                if stalls >= MAX_STALLS {
                    return Err(format!("download failed: {e}"));
                }
                thread::sleep(Duration::from_secs((2u64 << stalls.min(4)).min(30)));
            }
        }
    }
    let got = sha256_file(&part)?;
    if got != what.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!("{} failed its integrity check (got {}); it will be downloaded again", what.name, &got[..12]));
    }
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Appends bytes `start..=end` of `url` to `part`.
#[allow(clippy::too_many_arguments)]
fn fetch_range(
    agent: &ureq::Agent,
    url: &str,
    part: &Path,
    start: u64,
    end: u64,
    offset: u64,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64),
) -> Result<(), String> {
    let resp = agent.get(url).header("Range", &format!("bytes={start}-{end}")).call().map_err(|e| e.to_string())?;
    if resp.status() != 206 {
        return Err(format!("server didn't send a range (HTTP {})", resp.status()));
    }
    let want = end - start + 1;
    let mut file = OpenOptions::new().create(true).append(true).open(part).map_err(|e| e.to_string())?;
    let mut body = resp.into_body();
    let mut reader = body.with_config().limit(want).reader();
    let mut buf = vec![0u8; 256 * 1024];
    let (mut got, mut last) = (0u64, Instant::now());
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        if last.elapsed() >= Duration::from_millis(250) {
            last = Instant::now();
            progress(offset + start + got);
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    progress(offset + start + got);
    if got != want {
        return Err(format!("chunk incomplete: {got} of {want} bytes"));
    }
    Ok(())
}

/// Takes only the files in EXTRACT from the archive's model folder, writing each into `out`.
/// Nothing else (and no path from the archive) is ever written.
fn unpack(archive: &Path, out: &Path, cancel: &AtomicBool) -> Result<(), String> {
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let f = File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(io::BufReader::new(f)));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let Some(name) = wanted(&path) else { continue };
        let tmp = out.join(format!("{name}.tmp"));
        let mut w = File::create(&tmp).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
        fs::rename(&tmp, out.join(name)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// "<PARAKEET_DIR>/<one of EXTRACT>" → that file name; anything else → None.
fn wanted(path: &Path) -> Option<&'static str> {
    let mut parts = path.components().map(|c| c.as_os_str().to_string_lossy().into_owned());
    let (dir, file, rest) = (parts.next()?, parts.next()?, parts.next());
    if dir != PARAKEET_DIR || rest.is_some() {
        return None;
    }
    EXTRACT.iter().find(|(f, _, _)| *f == file).map(|(f, _, _)| *f)
}

pub fn sha256_file(p: &Path) -> Result<String, String> {
    let mut f = File::open(p).map_err(|e| format!("{}: {e}", p.display()))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Runs `install` on a background thread; `cancel` stops it at the next chunk.
pub fn spawn_install(dir: PathBuf, cancel: Arc<AtomicBool>, progress: impl Fn(Progress) + Send + 'static) {
    thread::spawn(move || {
        let res = install(&dir, &cancel, &progress);
        if let Err(e) = res {
            let stage = if e == "cancelled" { "cancelled" } else { "error" };
            progress(Progress { stage, done: 0, total: TOTAL_BYTES, detail: e });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_expected_files_are_taken_from_the_archive() {
        assert_eq!(wanted(Path::new("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/encoder.int8.onnx")), Some("encoder.int8.onnx"));
        assert_eq!(wanted(Path::new("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/test_wavs/en.wav")), None);
        assert_eq!(wanted(Path::new("other-dir/encoder.int8.onnx")), None);
        assert_eq!(wanted(Path::new("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/../../etc/passwd")), None);
        assert_eq!(wanted(Path::new("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/README.md")), None);
    }

    #[test]
    fn sha256_matches_a_known_value() {
        let p = std::env::temp_dir().join("lcc-sha-test.txt");
        fs::write(&p, "abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = fs::remove_file(p);
    }

    /// Real download from GitHub into a fresh folder, interrupted after 4 s and resumed.
    /// Downloads ~465 MB: cargo test --release -- --ignored real_install --nocapture
    #[test]
    #[ignore]
    fn real_install_resumes_after_interruption_and_verifies() {
        let dir = std::env::temp_dir().join("lcc-models-install-test");
        let _ = fs::remove_dir_all(&dir);
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(4));
            c.store(true, Ordering::SeqCst);
        });
        let first = install(&dir, &cancel, &|_| {});
        assert_eq!(first, Err("cancelled".into()));
        let partial = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).map(|e| e.metadata().unwrap().len()).sum::<u64>();
        println!("after interruption: {partial} bytes on disk");
        assert!(partial > 0, "nothing was kept for resuming");

        cancel.store(false, Ordering::SeqCst);
        let t = Instant::now();
        let resumed_from = std::sync::Mutex::new(None::<u64>);
        install(&dir, &cancel, &|p| {
            let mut r = resumed_from.lock().unwrap();
            if r.is_none() && p.stage == "download" {
                *r = Some(p.done);
            }
        })
        .unwrap_or_else(|e| panic!("install failed: {e}"));
        println!("resumed at {:?} bytes, finished in {:.0}s", resumed_from.lock().unwrap(), t.elapsed().as_secs_f32());
        assert!(ready(&dir));
        assert!(!dir.join(ARCHIVE.name).exists(), "archive should be removed after unpacking");
        let _ = fs::remove_dir_all(&dir);
    }

    /// The benchmark's models (downloaded from the same release) pass the pinned checks.
    #[test]
    #[ignore]
    fn benchmark_models_match_pinned_checksums() {
        let dir = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../bench/models"));
        assert!(present(&dir));
        assert_eq!(sha256_file(&dir.join(VAD.name)).unwrap(), VAD.sha256);
        for (f, _, sha) in EXTRACT {
            assert_eq!(sha256_file(&dir.join(PARAKEET_DIR).join(f)).unwrap(), sha, "{f}");
        }
    }
}
