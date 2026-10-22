/* Phase 0 diagnostics. Deliberately ES5 with no build step, so it runs on
   the oldest TV browser and reports what that browser can do. */
(function () {
  'use strict';

  var results = {};
  var order = [];
  var tbody = document.getElementById('results');
  var started = Date.now();

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function set(key, value, level) {
    if (!(key in results)) order.push(key);
    results[key] = value;
    var id = 'r-' + key.replace(/[^a-z0-9]/gi, '_');
    var row = document.getElementById(id);
    if (!row) {
      row = document.createElement('tr');
      row.id = id;
      row.innerHTML = '<td></td><td></td>';
      tbody.appendChild(row);
    }
    row.cells[0].textContent = key;
    row.cells[1].textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
    row.cells[1].className = level || (value === true ? 'ok' : value === false ? 'bad' : '');
  }

  function guessLabel() {
    var m = /[?&]label=([^&]+)/.exec(location.search);
    if (m) return decodeURIComponent(m[1]);
    var ua = navigator.userAgent;
    var standalone = navigator.standalone === true ||
      (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (/VIDAA|Hisense|HiTV|TV|SmartTV|Web0S|Tizen/i.test(ua)) return 'tv';
    if (/iPhone|iPad/.test(ua)) return standalone ? 'iphone-pwa' : 'iphone-safari';
    if (/Android/.test(ua)) return standalone ? 'android-pwa' : 'android';
    return 'desktop';
  }

  var label = guessLabel();
  document.getElementById('label').textContent = 'Device: ' + label + '  ·  ' + navigator.userAgent;

  function syntax(name, src) {
    var ok;
    try { new Function(src); ok = true; } catch (e) { ok = false; }
    set('syntax ' + name, ok);
    return ok;
  }

  function send() {
    var payload = {
      label: label,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      url: location.href,
      results: results
    };
    var el = document.getElementById('status');
    try {
      var x = new XMLHttpRequest();
      x.open('POST', '/report', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () {
        el.className = x.status === 200 ? 'ok' : 'warn';
        el.textContent = x.status === 200 ? 'Report sent (' + order.length + ' checks).' : 'Report not saved (HTTP ' + x.status + ').';
      };
      x.onerror = function () { el.className = 'warn'; el.textContent = 'Report could not be sent.'; };
      x.send(JSON.stringify(payload));
    } catch (e) {
      el.className = 'bad'; el.textContent = 'Report failed: ' + e;
    }
  }

  // ---- Environment ----
  set('userAgent', navigator.userAgent, '');
  set('platform', navigator.platform || '', '');
  set('language', navigator.language || '', '');
  set('screen', screen.width + 'x' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x, viewport ' + window.innerWidth + 'x' + window.innerHeight, '');
  set('secureContext', !!window.isSecureContext);
  set('standalone (home-screen app)', navigator.standalone === true ||
    !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches), '');
  set('hardwareConcurrency', navigator.hardwareConcurrency || 'unknown', '');
  set('deviceMemory (GB)', navigator.deviceMemory || 'unknown', '');

  // ---- JS language level ----
  var lvl = 'ES5';
  if (syntax('ES2015 (let, arrow, class, template)', 'let a=()=>1;class B{};const c=`x${a()}`;for(const d of [1]){}')) lvl = 'ES2015';
  if (lvl === 'ES2015' && syntax('ES2017 (async/await)', 'async function f(){await 1}')) lvl = 'ES2017';
  if (lvl === 'ES2017' && syntax('ES2018 (object spread)', 'var a={...{b:1}}')) lvl = 'ES2018';
  if (lvl === 'ES2018' && syntax('ES2019 (optional catch binding)', 'try{}catch{}')) lvl = 'ES2019';
  if (lvl === 'ES2019' && syntax('ES2020 (?. and ??)', 'var a=null;a?.b??1')) lvl = 'ES2020';
  if (lvl === 'ES2020' && syntax('ES2021 (??=)', 'var a;a??=1')) lvl = 'ES2021';
  if (lvl === 'ES2021' && syntax('ES2022 (class fields, #private)', 'class A{x=1;#y=2;static z=3}')) lvl = 'ES2022';
  set('ES syntax level', lvl, lvl === 'ES5' ? 'warn' : 'ok');
  set('ES modules (<script type=module>)', 'noModule' in document.createElement('script'));
  set('Promise', typeof Promise === 'function');
  set('fetch', typeof window.fetch === 'function');
  set('TextEncoder', typeof window.TextEncoder === 'function');
  set('Intl', typeof window.Intl === 'object');
  set('CSS custom properties', !!(window.CSS && CSS.supports && CSS.supports('--a', '0')));
  set('CSS flexbox gap', !!(window.CSS && CSS.supports && CSS.supports('gap', '1px')));
  set('requestAnimationFrame', typeof window.requestAnimationFrame === 'function');

  // ---- Platform APIs ----
  set('localStorage', (function () { try { localStorage.setItem('_c', '1'); localStorage.removeItem('_c'); return true; } catch (e) { return false; } })());
  set('serviceWorker', 'serviceWorker' in navigator);
  set('Web App Manifest support (BeforeInstallPrompt)', 'onbeforeinstallprompt' in window, '');
  set('Wake Lock API', 'wakeLock' in navigator);
  set('WebSocket', typeof window.WebSocket === 'function');
  set('RTCPeerConnection', typeof (window.RTCPeerConnection || window.webkitRTCPeerConnection) === 'function');
  set('crypto.subtle', !!(window.crypto && crypto.subtle));
  set('WebAssembly', typeof window.WebAssembly === 'object');
  set('SharedArrayBuffer', typeof window.SharedArrayBuffer === 'function', '');
  set('crossOriginIsolated', !!window.crossOriginIsolated, '');
  set('AudioWorklet', !!(window.AudioContext && 'audioWorklet' in AudioContext.prototype));
  set('getUserMedia', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
  set('SpeechRecognition (standard)', typeof window.SpeechRecognition === 'function');
  set('webkitSpeechRecognition', typeof window.webkitSpeechRecognition === 'function');
  set('Fullscreen API', !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen));
  set('share()', typeof navigator.share === 'function');

  var pending = 0;
  function begin() { pending++; }
  function end() { if (--pending === 0) { done(); } }
  function done() { send(); }

  // ---- AES-GCM round trip (for the encrypted MQTT fallback) ----
  if (window.crypto && crypto.subtle && window.TextEncoder) {
    begin();
    var t0 = now();
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']).then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode('hello')).then(function (ct) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      });
    }).then(function (pt) {
      set('AES-GCM round trip', new TextDecoder().decode(pt) === 'hello');
      set('AES-GCM ms', Math.round(now() - t0), '');
    })['catch'](function (e) { set('AES-GCM round trip', false); set('AES-GCM error', String(e), 'bad'); })
      .then(end);
  }

  // ---- WebRTC data channel loopback (two peers in this page) ----
  var PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (PC) {
    begin();
    var finished = false;
    var timer = setTimeout(function () { finish(false, 'timeout after 8 s'); }, 8000);
    var a, b;
    var finish = function (ok, info) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      set('WebRTC data channel loopback', ok);
      if (info) set('WebRTC loopback detail', info, ok ? '' : 'bad');
      try { a.close(); b.close(); } catch (e) {}
      end();
    };
    try {
      a = new PC({ iceServers: [] });
      b = new PC({ iceServers: [] });
      a.onicecandidate = function (e) { if (e.candidate) b.addIceCandidate(e.candidate)['catch'](function () {}); };
      b.onicecandidate = function (e) { if (e.candidate) a.addIceCandidate(e.candidate)['catch'](function () {}); };
      var ch = a.createDataChannel('t', { ordered: true });
      var tStart = now();
      var sentAt = 0;
      var rtts = [];
      ch.onopen = function () {
        set('WebRTC open ms', Math.round(now() - tStart), '');
        sentAt = now(); ch.send('ping');
      };
      b.ondatachannel = function (e) {
        e.channel.onmessage = function (m) { e.channel.send(m.data); };
      };
      ch.onmessage = function () {
        rtts.push(now() - sentAt);
        if (rtts.length < 20) { sentAt = now(); ch.send('ping'); return; }
        rtts.sort(function (x, y) { return x - y; });
        finish(true, 'RTT median ' + rtts[10].toFixed(2) + ' ms, max ' + rtts[19].toFixed(2) + ' ms');
      };
      a.createOffer().then(function (o) { return a.setLocalDescription(o); })
        .then(function () { return b.setRemoteDescription(a.localDescription); })
        .then(function () { return b.createAnswer(); })
        .then(function (ans) { return b.setLocalDescription(ans); })
        .then(function () { return a.setRemoteDescription(b.localDescription); })
        ['catch'](function (e) { finish(false, String(e)); });
    } catch (e) { finish(false, 'threw: ' + e); }
  }

  // ---- Reachability of free public signalling endpoints ----
  function wsProbe(name, url, protocols) {
    if (typeof window.WebSocket !== 'function') return;
    begin();
    var t = now(), doneP = false, ws;
    function fin(ok, info) {
      if (doneP) return; doneP = true;
      set(name, ok);
      set(name + ' detail', info, ok ? '' : 'bad');
      try { ws.close(); } catch (e) {}
      end();
    }
    try { ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url); } catch (e) { fin(false, 'threw ' + e); return; }
    var to = setTimeout(function () { fin(false, 'timeout 8 s'); }, 8000);
    ws.onopen = function () { clearTimeout(to); fin(true, 'open in ' + Math.round(now() - t) + ' ms'); };
    ws.onerror = function () { clearTimeout(to); fin(false, 'error after ' + Math.round(now() - t) + ' ms'); };
  }
  var rid = 'check' + Math.random().toString(36).slice(2, 10);
  wsProbe('PeerJS public server (wss)', 'wss://0.peerjs.com/peerjs?key=peerjs&id=' + rid + '&token=' + rid);
  wsProbe('HiveMQ public broker (wss mqtt)', 'wss://broker.hivemq.com:8884/mqtt', ['mqtt']);

  if (pending === 0) done();

  // ---- Manual: speech recognition ----
  var speechBox = document.getElementById('speech');
  function testSpeech(lang) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var key = 'speech ' + lang;
    if (!SR) { set(key, 'not available', 'bad'); send(); return; }
    var r = new SR();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    var t = now(), firstResult = 0, finals = 0, interims = 0, text = '', ends = [];
    set(key, 'listening… speak now, stops after 20 s', 'warn');
    r.onstart = function () { set(key + ' onstart ms', Math.round(now() - t), ''); };
    r.onresult = function (e) {
      if (!firstResult) { firstResult = now(); set(key + ' first result ms', Math.round(firstResult - t), ''); }
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { finals++; text += e.results[i][0].transcript + ' '; }
        else { interims++; interim += e.results[i][0].transcript; }
      }
      speechBox.textContent = text + (interim ? ' [' + interim + ']' : '');
    };
    r.onerror = function (e) { set(key + ' error', e.error + (e.message ? ': ' + e.message : ''), 'bad'); };
    r.onend = function () {
      ends.push(Math.round(now() - t));
      set(key, finals || interims ? true : false);
      set(key + ' summary', { finals: finals, interims: interims, endedAtMs: ends, text: text.slice(0, 300) }, '');
      send();
    };
    try { r.start(); } catch (e) { set(key + ' error', 'start threw ' + e, 'bad'); send(); return; }
    setTimeout(function () { try { r.stop(); } catch (e) {} }, 20000);
  }
  document.getElementById('btn-speech-en').onclick = function () { testSpeech('en-US'); };
  document.getElementById('btn-speech-fr').onclick = function () { testSpeech('fr-FR'); };

  // ---- Manual: wake lock ----
  document.getElementById('btn-wake').onclick = function () {
    if (!('wakeLock' in navigator)) { set('wake lock request', 'API missing', 'bad'); send(); return; }
    navigator.wakeLock.request('screen').then(function (s) {
      set('wake lock request', true);
      setTimeout(function () { s.release(); }, 3000);
      send();
    }, function (e) { set('wake lock request', false); set('wake lock error', String(e), 'bad'); send(); });
  };

  // ---- Manual: Vosk WASM ----
  document.getElementById('btn-vosk').onclick = function () {
    if (window.__voskCheck) { window.__voskCheck(set, send); return; }
    var s = document.createElement('script');
    s.src = '/vosk-check.js';
    s.onload = function () { window.__voskCheck(set, send); };
    s.onerror = function () { set('vosk', 'vosk-check.js not available yet', 'warn'); send(); };
    document.head.appendChild(s);
  };

  document.getElementById('btn-send').onclick = send;
})();
