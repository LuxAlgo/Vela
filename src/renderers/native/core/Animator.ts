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

/** Frame-rate-independent exponential approach of `current` toward `target`. */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
    if (tauMs <= 0) return target;
    return current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}
