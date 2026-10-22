// THROWAWAY PROTOTYPE (see docs/overlay.md, "Risks"). Answers one question: does an
// always-on-top, click-through caption box stay visible over full-screen apps and
// presentation modes on macOS, and at which window level?
//
// Build: swiftc -O main.swift -o overlay-proto
// Run:   ./overlay-proto [--level screenSaver] [--screen "LG"] [--position bottom] [--log path]
// Control it from its menu-bar item ("CC"): level, position, screen, quit.
import AppKit

// ---- Options ----
var opts: [String: String] = [:]
var argv = Array(CommandLine.arguments.dropFirst())
while argv.count >= 2, argv[0].hasPrefix("--") { opts[String(argv[0].dropFirst(2))] = argv[1]; argv.removeFirst(2) }

let levels: [(String, NSWindow.Level)] = [
  ("floating", .floating),
  ("statusBar", .statusBar),
  ("popUpMenu", .popUpMenu),
  ("screenSaver", .screenSaver),
  ("shielding (max)", NSWindow.Level(rawValue: Int(CGShieldingWindowLevel()))),
]
var levelName = opts["level"] ?? "screenSaver"
var position = opts["position"] ?? "bottom"
var screenHint = opts["screen"]
let logPath = opts["log"] ?? "overlay-proto.log"
FileManager.default.createFile(atPath: logPath, contents: nil)
let logHandle = FileHandle(forWritingAtPath: logPath)!

func log(_ s: String) {
  let f = DateFormatter()
  f.dateFormat = "HH:mm:ss"
  let line = "\(f.string(from: Date())) \(s)\n"
  logHandle.write(line.data(using: .utf8)!)
  FileHandle.standardOutput.write(line.data(using: .utf8)!)
}

// ---- Window that never takes focus ----
final class Panel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class CaptionView: NSView {
  let text = NSTextField(wrappingLabelWithString: "")
  let badge = NSTextField(labelWithString: "")
  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor(white: 0, alpha: 0.78).cgColor
    layer?.cornerRadius = 14
    text.textColor = .white
    text.maximumNumberOfLines = 2
    text.lineBreakMode = .byWordWrapping
    badge.textColor = NSColor(white: 1, alpha: 0.45)
    badge.font = .systemFont(ofSize: 11)
    addSubview(text)
    addSubview(badge)
  }
  required init?(coder: NSCoder) { fatalError() }
  override func layout() {
    super.layout()
    let pad: CGFloat = 18
    text.frame = NSRect(x: pad, y: pad, width: bounds.width - pad * 2, height: bounds.height - pad * 2 - 12)
    badge.frame = NSRect(x: pad, y: bounds.height - 18, width: bounds.width - pad * 2, height: 14)
  }
}

let script = [
  "Today we use grep to search inside files.",
  "If you get permission denied, use sudo or chmod.",
  "Pipe the output of ls into grep, then sort it.",
  "Make a new folder with mkdir and move into it with cd.",
  "Now let's open the editor and write some JavaScript.",
  "In the browser, the HTML heading sits at the top of the page.",
]

final class App: NSObject, NSApplicationDelegate {
  var panel: Panel!
  var view: CaptionView!
  var status: NSStatusItem!
  var i = 0

  func applicationDidFinishLaunching(_ n: Notification) {
    NSApp.setActivationPolicy(.accessory) // no Dock icon, never activates
    panel = Panel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.ignoresMouseEvents = true // click-through
    panel.hidesOnDeactivate = false
    panel.isFloatingPanel = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    view = CaptionView(frame: .zero)
    panel.contentView = view
    applyLevel()
    place()
    panel.orderFrontRegardless()

    status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    status.button?.title = "CC"
    rebuildMenu()

    Timer.scheduledTimer(withTimeInterval: 1.6, repeats: true) { _ in self.tick() }.fire()
    Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in self.report() }
    NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { _ in
      log("EVENT screens changed")
      self.place()
    }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main) { _ in
      log("EVENT active space changed")
      self.panel.orderFrontRegardless()
    }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { n in
      let app = (n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.localizedName ?? "?"
      log("EVENT app activated: \(app)")
    }
    log("START level=\(levelName) position=\(position) screen=\(targetScreen().localizedName)")
  }

  func targetScreen() -> NSScreen {
    let screens = NSScreen.screens
    if let h = screenHint, let s = screens.first(where: { $0.localizedName.localizedCaseInsensitiveContains(h) }) { return s }
    // Default: the first screen that isn't the built-in one (the projector), else the main one.
    return screens.first(where: { !$0.localizedName.localizedCaseInsensitiveContains("built-in") && $0 != screens.first }) ?? screens[0]
  }

  func place() {
    let s = targetScreen()
    let f = s.frame
    let w = f.width * 0.70
    let fontSize = f.height * 0.045
    view.text.font = .systemFont(ofSize: fontSize, weight: .semibold)
    let h = fontSize * 1.25 * 2 + 36 + 12
    let margin = f.height * 0.05
    let y = position == "top" ? f.maxY - margin - h : f.minY + margin
    panel.setFrame(NSRect(x: f.midX - w / 2, y: y, width: w, height: h), display: true)
    panel.orderFrontRegardless()
  }

  func applyLevel() {
    panel.level = levels.first(where: { $0.0.hasPrefix(levelName) })?.1 ?? .screenSaver
    panel.orderFrontRegardless()
  }

  func tick() {
    view.text.stringValue = script[i % script.count]
    i += 1
    let f = DateFormatter()
    f.dateFormat = "HH:mm:ss"
    view.badge.stringValue = "PROTOTYPE · level \(levelName) · \(f.string(from: Date()))"
    // Some apps reorder windows on activation; keep ours in front.
    panel.orderFrontRegardless()
  }

  /// Once a second: what's in front, is a window covering our screen, and does macOS think we're visible?
  func report() {
    let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
    let visible = panel.occlusionState.contains(.visible)
    let s = targetScreen()
    // Window list (owner + bounds only: no Screen Recording permission needed).
    let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    let mainH = NSScreen.screens[0].frame.height
    var cover = "-"
    var above = 0
    var reachedSelf = false
    for w in list {
      let owner = w[kCGWindowOwnerName as String] as? String ?? "?"
      let layer = w[kCGWindowLayer as String] as? Int ?? 0
      let pid = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
      if pid == ProcessInfo.processInfo.processIdentifier, layer == panel.level.rawValue { reachedSelf = true; continue }
      if !reachedSelf { above += 1 }
      guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
      // CG coordinates are top-left based; convert to AppKit to compare with the screen.
      let r = NSRect(x: b["X"] ?? 0, y: mainH - (b["Y"] ?? 0) - (b["Height"] ?? 0), width: b["Width"] ?? 0, height: b["Height"] ?? 0)
      if cover == "-", owner != "Window Server", r.contains(s.frame.insetBy(dx: 2, dy: 2)) { cover = "\(owner)@layer\(layer)" }
    }
    log("front=\(front) visible=\(visible) fullscreen-cover=\(cover) windows-above-us=\(above) level=\(levelName)")
  }

  func rebuildMenu() {
    let m = NSMenu()
    m.addItem(withTitle: "Overlay prototype", action: nil, keyEquivalent: "")
    m.addItem(.separator())
    for (name, _) in levels {
      let it = NSMenuItem(title: "Level: \(name)", action: #selector(pickLevel(_:)), keyEquivalent: "")
      it.target = self
      it.representedObject = name
      it.state = name.hasPrefix(levelName) ? .on : .off
      m.addItem(it)
    }
    m.addItem(.separator())
    for p in ["top", "bottom"] {
      let it = NSMenuItem(title: "Position: \(p)", action: #selector(pickPosition(_:)), keyEquivalent: "")
      it.target = self
      it.representedObject = p
      it.state = p == position ? .on : .off
      m.addItem(it)
    }
    m.addItem(.separator())
    for s in NSScreen.screens {
      let it = NSMenuItem(title: "Screen: \(s.localizedName)", action: #selector(pickScreen(_:)), keyEquivalent: "")
      it.target = self
      it.representedObject = s.localizedName
      it.state = s == targetScreen() ? .on : .off
      m.addItem(it)
    }
    m.addItem(.separator())
    let q = NSMenuItem(title: "Quit prototype", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    m.addItem(q)
    status.menu = m
  }

  @objc func pickLevel(_ s: NSMenuItem) {
    levelName = s.representedObject as! String
    applyLevel()
    log("SET level=\(levelName)")
    rebuildMenu()
  }

  @objc func pickPosition(_ s: NSMenuItem) {
    position = s.representedObject as! String
    place()
    log("SET position=\(position)")
    rebuildMenu()
  }

  @objc func pickScreen(_ s: NSMenuItem) {
    screenHint = s.representedObject as? String
    place()
    log("SET screen=\(screenHint ?? "?")")
    rebuildMenu()
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.run()
