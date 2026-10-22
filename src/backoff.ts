// Reconnect delays: fast first retry, doubling to a cap. The 5 s reconnect budget
// means the cap stays low; an attempt is cheap.
export class Backoff {
  private n = 0;
  constructor(private min = 300, private max = 3000, private factor = 2) {}

  next(): number {
    const d = Math.min(this.max, this.min * Math.pow(this.factor, this.n));
    this.n++;
    return d;
  }

  reset(): void {
    this.n = 0;
  }

  get attempts(): number {
    return this.n;
  }
}

/** Calls `fn` after the next backoff delay. Only one retry is pending at a time. */
export class Retrier {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private backoff = new Backoff()) {}

  schedule(fn: () => void): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      fn();
    }, this.backoff.next());
  }

  succeeded(): void {
    this.backoff.reset();
    this.cancel();
  }

  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get pending(): boolean {
    return this.timer !== undefined;
  }
}
