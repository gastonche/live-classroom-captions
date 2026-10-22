// Web Speech engine (webkitSpeechRecognition). Free, no download, but sessions end on their
// own: after silence, after about a minute on iOS, and whenever the page is hidden. This
// wrapper restarts them silently and turns the raw results into clean interim/final events.
import type { EngineEvents, EngineProblem, SpeechEngine } from './engine';
import { log } from '../diag';

// If interim text stops changing for this long, treat it as final. Some browsers
// (notably iOS Safari) can go a long time without marking anything final.
const STALL_MS = 1400;
// A session that ends this fast without any result counts as a failed start.
const FAST_END_MS = 1500;
// iOS Safari can keep a session "listening" while it has silently stopped producing
// results (seen in a real class). With no result for this long, restart the session.
// In real silence that's a harmless restart every 20 s.
const WATCHDOG_MS = 20000;
// If abort() doesn't produce onend within this time, the session is hung: drop it.
const ABORT_GRACE_MS = 1500;
// Long sessions get recycled at a quiet moment, before they degrade.
const MAX_SESSION_MS = 4 * 60 * 1000;

type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

export function webSpeechSupported(): boolean {
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export class WebSpeechEngine implements SpeechEngine {
  readonly name = 'webspeech';
  readonly online = true;
  private rec: Rec | null = null;
  private want = false;
  private lang = 'en-US';
  private everStarted = false;
  // Per session: how many characters of the session transcript were already emitted as final.
  private emitted = 0;
  private pending = '';
  private stall: ReturnType<typeof setTimeout> | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private sessionAt = 0;
  private gotResult = false;
  private fastEnds = 0;
  private problem: EngineProblem | null = null;
  private lastActivity = 0;
  private session = 0;
  private results = 0;
  private resultsLogged = 0;

  constructor(private ev: EngineEvents) {
    document.addEventListener('visibilitychange', () => {
      log('page', document.visibilityState);
      if (document.visibilityState === 'visible' && this.want && !this.rec) this.begin();
    });
    setInterval(() => this.watch(), 1000);
    // Web Speech needs the network (audio goes to Apple or Google). While offline, sessions
    // fail and back off. When the network returns, start a fresh session right away
    // instead of waiting out the backoff or a dead session.
    window.addEventListener('offline', () => log('network', 'offline'));
    window.addEventListener('online', () => {
      log('network', 'online');
      if (!this.want || document.visibilityState === 'hidden') return;
      this.fastEnds = 0;
      this.problem = null;
      clearTimeout(this.restartTimer);
      if (this.rec) this.recycle();
      else this.begin();
    });
  }

  start(lang: string): void {
    if (!webSpeechSupported()) {
      this.ev.state('error', 'unsupported');
      return;
    }
    log('mic', 'start ' + lang);
    this.want = true;
    this.lang = lang;
    this.problem = null;
    this.fastEnds = 0;
    if (this.rec) this.rec.abort();
    else this.begin();
  }

  stop(): void {
    log('mic', 'stop');
    this.want = false;
    clearTimeout(this.restartTimer);
    this.flush();
    if (this.rec) this.rec.stop();
    this.ev.state('idle');
  }

  private begin(): void {
    clearTimeout(this.restartTimer);
    if (!this.want || document.visibilityState === 'hidden') return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r: Rec = new SR();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    this.emitted = 0;
    this.pending = '';
    this.gotResult = false;
    this.sessionAt = this.lastActivity = Date.now();
    this.results = this.resultsLogged = 0;
    log('session', `#${++this.session} begin ${this.lang}`);
    r.onstart = () => {
      this.everStarted = true;
      this.lastActivity = Date.now();
      log('session', 'listening');
      this.ev.state('listening');
    };
    r.onresult = (e) => this.onResult(e);
    r.onerror = (e) => this.onError(e.error as string);
    r.onend = () => this.onEnd(r);
    this.rec = r;
    try {
      r.start();
    } catch (err) {
      log('session', 'start threw ' + String(err));
      this.rec = null;
      this.scheduleRestart();
    }
  }

  private onResult(e: any): void {
    this.gotResult = true;
    this.lastActivity = Date.now();
    // Count results, logged at most every 10 s (lengths only, never the words).
    this.results++;
    if (this.lastActivity - this.resultsLogged > 10000) {
      this.resultsLogged = this.lastActivity;
      log('results', `${this.results} so far this session`);
    }
    let fin = '';
    let all = '';
    for (let i = 0; i < e.results.length; i++) {
      const t: string = e.results[i][0].transcript;
      all += t;
      if (e.results[i].isFinal) fin = all;
    }
    // Final text beyond what was already emitted (including text we force-finalised).
    if (fin.length > this.emitted) {
      this.emit(fin.slice(this.emitted));
      this.emitted = fin.length;
    }
    const rest = all.length > this.emitted ? all.slice(this.emitted).trim() : '';
    if (rest !== this.pending) {
      this.pending = rest;
      this.ev.interim(rest);
      clearTimeout(this.stall);
      if (rest) {
        const at = all.length;
        this.stall = setTimeout(() => {
          // Nothing changed for a while: the speaker paused. Firm it up.
          if (this.pending === rest) {
            this.emit(rest);
            this.emitted = at;
            this.pending = '';
          }
        }, STALL_MS);
      }
    }
  }

  private onError(code: string): void {
    log('error', code);
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      // Before the first successful start this is a real denial. Afterwards it's
      // usually iOS refusing a restart that wasn't inside a tap.
      this.problem = this.everStarted ? 'needs-tap' : 'blocked';
    } else if (code === 'audio-capture') {
      this.problem = 'no-mic';
    } else if (code === 'network') {
      this.problem = 'network';
    }
    // 'no-speech' and 'aborted' are routine; onend restarts.
  }

  private onEnd(r: Rec): void {
    if (r !== this.rec) return;
    log('session', `end after ${Math.round((Date.now() - this.sessionAt) / 1000)}s, ${this.results} results`);
    this.rec = null;
    clearTimeout(this.stall);
    this.flush();
    if (!this.want) return;
    if (this.problem === 'blocked' || this.problem === 'needs-tap' || this.problem === 'no-mic') {
      const p = this.problem;
      // "needs-tap" keeps wanting: the next tap calls start() and carries on.
      if (p !== 'needs-tap') this.want = false;
      this.ev.state('error', p);
      return;
    }
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    const quick = Date.now() - this.sessionAt < FAST_END_MS && !this.gotResult;
    this.fastEnds = quick ? this.fastEnds + 1 : 0;
    const delay = this.problem === 'network' ? 2000 : quick ? Math.min(3000, 150 * Math.pow(2, this.fastEnds)) : 30;
    this.problem = null;
    log('restart', `in ${delay}ms`);
    this.ev.state('restarting');
    this.restartTimer = setTimeout(() => this.begin(), delay);
  }

  /** Once a second: restart a session that went silent, or one that has run for a long time. */
  private watch(): void {
    if (!this.want || !this.rec) return;
    const now = Date.now();
    if (now - this.lastActivity > WATCHDOG_MS) {
      log('watchdog', `no results for ${Math.round((now - this.lastActivity) / 1000)}s, restarting`);
      this.recycle();
    } else if (now - this.sessionAt > MAX_SESSION_MS && !this.pending && now - this.lastActivity > 1500) {
      log('watchdog', 'long session, recycling at a pause');
      this.recycle();
    }
  }

  private recycle(): void {
    const r = this.rec;
    if (!r) return;
    this.lastActivity = Date.now(); // don't fire again while this restart is in flight
    this.flush();
    try {
      r.abort();
    } catch {
      /* already dead */
    }
    setTimeout(() => {
      if (this.rec !== r) return;
      // abort() produced no onend: the session is hung. Detach it and start fresh.
      log('watchdog', 'session hung (no onend after abort), replacing it');
      r.onstart = r.onresult = r.onerror = r.onend = null;
      this.rec = null;
      this.scheduleRestart();
    }, ABORT_GRACE_MS);
  }

  /** A session ending mid-phrase would lose its interim text; emit it as final instead. */
  private flush(): void {
    clearTimeout(this.stall);
    if (this.pending) this.emit(this.pending);
    this.pending = '';
  }

  private emit(text: string): void {
    const t = text.trim();
    if (t) this.ev.final(t);
  }
}
