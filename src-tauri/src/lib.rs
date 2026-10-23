// Caption overlay shell (docs/overlay.md). The web page in the window does the captions;
// this file makes the window an overlay (see-through, click-through, above everything,
// on every Space and full-screen app), puts it on the projector, and runs the menu-bar
// menu and global shortcuts. Menu and shortcut actions go to the page as "action" events.
mod asr;
mod models;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const WINDOW: &str = "overlay";

/// What the page tells us to show in the menu-bar menu (labels come from the page's EN/FR strings).
#[derive(Deserialize, Serialize, Default, Clone)]
struct MenuState {
    status: String,
    code: String,
    position: String,
    dodge: bool,
    hidden: bool,
    autostart: bool,
    monitor: String,
    monitors: Vec<String>,
    live: bool,
    paused: bool,
    lang: String,
    mic: String,
    mics: Vec<String>,
    models: String,
    labels: HashMap<String, String>,
}

struct Tray(Mutex<Option<TrayIcon<Wry>>>);
/// The menu's shape (everything but the status line) and its status item. Rebuilding a tray
/// menu makes it flicker or close (badly on Linux), so it's only rebuilt when its shape
/// changes; status text (download progress, room state) is updated in place.
struct MenuCache(Mutex<(String, Option<MenuItem<Wry>>)>);
struct Asr(Mutex<Option<asr::Session>>);

/// Where the speech models live: $CAPTIONS_MODELS, else the app's data folder (where the
/// first-run download puts them), else, during development, the benchmark's folder.
fn models_dir(app: &AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("CAPTIONS_MODELS") {
        return d.into();
    }
    let installed = app.path().app_data_dir().map(|d| d.join("models")).unwrap_or_else(|_| PathBuf::from("models"));
    let dev = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../bench/models"));
    if !models::ready(&installed) && models::present(&dev) {
        return dev;
    }
    installed
}

struct Install(Arc<AtomicBool>, Mutex<bool>);

#[tauri::command]
fn models_status(app: AppHandle) -> Value {
    let dir = models_dir(&app);
    let ready = models::ready(&dir) || models::present(&dir);
    json!({ "ready": ready, "installing": *app.state::<Install>().1.lock().unwrap(), "totalBytes": models::TOTAL_BYTES, "dir": dir })
}

/// Starts the one-time model download; progress arrives as "models" events.
#[tauri::command]
fn models_install(app: AppHandle) {
    let state = app.state::<Install>();
    let mut busy = state.1.lock().unwrap();
    if *busy {
        return;
    }
    *busy = true;
    state.0.store(false, Ordering::SeqCst);
    let dir = std::env::var("CAPTIONS_MODELS").map(PathBuf::from).unwrap_or_else(|_| {
        app.path().app_data_dir().map(|d| d.join("models")).unwrap_or_else(|_| PathBuf::from("models"))
    });
    eprintln!("[native] installing models into {}", dir.display());
    let emitter = app.clone();
    models::spawn_install(dir, state.0.clone(), move |p| {
        if matches!(p.stage, "done" | "error" | "cancelled") {
            eprintln!("[native] models {}: {}", p.stage, p.detail);
            *emitter.state::<Install>().1.lock().unwrap() = false;
        }
        let _ = emitter.emit_to(WINDOW, "models", p);
    });
}

#[tauri::command]
fn models_cancel(app: AppHandle) {
    app.state::<Install>().0.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn asr_devices() -> Vec<String> {
    asr::input_devices()
}

/// Starts listening on `mic` (empty = system default). $CAPTIONS_TEST_WAV replaces the mic
/// with a 16 kHz mono WAV played at real-time pace, for testing without speaking.
#[tauri::command]
fn asr_start(app: AppHandle, mic: String) -> Result<(), String> {
    let source = std::env::var("CAPTIONS_TEST_WAV").map(|p| format!("file:{p}")).unwrap_or(mic);
    // Half the cores, 1 to 4: leaves room for the lesson's own apps on modest machines.
    let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(1, 4) as i32).unwrap_or(2);
    let models = asr::Models { dir: models_dir(&app), threads };
    eprintln!("[native] asr start: source={source:?} models={} threads={threads}", models.dir.display());
    let emitter = app.clone();
    let session = asr::start(models, source, move |ev| {
        if let asr::AsrEvent::Final { text } = &ev {
            eprintln!("[native] final: {} words", text.split_whitespace().count());
        }
        let _ = emitter.emit_to(WINDOW, "asr", ev);
    })?;
    if let Some(old) = app.state::<Asr>().0.lock().unwrap().replace(session) {
        old.stop();
    }
    Ok(())
}

#[tauri::command]
fn asr_stop(app: AppHandle) {
    if let Some(s) = app.state::<Asr>().0.lock().unwrap().take() {
        s.stop();
    }
}

/// Saves a transcript to Documents/Captions and returns its path.
#[tauri::command]
fn save_transcript(app: AppHandle, name: String, text: String) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Captions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let path = dir.join(if safe.ends_with(".txt") { safe } else { format!("{safe}.txt") });
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    eprintln!("[native] transcript saved to {}", path.display());
    Ok(path.to_string_lossy().into_owned())
}

// Mac: Ctrl+Option+Cmd. Windows and Linux: Ctrl+Alt+Shift (Windows reserves many Win-key
// combinations for its own desktop shortcuts).
#[cfg(target_os = "macos")]
const MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT).union(Modifiers::SUPER);
#[cfg(not(target_os = "macos"))]
const MODS: Modifiers = Modifiers::CONTROL.union(Modifiers::ALT).union(Modifiers::SHIFT);
#[cfg(target_os = "macos")]
const MODS_LABEL: &str = "Ctrl+Alt+Cmd";
#[cfg(not(target_os = "macos"))]
const MODS_LABEL: &str = "Ctrl+Alt+Shift";

fn accel(key: &str) -> Option<String> {
    Some(format!("{MODS_LABEL}+{key}"))
}

fn shortcuts() -> [(Shortcut, &'static str); 5] {
    let m = MODS;
    [
        (Shortcut::new(Some(m), Code::KeyS), "start"),
        (Shortcut::new(Some(m), Code::KeyP), "pause"),
        (Shortcut::new(Some(m), Code::KeyC), "toggle-hide"),
        (Shortcut::new(Some(m), Code::ArrowUp), "pos-top"),
        (Shortcut::new(Some(m), Code::ArrowDown), "pos-bottom"),
    ]
}

/// Screens with names people recognise ("CASIO-PJ", "Built-in Retina Display").
fn named(window: &WebviewWindow) -> Vec<(String, tauri::Monitor)> {
    match window.available_monitors() {
        Ok(list) => list
            .into_iter()
            .enumerate()
            .map(|(i, m)| {
                let raw = m.name().cloned().unwrap_or_default();
                (friendly_name(&raw).unwrap_or_else(|| if raw.is_empty() { format!("Screen {}", i + 1) } else { raw }), m)
            })
            .collect(),
        Err(e) => {
            eprintln!("[native] available_monitors failed: {e}");
            Vec::new()
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGDisplayModelNumber(display: u32) -> u32;
}

/// Tauri names macOS screens "Monitor #<model number>"; NSScreen knows the real name.
/// Match each NSScreen's display id to that model number. (Two identical projector models
/// on one Mac would be ambiguous; the first wins.)
#[cfg(target_os = "macos")]
fn friendly_name(raw: &str) -> Option<String> {
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{MainThreadMarker, NSNumber, NSString};
    let model: u32 = raw.rsplit('#').next()?.trim().parse().ok()?;
    let mtm = MainThreadMarker::new()?; // sync commands and setup run on the main thread
    let key = NSString::from_str("NSScreenNumber");
    for s in NSScreen::screens(mtm).iter() {
        let desc = s.deviceDescription();
        let Some(n) = desc.objectForKey(&key) else { continue };
        let Some(id) = n.downcast_ref::<NSNumber>().map(|n| n.unsignedIntValue()) else { continue };
        // SAFETY: a plain CoreGraphics query on a display id macOS just gave us.
        if unsafe { CGDisplayModelNumber(id) } == model {
            return Some(s.localizedName().to_string());
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
fn friendly_name(_raw: &str) -> Option<String> {
    None
}

#[tauri::command]
fn monitors(window: WebviewWindow) -> Vec<String> {
    named(&window).into_iter().map(|(n, _)| n).collect()
}

/// Covers the chosen monitor: by name, else the first that isn't the main (built-in) one,
/// else the main one. Returns the name of the monitor used.
#[tauri::command]
fn place(window: WebviewWindow, monitor: String) -> String {
    let list = named(&window);
    // The main screen (with the menu bar) is the teacher's own; the projector is any other.
    let primary = window.primary_monitor().ok().flatten().map(|p| *p.position());
    let chosen = list
        .iter()
        .find(|(n, _)| !monitor.is_empty() && n == &monitor)
        .or_else(|| list.iter().find(|(_, m)| Some(*m.position()) != primary))
        .or_else(|| list.first());
    let Some((name, m)) = chosen else { return String::new() };
    // Screens can have different scales (2x Retina laptop, 1x projector). A monitor's
    // physical position is in its *own* scale, so convert with that scale to get points,
    // the units macOS uses for window frames across all screens.
    let f = m.scale_factor();
    let pos = tauri::LogicalPosition::new(m.position().x as f64 / f, m.position().y as f64 / f);
    let size = tauri::LogicalSize::new(m.size().width as f64 / f, m.size().height as f64 / f);
    let _ = window.set_position(pos);
    let _ = window.set_size(size);
    let (p, s) = (window.outer_position().ok(), window.outer_size().ok());
    eprintln!("[native] place on {name:?}: wanted {pos:?} {size:?} (scale {f}); window now at {p:?} size {s:?}");
    reassert(window);
    name.clone()
}

/// Pointer position inside the window in CSS pixels, or null when outside or unknown.
#[tauri::command]
fn cursor(window: WebviewWindow) -> Option<Value> {
    let c = window.cursor_position().ok()?;
    let p = window.outer_position().ok()?;
    let s = window.outer_size().ok()?;
    let f = window.scale_factor().ok()?;
    let (x, y) = (c.x - p.x as f64, c.y - p.y as f64);
    if x < 0.0 || y < 0.0 || x > s.width as f64 || y > s.height as f64 {
        return None;
    }
    Some(json!({ "x": x / f, "y": y / f }))
}

/// Puts the window back on top; some apps reorder windows when they activate or go full screen.
#[tauri::command]
fn reassert(window: WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || make_overlay(&w));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.set_always_on_top(true);
        let _ = window.set_ignore_cursor_events(true);
    }
}

/// One line from the page to the terminal, for support and smoke tests (never caption text).
#[tauri::command]
fn log(line: String) {
    eprintln!("[overlay] {line}");
}

#[tauri::command]
fn autostart(app: AppHandle, on: bool) -> bool {
    let a = app.autolaunch();
    let _ = if on { a.enable() } else { a.disable() };
    a.is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_menu(app: AppHandle, state: MenuState) {
    let shape = serde_json::to_string(&MenuState { status: String::new(), ..state.clone() }).unwrap_or_default();
    let cache = app.state::<MenuCache>();
    let mut cached = cache.0.lock().unwrap();
    let tray = app.state::<Tray>();
    let tray = tray.0.lock().unwrap();
    if let Some(t) = tray.as_ref() {
        let _ = t.set_tooltip(Some(&state.status));
    }
    if cached.0 == shape {
        if let Some(item) = cached.1.as_ref() {
            let _ = item.set_text(&state.status);
        }
        return;
    }
    let Ok((menu, status)) = build_menu(&app, &state) else { return };
    if let Some(t) = tray.as_ref() {
        let _ = t.set_menu(Some(menu));
    }
    *cached = (shape, Some(status));
}

fn build_menu(app: &AppHandle, s: &MenuState) -> tauri::Result<(Menu<Wry>, MenuItem<Wry>)> {
    let l = |k: &str| s.labels.get(k).cloned().unwrap_or_else(|| k.to_string());
    let status = MenuItem::with_id(app, "status", &s.status, false, None::<&str>)?;
    let sep = || PredefinedMenuItem::separator(app);

    // First run: the models must be downloaded (on the teacher's say-so) before listening.
    let ready = s.models.is_empty() || s.models == "ready";
    let setup = match s.models.as_str() {
        "missing" => Some(MenuItem::with_id(app, "download-models", l("download"), true, None::<&str>)?),
        "installing" => Some(MenuItem::with_id(app, "cancel-download", l("cancelDownload"), true, None::<&str>)?),
        _ => None,
    };

    // The lesson: one obvious action at a time.
    let start = MenuItem::with_id(app, "start", l("start"), !s.live && ready, accel("S"))?;
    let pause = MenuItem::with_id(app, "pause", if s.paused { l("resume") } else { l("pause") }, s.live, accel("P"))?;
    let end = MenuItem::with_id(app, "end", l("end"), s.live, None::<&str>)?;
    let show_code = MenuItem::with_id(app, "show-code", format!("{} ({})", l("showCode"), s.code), true, None::<&str>)?;

    let top = CheckMenuItem::with_id(app, "pos-top", l("top"), true, s.position == "top", accel("Up"))?;
    let bottom = CheckMenuItem::with_id(app, "pos-bottom", l("bottom"), true, s.position == "bottom", accel("Down"))?;
    let position = Submenu::with_items(app, l("position"), true, &[&top, &bottom])?;

    let auto = CheckMenuItem::with_id(app, "monitor:", l("projector"), true, s.monitor.is_empty(), None::<&str>)?;
    let display = Submenu::with_items(app, l("display"), true, &[&auto, &sep()?])?;
    for name in &s.monitors {
        display.append(&CheckMenuItem::with_id(app, format!("monitor:{name}"), name, true, &s.monitor == name, None::<&str>)?)?;
    }

    let mic_default = CheckMenuItem::with_id(app, "mic:", l("micDefault"), true, s.mic.is_empty(), None::<&str>)?;
    let mic = Submenu::with_items(app, l("mic"), true, &[&mic_default, &sep()?])?;
    for name in &s.mics {
        mic.append(&CheckMenuItem::with_id(app, format!("mic:{name}"), name, true, &s.mic == name, None::<&str>)?)?;
    }

    let en = CheckMenuItem::with_id(app, "lang:en", "English", true, s.lang == "en", None::<&str>)?;
    let fr = CheckMenuItem::with_id(app, "lang:fr", "Français", true, s.lang == "fr", None::<&str>)?;
    let language = Submenu::with_items(app, l("language"), true, &[&en, &fr])?;

    let dodge = CheckMenuItem::with_id(app, "toggle-dodge", l("dodge"), true, s.dodge, None::<&str>)?;
    let hide = CheckMenuItem::with_id(app, "toggle-hide", l("hide"), true, s.hidden, accel("C"))?;
    let login = CheckMenuItem::with_id(app, "toggle-autostart", l("autostart"), true, s.autostart, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", l("quit"), true, Some("Cmd+Q"))?;

    let menu = Menu::with_items(
        app,
        &[
            &status,
            &sep()?,
            &start,
            &pause,
            &end,
            &sep()?,
            &show_code,
            &position,
            &display,
            &mic,
            &language,
            &dodge,
            &hide,
            &sep()?,
            &login,
            &quit,
        ],
    )?;
    if let Some(item) = setup {
        menu.insert(&item, 1)?;
    }
    Ok((menu, status))
}

#[cfg(target_os = "macos")]
fn make_overlay(w: &WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
    let Ok(ptr) = w.ns_window() else { return };
    // SAFETY: Tauri hands us its live NSWindow; we're on the main thread (setup or run_on_main_thread).
    let win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    // Above full-screen apps and presentations: the screen-saver level (1000), as the prototype tested.
    win.setLevel(1000);
    win.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    win.setIgnoresMouseEvents(true);
    win.setHasShadow(false);
    win.orderFrontRegardless();
    log_window_state(win);
}

/// Logs the window's level, Spaces behaviour and whether macOS has it on the current
/// desktop, whenever that changes (diagnosing "not visible on another desktop").
#[cfg(target_os = "macos")]
fn log_window_state(win: &objc2_app_kit::NSWindow) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let s = format!(
        "level={} behaviour={:#x} on-this-desktop={} visible={}",
        win.level(),
        win.collectionBehavior().0,
        win.isOnActiveSpace(),
        win.isVisible()
    );
    let mut last = LAST.lock().unwrap();
    if *last != s {
        eprintln!("[native] window {s}");
        *last = s;
    }
}

/// A non-activating panel class that never takes keyboard focus. macOS carries panels
/// like this across desktops and full-screen apps (the prototype proved it); a regular
/// window with the same settings stayed behind when the teacher swiped desktops.
#[cfg(target_os = "macos")]
fn panel_class() -> &'static objc2::runtime::AnyClass {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{sel, ClassType};
    use objc2_app_kit::NSPanel;
    use std::sync::OnceLock;
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        extern "C-unwind" fn no(_this: &AnyObject, _cmd: Sel) -> Bool {
            Bool::NO
        }
        let mut b = ClassBuilder::new(c"CaptionsOverlayPanel", NSPanel::class()).expect("register panel class");
        // SAFETY: both selectors take no arguments and return BOOL, matching `no`.
        unsafe {
            b.add_method(sel!(canBecomeKeyWindow), no as extern "C-unwind" fn(_, _) -> _);
            b.add_method(sel!(canBecomeMainWindow), no as extern "C-unwind" fn(_, _) -> _);
        }
        b.register()
    })
}

/// Turns Tauri's window into the panel above (the same technique tauri-nspanel uses).
#[cfg(target_os = "macos")]
fn into_panel(w: &WebviewWindow) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSPanel, NSWindowStyleMask};
    let Ok(ptr) = w.ns_window() else { return };
    // SAFETY: NSPanel is an NSWindow subclass without extra state we rely on; swapping the
    // class of a live NSWindow to an NSPanel subclass is how tauri-nspanel makes panels.
    unsafe { objc2::ffi::object_setClass(ptr as *mut AnyObject, panel_class()) };
    let panel: &NSPanel = unsafe { &*(ptr as *const NSPanel) };
    panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    panel.setFloatingPanel(true);
    panel.setHidesOnDeactivate(false);
    eprintln!("[native] window is now a non-activating panel");
}

/// macOS only applies "join all desktops" to a window that is ordered in *after* the
/// behaviour is set. Tauri shows the window first, so take it off screen and back once.
#[cfg(target_os = "macos")]
fn rejoin_all_desktops(w: &WebviewWindow) {
    use objc2_app_kit::NSWindow;
    let Ok(ptr) = w.ns_window() else { return };
    // SAFETY: as in make_overlay; called from setup on the main thread.
    let win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
    win.orderOut(None);
    win.orderFrontRegardless();
    eprintln!("[native] re-ordered window so it joins all desktops");
}

/// Re-front the overlay the moment the teacher swipes to another desktop.
#[cfg(target_os = "macos")]
fn observe_desktops(w: WebviewWindow) {
    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceActiveSpaceDidChangeNotification};
    use objc2_foundation::NSNotification;
    let block = RcBlock::new(move |_n: std::ptr::NonNull<NSNotification>| make_overlay(&w));
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: a standard AppKit notification; the block runs on the main thread (no queue given).
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(NSWorkspaceActiveSpaceDidChangeNotification), None, None, &block)
    };
    // Observe for the app's whole life.
    std::mem::forget(observer);
}

fn send_action(app: &AppHandle, id: &str) {
    eprintln!("[native] action {id}");
    if id == "quit" {
        if let Some(s) = app.state::<Asr>().0.lock().unwrap().take() {
            s.stop();
        }
        app.exit(0);
        return;
    }
    let _ = app.emit_to(WINDOW, "action", id);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, sc, ev| {
                    if ev.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some((_, id)) = shortcuts().iter().find(|(s, _)| s == sc) {
                        send_action(app, id);
                    }
                })
                .build(),
        )
        .on_page_load(|w, p| eprintln!("[native] page {:?} {} ({})", p.event(), p.url(), w.label()))
        .manage(Tray(Mutex::new(None)))
        .manage(MenuCache(Mutex::new((String::new(), None))))
        .manage(Asr(Mutex::new(None)))
        .manage(Install(Arc::new(AtomicBool::new(false)), Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![monitors, place, cursor, reassert, autostart, set_menu, log, asr_devices, asr_start, asr_stop, save_transcript, models_status, models_install, models_cancel])
        .setup(|app| {
            // A menu-bar app: no Dock icon, never steals focus from the lesson.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app.get_webview_window(WINDOW).expect("overlay window");
            let _ = window.set_ignore_cursor_events(true);

            // WebKitGTK ships with WebRTC switched off; student phones connect over WebRTC.
            // Switch it on, then reload once so the page sees it.
            #[cfg(target_os = "linux")]
            let _ = window.with_webview(|wv| {
                use webkit2gtk::{SettingsExt, WebViewExt};
                let view = wv.inner();
                if let Some(settings) = WebViewExt::settings(&view) {
                    settings.set_enable_webrtc(true);
                    settings.set_enable_media_stream(true);
                    eprintln!("[native] WebKitGTK: WebRTC enabled");
                }
                view.reload();
            });
            #[cfg(target_os = "macos")]
            {
                into_panel(&window);
                make_overlay(&window);
                rejoin_all_desktops(&window);
                observe_desktops(window.clone());
            }

            for (sc, _) in shortcuts() {
                let _ = app.global_shortcut().register(sc);
            }

            // Mac: a template icon the menu bar tints. Elsewhere: the full-colour icon, which
            // stays visible on light and dark taskbars.
            #[cfg(target_os = "macos")]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
            #[cfg(not(target_os = "macos"))]
            let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
            let (initial, _) = build_menu(app.handle(), &MenuState { status: "Captions".into(), position: "bottom".into(), lang: "en".into(), ..Default::default() })?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(icon)
                .icon_as_template(true)
                .tooltip("Captions")
                .menu(&initial)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, ev| send_action(app, ev.id().as_ref()))
                .build(app)?;
            *app.state::<Tray>().0.lock().unwrap() = Some(tray);

            // Tests and demos: start the lesson by itself once the page has loaded.
            if std::env::var("CAPTIONS_AUTOSTART").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(6));
                    send_action(&handle, "start");
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the captions overlay");
}
