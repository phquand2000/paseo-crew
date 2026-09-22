/** Reads once a seat is quiet for `quietMs`, at most `mostMs` after the first nudge; a nudge mid-run runs it again after. */
export class Pacer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waitingSince = 0;
  private running = false;
  private again = false;
  private stopped = false;
  readonly halt = new AbortController();
  private readonly quiet: number;
  private readonly most: number;
  private readonly run: () => Promise<void>;

  constructor(quietMs: number, mostMs: number, run: () => Promise<void>) {
    this.quiet = quietMs;
    this.most = mostMs;
    this.run = run;
  }

  nudge(now = Date.now()): void {
    if (this.stopped) return;
    if (!this.timer) this.waitingSince = now;
    const at = Math.min(now + this.quiet, this.waitingSince + this.most);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fire(), Math.max(0, at - now));
    this.timer.unref?.();
  }

  now(): void {
    if (this.stopped) return;
    this.fire();
  }

  stop(): void {
    this.stopped = true;
    this.halt.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private fire(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    void this.run()
      .catch(() => undefined)
      .finally(() => {
        this.running = false;
        if (this.again && !this.stopped) {
          this.again = false;
          this.fire();
        }
      });
  }
}
