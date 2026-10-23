// Local speech recognition (docs/v2-desktop.md): microphone → 16 kHz → voice detection
// (Silero) → Parakeet. While someone speaks, the growing sentence is re-recognised every
// INTERIM_EVERY for grey in-progress words; when voice detection closes the sentence, the
// exact segment (plus PREROLL before it) is recognised once more for the final text.
//
// "No missing words": capture never stops during a lesson, every captured sample goes
// through voice detection, and counters (captured vs processed) prove it.
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use sherpa_onnx::{
    LinearResampler, OfflineRecognizer, OfflineRecognizerConfig, SileroVadModelConfig, VadModelConfig,
    VoiceActivityDetector,
};

pub const RATE: i32 = 16_000;
const WINDOW: usize = 512; // Silero's window at 16 kHz
const PREROLL: usize = RATE as usize * 3 / 10; // 300 ms before a segment: never clip a first word
const HISTORY: usize = RATE as usize * 60; // last 60 s, enough for any segment
const INTERIM_EVERY: Duration = Duration::from_millis(700);
const MIN_INTERIM: usize = RATE as usize * 6 / 10; // don't bother before 0.6 s of speech

/// Events to the overlay page. Text is raw: the page applies the word lists.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AsrEvent {
    Interim { text: String },
    Final { text: String },
    State { state: &'static str, detail: String },
    Stats(Stats),
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Stats {
    /// Samples captured at 16 kHz-equivalent, and samples run through voice detection.
    pub captured: u64,
    pub processed: u64,
    /// Samples waiting between capture and processing (should stay near 0).
    pub backlog: u64,
    pub segments: u64,
    /// Recognition time / audio time for final decodes (below 1 = faster than real time).
    pub rtf: f32,
    /// Microphone level, 0..1 (RMS of the last chunk), so the app can show "the mic hears you".
    pub level: f32,
    pub device: String,
}

pub struct Models {
    pub dir: PathBuf,
    pub threads: i32,
}

impl Models {
    fn parakeet(&self) -> PathBuf {
        self.dir.join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8")
    }
    fn vad(&self) -> PathBuf {
        self.dir.join("silero_vad_v5.onnx")
    }
    pub fn missing(&self) -> Vec<String> {
        let mut m = Vec::new();
        for f in ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"] {
            if !self.parakeet().join(f).exists() {
                m.push(format!("parakeet/{f}"));
            }
        }
        if !self.vad().exists() {
            m.push("silero_vad_v5.onnx".into());
        }
        m
    }
}

pub fn recognizer(models: &Models) -> Option<OfflineRecognizer> {
    let d = models.parakeet();
    let p = |f: &str| Some(d.join(f).to_string_lossy().into_owned());
    let mut c = OfflineRecognizerConfig::default();
    c.model_config.transducer.encoder = p("encoder.int8.onnx");
    c.model_config.transducer.decoder = p("decoder.int8.onnx");
    c.model_config.transducer.joiner = p("joiner.int8.onnx");
    c.model_config.tokens = p("tokens.txt");
    c.model_config.model_type = Some("nemo_transducer".into());
    c.model_config.num_threads = models.threads;
    OfflineRecognizer::create(&c)
}

fn vad(models: &Models) -> Option<VoiceActivityDetector> {
    let mut c = VadModelConfig::default();
    c.silero_vad = SileroVadModelConfig {
        model: Some(models.vad().to_string_lossy().into_owned()),
        threshold: 0.5,
        min_silence_duration: 0.6, // hangover: a short pause doesn't end the sentence or cut a word
        min_speech_duration: 0.25,
        window_size: WINDOW as i32,
        max_speech_duration: 15.0, // long monologues are still finalised every 15 s at most
    };
    c.sample_rate = RATE;
    c.num_threads = 1;
    VoiceActivityDetector::create(&c, 120.0)
}

fn decode(rec: &OfflineRecognizer, samples: &[f32]) -> String {
    let s = rec.create_stream();
    s.accept_waveform(RATE, samples);
    rec.decode(&s);
    s.get_result().map(|r| r.text.trim().to_string()).unwrap_or_default()
}

/// Rolling 16 kHz audio with absolute sample positions, so a segment reported by voice
/// detection (by its start index) can be cut out exactly, with pre-roll.
pub struct History {
    buf: VecDeque<f32>,
    start: u64, // absolute index of buf[0]
}

impl History {
    pub fn new() -> Self {
        Self { buf: VecDeque::with_capacity(HISTORY), start: 0 }
    }
    pub fn push(&mut self, s: &[f32]) {
        self.buf.extend(s.iter().copied());
        while self.buf.len() > HISTORY {
            self.buf.pop_front();
            self.start += 1;
        }
    }
    pub fn end(&self) -> u64 {
        self.start + self.buf.len() as u64
    }
    /// Samples in [from, to), clamped to what's still held.
    pub fn slice(&self, from: u64, to: u64) -> Vec<f32> {
        let a = from.max(self.start).min(self.end());
        let b = to.max(a).min(self.end());
        self.buf.range((a - self.start) as usize..(b - self.start) as usize).copied().collect()
    }
}

enum Cmd {
    Stop,
}

/// A running capture and recognition session. Dropping it (or `stop`) ends both threads.
pub struct Session {
    tx: Sender<Cmd>,
    capture_alive: Arc<AtomicBool>,
}

impl Session {
    pub fn stop(self) {
        let _ = self.tx.send(Cmd::Stop);
        self.capture_alive.store(false, Ordering::SeqCst);
    }
}

pub fn input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|it| it.filter_map(|d| d.description().ok().map(|x| x.name().to_string())).collect())
        .unwrap_or_default()
}

/// Starts recognising. `source` is a microphone name (empty = system default) or, for tests,
/// "file:/path.wav" (16 kHz mono 16-bit), played at real-time pace.
pub fn start(
    models: Models,
    source: String,
    emit: impl Fn(AsrEvent) + Send + Sync + 'static,
) -> Result<Session, String> {
    let missing = models.missing();
    if !missing.is_empty() {
        return Err(format!("speech models missing in {}: {}", models.dir.display(), missing.join(", ")));
    }
    let emit = Arc::new(emit);
    let (tx, rx) = mpsc::channel::<Cmd>();
    let (audio_tx, audio_rx) = mpsc::channel::<Vec<f32>>();
    let captured = Arc::new(AtomicU64::new(0));
    let alive = Arc::new(AtomicBool::new(true));
    let device_name = Arc::new(Mutex::new(String::new()));

    capture_thread(source, audio_tx, captured.clone(), alive.clone(), device_name.clone(), emit.clone());
    worker_thread(models, rx, audio_rx, captured, device_name, emit);
    Ok(Session { tx, capture_alive: alive })
}

/// Captures audio and sends it on as 16 kHz mono. If the device fails or disappears
/// (unplugged), it keeps retrying every 2 s until the session stops.
fn capture_thread(
    source: String,
    audio_tx: Sender<Vec<f32>>,
    captured: Arc<AtomicU64>,
    alive: Arc<AtomicBool>,
    device_name: Arc<Mutex<String>>,
    emit: Arc<dyn Fn(AsrEvent) + Send + Sync>,
) {
    thread::spawn(move || {
        if let Some(path) = source.strip_prefix("file:") {
            *device_name.lock().unwrap() = format!("test file {path}");
            play_file(Path::new(path), &audio_tx, &captured, &alive, &emit, true);
            return;
        }
        if let Some(path) = source.strip_prefix("filefast:") {
            *device_name.lock().unwrap() = format!("test file {path}");
            play_file(Path::new(path), &audio_tx, &captured, &alive, &emit, false);
            return;
        }
        while alive.load(Ordering::SeqCst) {
            match open_mic(&source, audio_tx.clone(), captured.clone()) {
                Ok((stream, name, failed)) => {
                    *device_name.lock().unwrap() = name.clone();
                    emit(AsrEvent::State { state: "listening", detail: name });
                    // The stream lives on this thread (it isn't Send on every platform).
                    while alive.load(Ordering::SeqCst) && !failed.load(Ordering::SeqCst) {
                        thread::sleep(Duration::from_millis(200));
                    }
                    drop(stream);
                    if alive.load(Ordering::SeqCst) {
                        emit(AsrEvent::State { state: "error", detail: "microphone stopped; retrying".into() });
                    }
                }
                Err(e) => emit(AsrEvent::State { state: "error", detail: e }),
            }
            // Back off before reopening, still responsive to stop.
            for _ in 0..10 {
                if !alive.load(Ordering::SeqCst) {
                    break;
                }
                thread::sleep(Duration::from_millis(200));
            }
        }
    });
}

type MicStream = (cpal::Stream, String, Arc<AtomicBool>);

fn open_mic(wanted: &str, audio_tx: Sender<Vec<f32>>, captured: Arc<AtomicU64>) -> Result<MicStream, String> {
    let host = cpal::default_host();
    let device = if wanted.is_empty() {
        host.default_input_device()
    } else {
        host.input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.description().map(|x| x.name() == wanted).unwrap_or(false))
            .or_else(|| host.default_input_device())
    }
    .ok_or("no microphone found")?;
    let name = device.description().map(|x| x.name().to_string()).unwrap_or_else(|_| "microphone".into());
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let format = supported.sample_format();
    let config = supported.config();
    let resampler = Arc::new(Mutex::new(LinearResampler::create(rate as i32, RATE).ok_or("resampler")?));
    let failed = Arc::new(AtomicBool::new(false));

    // Downmix to mono, resample to 16 kHz, hand off. Never blocks the audio thread for long.
    let push = {
        let failed = failed.clone();
        move |mono: Vec<f32>| {
            let out = resampler.lock().unwrap().resample(&mono, false);
            captured.fetch_add(out.len() as u64, Ordering::Relaxed);
            if audio_tx.send(out).is_err() {
                failed.store(true, Ordering::SeqCst);
            }
        }
    };
    let on_err = {
        let failed = failed.clone();
        move |_e: cpal::Error| failed.store(true, Ordering::SeqCst)
    };
    let stream = match format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config,
            move |d: &[f32], _: &cpal::InputCallbackInfo| push(downmix(d, channels, |x| x)),
            on_err,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            config,
            move |d: &[i16], _: &cpal::InputCallbackInfo| push(downmix(d, channels, |x| x as f32 / 32768.0)),
            on_err,
            None,
        ),
        cpal::SampleFormat::I32 => device.build_input_stream(
            config,
            move |d: &[i32], _: &cpal::InputCallbackInfo| push(downmix(d, channels, |x| x as f32 / 2_147_483_648.0)),
            on_err,
            None,
        ),
        other => return Err(format!("unsupported microphone format {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, name, failed))
}

fn downmix<T: Copy>(data: &[T], channels: usize, f: impl Fn(T) -> f32) -> Vec<f32> {
    if channels <= 1 {
        return data.iter().map(|&x| f(x)).collect();
    }
    data.chunks(channels).map(|c| c.iter().map(|&x| f(x)).sum::<f32>() / channels as f32).collect()
}

/// Test source: a 16 kHz mono WAV, fed in 100 ms chunks at real-time pace.
fn play_file(
    path: &Path,
    audio_tx: &Sender<Vec<f32>>,
    captured: &AtomicU64,
    alive: &AtomicBool,
    emit: &Arc<dyn Fn(AsrEvent) + Send + Sync>,
    realtime: bool,
) {
    let samples = match read_wav16(path) {
        Ok(s) => s,
        Err(e) => {
            emit(AsrEvent::State { state: "error", detail: e });
            return;
        }
    };
    emit(AsrEvent::State { state: "listening", detail: format!("test file {}", path.display()) });
    let chunk = RATE as usize / 10;
    let t0 = Instant::now();
    for (i, c) in samples.chunks(chunk).enumerate() {
        if !alive.load(Ordering::SeqCst) {
            return;
        }
        captured.fetch_add(c.len() as u64, Ordering::Relaxed);
        if audio_tx.send(c.to_vec()).is_err() {
            return;
        }
        let due = Duration::from_millis(100 * (i as u64 + 1));
        if let Some(wait) = due.checked_sub(t0.elapsed()).filter(|_| realtime) {
            thread::sleep(wait);
        }
    }
    // Two seconds of silence so the last sentence closes.
    let silence = vec![0.0; RATE as usize * 2];
    captured.fetch_add(silence.len() as u64, Ordering::Relaxed);
    let _ = audio_tx.send(silence);
}

pub fn read_wav16(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    // Minimal RIFF reader: find "fmt " and "data" chunks.
    let mut i = 12;
    let (mut ok, mut data) = (false, None);
    while i + 8 <= bytes.len() {
        let id = &bytes[i..i + 4];
        let len = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().unwrap()) as usize;
        let body = &bytes[i + 8..(i + 8 + len).min(bytes.len())];
        if id == b"fmt " && body.len() >= 16 {
            let ch = u16::from_le_bytes([body[2], body[3]]);
            let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            let bits = u16::from_le_bytes([body[14], body[15]]);
            ok = ch == 1 && rate == RATE as u32 && bits == 16;
        } else if id == b"data" {
            data = Some(body);
        }
        i += 8 + len + (len & 1);
    }
    if !ok {
        return Err("test file must be 16 kHz mono 16-bit WAV".into());
    }
    let d = data.ok_or("no audio data")?;
    Ok(d.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect())
}

fn worker_thread(
    models: Models,
    rx: Receiver<Cmd>,
    audio_rx: Receiver<Vec<f32>>,
    captured: Arc<AtomicU64>,
    device_name: Arc<Mutex<String>>,
    emit: Arc<dyn Fn(AsrEvent) + Send + Sync>,
) {
    thread::spawn(move || {
        let (Some(rec), Some(vad)) = (recognizer(&models), vad(&models)) else {
            emit(AsrEvent::State { state: "error", detail: "could not load the speech models".into() });
            return;
        };
        let mut hist = History::new();
        let mut pending: Vec<f32> = Vec::new(); // samples not yet a full VAD window
        let mut processed: u64 = 0;
        let mut speech_from: Option<u64> = None; // absolute start of the sentence in progress
        let mut last_interim = Instant::now();
        // Refresh the grey text less often on a slow computer instead of falling behind.
        let mut interim_every = INTERIM_EVERY;
        let mut last_text = String::new();
        let (mut segs, mut dec_time, mut dec_audio) = (0u64, 0f64, 0f64);
        let mut last_stats = Instant::now();
        let mut level = 0f32;

        loop {
            if let Ok(Cmd::Stop) = rx.try_recv() {
                break;
            }
            let chunk = match audio_rx.recv_timeout(Duration::from_millis(200)) {
                Ok(c) => c,
                Err(RecvTimeoutError::Timeout) => Vec::new(),
                Err(RecvTimeoutError::Disconnected) => break,
            };
            if !chunk.is_empty() {
                level = (chunk.iter().map(|x| x * x).sum::<f32>() / chunk.len() as f32).sqrt();
                hist.push(&chunk);
                pending.extend_from_slice(&chunk);
            }
            // Every sample goes through voice detection, in whole windows.
            let whole = pending.len() / WINDOW * WINDOW;
            for w in pending[..whole].chunks(WINDOW) {
                vad.accept_waveform(w);
            }
            processed += whole as u64;
            pending.drain(..whole);

            // Sentence in progress: remember where it started; refresh the grey text.
            if vad.detected() {
                let now = hist.end();
                let from = *speech_from.get_or_insert(now.saturating_sub(PREROLL as u64 + RATE as u64 / 2));
                if last_interim.elapsed() >= interim_every && now - from >= MIN_INTERIM as u64 {
                    let t = Instant::now();
                    let text = decode(&rec, &hist.slice(from, now));
                    interim_every = INTERIM_EVERY.max(t.elapsed() * 5 / 2);
                    last_interim = Instant::now();
                    if !text.is_empty() && text != last_text {
                        last_text = text.clone();
                        emit(AsrEvent::Interim { text });
                    }
                }
            }

            // Finished sentences: recognise exactly that audio (plus pre-roll), once.
            while let Some(seg) = vad.front() {
                // Voice detection and history both count samples from 0, so this is absolute.
                let start = seg.start().max(0) as u64;
                let from = start.saturating_sub(PREROLL as u64);
                let audio = hist.slice(from, start + seg.n() as u64);
                vad.pop();
                let t = Instant::now();
                let text = decode(&rec, &audio);
                dec_time += t.elapsed().as_secs_f64();
                dec_audio += audio.len() as f64 / RATE as f64;
                segs += 1;
                speech_from = None;
                last_text.clear();
                if !text.is_empty() {
                    emit(AsrEvent::Final { text });
                } else {
                    emit(AsrEvent::Interim { text: String::new() });
                }
            }

            if last_stats.elapsed() >= Duration::from_secs(2) {
                last_stats = Instant::now();
                let cap = captured.load(Ordering::Relaxed);
                emit(AsrEvent::Stats(Stats {
                    captured: cap,
                    processed,
                    backlog: cap.saturating_sub(processed + pending.len() as u64),
                    segments: segs,
                    rtf: if dec_audio > 0.0 { (dec_time / dec_audio) as f32 } else { 0.0 },
                    level,
                    device: device_name.lock().unwrap().clone(),
                }));
            }
        }
        // Stopping: close the last sentence so its words aren't lost.
        if !pending.is_empty() {
            vad.accept_waveform(&pending);
        }
        vad.flush();
        while let Some(seg) = vad.front() {
            let start = seg.start().max(0) as u64;
            let audio = hist.slice(start.saturating_sub(PREROLL as u64), start + seg.n() as u64);
            vad.pop();
            let text = decode(&rec, &audio);
            if !text.is_empty() {
                emit(AsrEvent::Final { text });
            }
        }
        emit(AsrEvent::State { state: "idle", detail: String::new() });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_slices_by_absolute_position_and_clamps() {
        let mut h = History::new();
        h.push(&[1.0, 2.0, 3.0]);
        h.push(&[4.0, 5.0]);
        assert_eq!(h.end(), 5);
        assert_eq!(h.slice(1, 4), vec![2.0, 3.0, 4.0]);
        assert_eq!(h.slice(3, 99), vec![4.0, 5.0]);
        assert!(h.slice(9, 12).is_empty());
    }

    #[test]
    fn history_drops_oldest_beyond_capacity_but_keeps_positions() {
        let mut h = History::new();
        h.push(&vec![0.0; HISTORY]);
        h.push(&[7.0, 8.0]);
        assert_eq!(h.end(), HISTORY as u64 + 2);
        assert_eq!(h.slice(HISTORY as u64, HISTORY as u64 + 2), vec![7.0, 8.0]);
        assert_eq!(h.slice(0, 1).len(), 0); // long gone
    }

    /// Whole pipeline on a benchmark recording (needs the models: bench/README.md).
    /// cargo test --release -- --ignored --nocapture
    #[test]
    #[ignore]
    fn pipeline_recognises_a_benchmark_recording() {
        let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../bench"));
        let wav = root.join("data/synthetic/prog-en-samantha.wav");
        let (tx, rx) = mpsc::channel();
        let threads = 2;
        let t0 = Instant::now();
        let session = start(Models { dir: root.join("models"), threads }, format!("filefast:{}", wav.display()), move |e| {
            let _ = tx.send(e);
        })
        .expect("start");
        let (mut finals, mut interims, mut stats) = (Vec::new(), 0, None);
        while let Ok(e) = rx.recv_timeout(Duration::from_secs(30)) {
            match e {
                AsrEvent::Final { text } => finals.push(text),
                AsrEvent::Interim { .. } => interims += 1,
                AsrEvent::Stats(s) => stats = Some(s),
                AsrEvent::State { state: "idle", .. } => break,
                AsrEvent::State { state: "error", detail } => panic!("{detail}"),
                _ => {}
            }
            if finals.join(" ").contains("regex") {
                break;
            }
        }
        session.stop();
        let text = finals.join(" ");
        println!("{:.1}s, {} finals, {interims} interims: {text}", t0.elapsed().as_secs_f32(), finals.len());
        if let Some(s) = stats {
            println!("captured {} processed {} backlog {} rtf {:.3}", s.captured, s.processed, s.backlog, s.rtf);
        }
        for w in ["JavaScript", "JSON", "GitHub", "Python", "tuple"] {
            assert!(text.contains(w), "missing {w:?} in {text}");
        }
    }

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0f32, 3.0, -1.0, 1.0], 2, |x| x), vec![2.0, 0.0]);
        assert_eq!(downmix(&[0.5f32], 1, |x| x), vec![0.5]);
    }
}
