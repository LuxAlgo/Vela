import type { Unsubscribe } from './types';

/**
 * A once-per-second wall-clock pulse. Every subscriber receives the SAME `now` for a
 * given second, so chrome that displays time (a bottom-bar clock, a countdown-to-bar-close
 * chip) can be driven from one source and never disagrees about which second it is.
 */
export interface WallClock {
    /** Called shortly after every wall-clock second boundary with that instant (epoch ms). */
    onTick(cb: (now: number) => void): Unsubscribe;
}

/** Headroom past the boundary so a timer that fires a hair early still lands in the new second. */
const BOUNDARY_SLACK_MS = 5;

/**
 * A {@link WallClock} aligned to the wall clock's second boundaries. Free-running
 * `setInterval(1000)` timers start at an arbitrary sub-second phase and slide against
 * each other, so two of them sample different seconds part of the time; this one
 * re-arms a `setTimeout` to the NEXT boundary after every tick, so it fires just past
 * `hh:mm:ss.000` regardless of when it was started or how long the callback took (a
 * throttled background tab simply skips seconds — it never drifts). Runs only while it
 * has subscribers: zero idle timers when nothing displays time.
 */
export class SecondClock implements WallClock {
    private readonly subs = new Set<(now: number) => void>();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly now: () => number = () => Date.now()) {}

    onTick(cb: (now: number) => void): Unsubscribe {
        this.subs.add(cb);
        if (this.timer == null) this.arm();
        return () => {
            this.subs.delete(cb);
            if (this.subs.size === 0 && this.timer != null) {
                clearTimeout(this.timer);
                this.timer = null;
            }
        };
    }

    /** Milliseconds from `now` to just past the next second boundary. */
    static delayToNextSecond(now: number): number {
        const intoSecond = ((now % 1000) + 1000) % 1000;
        return 1000 - intoSecond + BOUNDARY_SLACK_MS;
    }

    private arm(): void {
        this.timer = setTimeout(() => {
            this.timer = null;
            const now = this.now();
            for (const cb of this.subs) cb(now);
            if (this.subs.size > 0) this.arm();
        }, SecondClock.delayToNextSecond(this.now()));
    }
}
