/* Phase 0: Vosk WASM load time and real-time factor on this device.
   Loaded on demand by check.js; runs only where modern JS exists. */
(function () {
  'use strict';
  // Absolute URL: Vosk fetches the model from a blob-URL worker, where relative paths don't resolve.
  var MODEL = new URL('/models/vosk-model-small-en-us-0.15.tar.gz', location.href).href;
  var WAV = '/models/test-en.wav';

  function now() { return performance.now(); }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function pcm16ToFloat(buf) {
    // Minimal WAV parse: find the "data" chunk.
    var v = new DataView(buf), off = 12;
    while (off < v.byteLength - 8) {
      var id = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
      var size = v.getUint32(off + 4, true);
      if (id === 'data') {
        var n = size / 2, out = new Float32Array(n);
        for (var i = 0; i < n; i++) out[i] = v.getInt16(off + 8 + i * 2, true) / 32768;
        return out;
      }
      off += 8 + size;
    }
    throw new Error('no data chunk');
  }

  window.__voskCheck = function (set, send) {
    var t0 = now();
    set('vosk', 'loading library…', 'warn');
    loadScript('/vendor/vosk.js').then(function () {
      set('vosk library load ms', Math.round(now() - t0), '');
      var t1 = now();
      set('vosk', 'loading model (~40 MB)…', 'warn');
      return window.Vosk.createModel(MODEL).then(function (model) {
        set('vosk model load ms', Math.round(now() - t1), '');
        return fetch(WAV).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
          var samples = pcm16ToFloat(buf), rate = 16000;
          var audioSec = samples.length / rate;
          var rec = new model.KaldiRecognizer(rate);
          var text = [];
          return new Promise(function (resolve) {
            var t2, last = 0;
            rec.on('result', function (m) { last = now(); if (m.result.text) text.push(m.result.text); });
            rec.on('error', function (m) { set('vosk error', String(m.error), 'bad'); });
            t2 = now();
            // Feed 0.25 s chunks as fast as possible, then flush. RTF = time to the
            // last result / audio length, measured once results go quiet for 1.5 s.
            var step = rate / 4;
            for (var i = 0; i < samples.length; i += step) {
              var chunk = samples.subarray(i, i + step);
              rec.acceptWaveform({ getChannelData: function () { return chunk; }, sampleRate: rate, numberOfChannels: 1, length: chunk.length });
            }
            rec.retrieveFinalResult();
            var iv = setInterval(function () {
              var quiet = last && now() - last > 1500;
              if (quiet || now() - t2 > 60000) {
                clearInterval(iv);
                var rtf = last ? (last - t2) / 1000 / audioSec : NaN;
                set('vosk real-time factor', +rtf.toFixed(3), rtf < 0.5 ? 'ok' : 'warn');
                set('vosk transcript', text.join(' '), '');
                set('vosk', !!text.length);
                model.terminate();
                resolve();
              }
            }, 100);
          });
        });
      });
    })['catch'](function (e) { set('vosk', false); set('vosk error', String(e), 'bad'); })
      .then(send);
  };
})();
