// Countdown timer with an injectable clock so it can be tested without real time passing.

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Countdown {
  constructor(durationMs, { now = () => Date.now(), onTick = null, onEnd = null, tickMs = 250 } = {}) {
    this.durationMs = durationMs;
    this.now = now;
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.tickMs = tickMs;
    this.startedAt = null;
    this.elapsedBefore = 0;
    this.handle = null;
    this.ended = false;
  }

  elapsed() {
    const running = this.startedAt === null ? 0 : this.now() - this.startedAt;
    return this.elapsedBefore + running;
  }

  remaining() {
    return Math.max(0, this.durationMs - this.elapsed());
  }

  isRunning() {
    return this.startedAt !== null;
  }

  start() {
    if (this.ended || this.startedAt !== null) return;
    this.startedAt = this.now();
    if (typeof setInterval === 'function' && this.tickMs > 0) {
      this.handle = setInterval(() => this.tick(), this.tickMs);
    }
    this.tick();
  }

  pause() {
    if (this.startedAt === null) return;
    this.elapsedBefore += this.now() - this.startedAt;
    this.startedAt = null;
    this.clearHandle();
  }

  stop() {
    this.pause();
    this.ended = true;
  }

  // Called by the interval; also callable directly in tests.
  tick() {
    const left = this.remaining();
    if (this.onTick) this.onTick(left);
    if (left <= 0 && !this.ended) {
      this.stop();
      if (this.onEnd) this.onEnd();
    }
  }

  clearHandle() {
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
