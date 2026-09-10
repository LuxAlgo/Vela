type Now = () => number;
type Raf = (cb: () => void) => number;
type CancelRaf = (h: number) => void;

/**
 * A self-stopping rAF loop for time-based animation (eased zoom, inertial pan,
 * gliding autoscale). Separate from the invalidation-driven Scheduler: while a
 * gesture is in flight this drives a continuous frame loop, calling `tick(dtMs)`
 * each frame; when `tick` returns false (everything settled) it stops, so a
 * static chart costs zero idle frames again.
 */
export class Animator {
    private handle: number | null = null;
    private last = 0;
    private stopped = false;
    private readonly raf: Raf;
    private readonly cancel: CancelRaf;
    private readonly now: Now;

    constructor(
        private readonly tick: (dtMs: number) => boolean,
        raf?: Raf,
        cancel?: CancelRaf,
        now?: Now,
    ) {
        this.raf = raf ?? ((cb) => requestAnimationFrame(cb));
        this.cancel = cancel ?? ((h) => cancelAnimationFrame(h));
        this.now = now ?? (() => performance.now());
    }

    get active(): boolean {
        return this.handle !== null;
    }

    /** Begin (or keep) the loop. Idempotent — safe to call every gesture event. */
    start(): void {
        this.stopped = false;
        if (this.handle !== null) return;
        this.last = this.now();
        this.handle = this.raf(this.loop);
    }

    stop(): void {
        this.stopped = true; // honored even if called re-entrantly from inside tick()
        if (this.handle !== null) {
            this.cancel(this.handle);
            this.handle = null;
        }
    }

    private readonly loop = (): void => {
        const t = this.now();
        const dt = t - this.last;
        this.last = t;
        // Clamp dt so a backgrounded tab (huge gap) doesn't teleport the animation.
        const more = this.tick(Math.min(dt, 64));
        // Re-arm only if still wanted AND a re-entrant stop() during tick didn't cancel us.
        this.handle = more && !this.stopped ? this.raf(this.loop) : null;
    };
}

/**
 * One configurable ease time-constant (ms; 0 = the motion is off). Remembers the last
 * non-zero value so a plain on/off switch (the settings dialog, the rich config's
 * booleans) turns the motion back on at the host's duration, not a built-in default.
 */
export class EaseSetting {
    private ms: number;
    private onMs: number;

    /** `defaultMs` is what the on/off switch restores when nothing else was configured;
     *  `initialMs` (default: `defaultMs`) is the starting value — 0 for a motion that
     *  ships off. */
    constructor(defaultMs: number, initialMs = defaultMs) {
        this.onMs = defaultMs;
        this.ms = initialMs;
    }

    /** The active time-constant; 0 when off. */
    get tau(): number {
        return this.ms;
    }

    get on(): boolean {
        return this.ms > 0;
    }

    /** Set the time-constant (0 = off). A non-zero value becomes what `toggle(true)` restores. */
    set(ms: number): void {
        this.ms = ms;
        if (ms > 0) this.onMs = ms;
    }

    /** On/off only — the duration stays the last one configured. */
    toggle(on: boolean): void {
        this.ms = on ? this.onMs : 0;
    }
}

/** Frame-rate-independent exponential approach of `current` toward `target`. */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
    if (tauMs <= 0) return target;
    return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}
