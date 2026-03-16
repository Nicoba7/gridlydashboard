/**
 * Abstraction over repeated-interval scheduling.
 *
 * The production implementation delegates to setInterval. The test
 * implementation exposes a manual .tick() trigger so tests can step through
 * multiple cycles without using real time or fake timers.
 */
export interface IntervalScheduler {
  /**
   * Begin firing fn every intervalMs milliseconds.
   * Calling schedule replaces any active schedule.
   */
  schedule(intervalMs: number, fn: () => Promise<void>): void;
  /** Cancel the active schedule. Safe to call when already cancelled. */
  cancel(): void;
}

/** Production scheduler backed by setInterval. */
export class RealIntervalScheduler implements IntervalScheduler {
  private handle?: ReturnType<typeof setInterval>;

  schedule(intervalMs: number, fn: () => Promise<void>): void {
    this.cancel();
    this.handle = setInterval(() => {
      void fn();
    }, intervalMs);
  }

  cancel(): void {
    if (this.handle !== undefined) {
      clearInterval(this.handle);
      this.handle = undefined;
    }
  }
}

/**
 * Test-only scheduler. Cycles are triggered explicitly via .tick() so tests
 * can execute multiple loop cycles in sequence without timers.
 */
export class ManualIntervalScheduler implements IntervalScheduler {
  private fn?: () => Promise<void>;

  schedule(_intervalMs: number, fn: () => Promise<void>): void {
    this.fn = fn;
  }

  cancel(): void {
    this.fn = undefined;
  }

  /** Trigger one scheduled cycle and await its completion. */
  async tick(): Promise<void> {
    if (this.fn) {
      await this.fn();
    }
  }
}
