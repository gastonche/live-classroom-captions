// Student phones over the school Wi-Fi, with no internet and no WebRTC: the app serves the
// student page itself and pushes captions over a WebSocket (ws://<laptop>:<port>/ws).
// Read-only: it serves the student page's own files, sends captions, and ignores anything
// phones send.
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::ops::RangeInclusive;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tungstenite::Message;

/// Looks up a bundled file by path ("lan/index.html", "assets/x.js"): bytes and MIME type.
pub type Assets = dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync;

const MAX_CLIENTS: usize = 300;
const HEARTBEAT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub struct Lan {
    clients: Arc<Mutex<Vec<Sender<String>>>>,
    /// The message a newly connected phone gets first: the session so far.
    snapshot: Arc<Mutex<String>>,
    pub port: u16,
}

impl Lan {
    /// Starts serving on the first free port in `ports`.
    pub fn start(assets: Arc<Assets>, ports: RangeInclusive<u16>) -> io::Result<Lan> {
        let mut last = io::Error::new(io::ErrorKind::AddrInUse, "no free port");
        for port in ports {
            match TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port)) {
                Ok(listener) => {
                    let lan = Lan { clients: Arc::default(), snapshot: Arc::default(), port: listener.local_addr()?.port() };
                    let me = lan.clone();
                    thread::spawn(move || {
                        for stream in listener.incoming().flatten() {
                            let (me, assets) = (me.clone(), assets.clone());
                            thread::spawn(move || {
                                let _ = me.handle(stream, assets.as_ref());
                            });
                        }
                    });
                    return Ok(lan);
                }
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    /// Sends a protocol message (JSON) to every connected phone.
    pub fn broadcast(&self, msg: &str) {
        self.clients.lock().unwrap().retain(|tx| tx.send(msg.to_string()).is_ok());
    }

    pub fn set_snapshot(&self, msg: String) {
        *self.snapshot.lock().unwrap() = msg;
    }

    pub fn clients(&self) -> usize {
        self.clients.lock().unwrap().len()
    }

    fn handle(&self, mut stream: TcpStream, assets: &Assets) -> io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        let head = peek_head(&stream)?;
        let req = Request::parse(&head).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "bad request"))?;
        if req.websocket && req.path == "/ws" {
            return self.serve_ws(stream);
        }
        // Not a WebSocket: consume the request we only peeked at, then answer it.
        let mut sink = vec![0u8; head.len()];
        stream.read_exact(&mut sink)?;
        if req.method != "GET" && req.method != "HEAD" {
            return respond(&mut stream, "405 Method Not Allowed", "text/plain", b"method not allowed", false);
        }
        match resolve(&req.path).and_then(|p| assets(&p)) {
            Some((bytes, mime)) => respond(&mut stream, "200 OK", &mime, &bytes, req.method == "HEAD"),
            None => respond(&mut stream, "404 Not Found", "text/plain", b"not found", false),
        }
    }

    fn serve_ws(&self, stream: TcpStream) -> io::Result<()> {
        let (tx, rx) = mpsc::channel::<String>();
        {
            let mut clients = self.clients.lock().unwrap();
            if clients.len() >= MAX_CLIENTS {
                return Ok(());
            }
            clients.push(tx);
        }
        stream.set_read_timeout(None)?;
        let mut ws = tungstenite::accept(stream).map_err(|e| io::Error::other(e.to_string()))?;
        let first = self.snapshot.lock().unwrap().clone();
        if !first.is_empty() && ws.send(Message::text(first)).is_err() {
            return Ok(());
        }
        // One writer per phone. A write that fails means the phone has gone: stop.
        loop {
            let msg = match rx.recv_timeout(HEARTBEAT) {
                Ok(m) => m,
                Err(RecvTimeoutError::Timeout) => r#"{"t":"ping","at":0}"#.to_string(),
                Err(RecvTimeoutError::Disconnected) => break,
            };
            if ws.send(Message::text(msg)).is_err() {
                break;
            }
        }
        let _ = ws.close(None);
        Ok(())
    }
}

/// Reads (without consuming) the request head, up to the blank line or 8 KB.
fn peek_head(stream: &TcpStream) -> io::Result<Vec<u8>> {
    let mut buf = vec![0u8; 8192];
    for _ in 0..50 {
        let n = stream.peek(&mut buf)?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        if let Some(end) = buf[..n].windows(4).position(|w| w == b"\r\n\r\n") {
            return Ok(buf[..end + 4].to_vec());
        }
        if n == buf.len() {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }
    Err(io::Error::new(io::ErrorKind::InvalidData, "request head too long or incomplete"))
}

#[derive(Debug, PartialEq)]
struct Request {
    method: String,
    path: String,
    websocket: bool,
}

impl Request {
    fn parse(head: &[u8]) -> Option<Request> {
        let text = std::str::from_utf8(head).ok()?;
        let mut lines = text.split("\r\n");
        let mut first = lines.next()?.split(' ');
        let (method, target) = (first.next()?.to_string(), first.next()?);
        let path = target.split(['?', '#']).next()?.to_string();
        let websocket = lines.any(|l| {
            let l = l.to_ascii_lowercase();
            l.starts_with("upgrade:") && l.contains("websocket")
        });
        Some(Request { method, path, websocket })
    }
}

/// Maps a request path to a bundled file. Only the student page and the files it uses are
/// served; anything with "..", or outside those folders, is refused.
fn resolve(path: &str) -> Option<String> {
    let p = path.trim_start_matches('/');
    if p.split('/').any(|seg| seg == ".." || seg == "." || seg.contains('\\')) {
        return None;
    }
    if p.is_empty() || p == "lan" || p == "lan/" {
        return Some("lan/index.html".into());
    }
    let ok = p.starts_with("lan/") || p.starts_with("assets/") || (!p.contains('/') && (p.ends_with(".png") || p.ends_with(".webmanifest")));
    ok.then(|| p.to_string())
}

fn respond(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8], head_only: bool) -> io::Result<()> {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes())?;
    if !head_only {
        stream.write_all(body)?;
    }
    stream.flush()
}

/// The laptop's address on the local network (what phones should open), if it has one.
pub fn local_ip() -> Option<IpAddr> {
    local_ip_address::local_ip().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    #[test]
    fn serves_only_the_student_page_and_its_files() {
        assert_eq!(resolve("/").as_deref(), Some("lan/index.html"));
        assert_eq!(resolve("/lan/").as_deref(), Some("lan/index.html"));
        assert_eq!(resolve("/assets/view-abc.js").as_deref(), Some("assets/view-abc.js"));
        assert_eq!(resolve("/favicon-32.png").as_deref(), Some("favicon-32.png"));
        assert_eq!(resolve("/overlay/index.html"), None);
        assert_eq!(resolve("/assets/../../etc/passwd"), None);
        assert_eq!(resolve("/lan/..%2f"), Some("lan/..%2f".into())); // not decoded: no such asset
        assert_eq!(resolve("/assets\\..\\x"), None);
    }

    #[test]
    fn parses_requests_and_websocket_upgrades() {
        let r = Request::parse(b"GET /ws?x=1 HTTP/1.1\r\nHost: a\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n").unwrap();
        assert_eq!(r, Request { method: "GET".into(), path: "/ws".into(), websocket: true });
        let r = Request::parse(b"GET / HTTP/1.1\r\nHost: a\r\n\r\n").unwrap();
        assert!(!r.websocket);
    }

    fn fake_assets() -> Arc<Assets> {
        Arc::new(|p: &str| match p {
            "lan/index.html" => Some((b"<h1>student</h1>".to_vec(), "text/html".into())),
            _ => None,
        })
    }

    #[test]
    fn http_and_websocket_end_to_end() {
        let lan = Lan::start(fake_assets(), 47300..=47399).expect("start");
        let addr = format!("127.0.0.1:{}", lan.port);

        // The student page over plain HTTP.
        let mut s = TcpStream::connect(&addr).unwrap();
        s.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut resp = String::new();
        s.read_to_string(&mut resp).unwrap();
        assert!(resp.starts_with("HTTP/1.1 200 OK"), "{resp}");
        assert!(resp.ends_with("<h1>student</h1>"));

        // Refused paths.
        let mut s = TcpStream::connect(&addr).unwrap();
        s.write_all(b"GET /overlay/index.html HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        let mut line = String::new();
        io::BufReader::new(s).read_line(&mut line).unwrap();
        assert!(line.starts_with("HTTP/1.1 404"));

        // A phone joins: it gets the snapshot first, then live captions.
        lan.set_snapshot(r#"{"t":"sync","text":"so far","live":true,"paused":false,"teacher":true}"#.into());
        let (mut ws, _) = tungstenite::connect(format!("ws://{addr}/ws")).unwrap();
        let first = ws.read().unwrap().into_text().unwrap();
        assert!(first.contains("so far"));
        for _ in 0..50 {
            if lan.clients() == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        lan.broadcast(r#"{"t":"f","id":0,"text":"hello","seq":1,"sid":"local"}"#);
        let next = ws.read().unwrap().into_text().unwrap();
        assert!(next.contains("hello"));

        // It leaves: the next broadcast drops it.
        ws.close(None).unwrap();
        drop(ws);
        thread::sleep(Duration::from_millis(100));
        for _ in 0..20 {
            lan.broadcast(r#"{"t":"ping","at":0}"#);
            if lan.clients() == 0 {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert_eq!(lan.clients(), 0);
    }
}
