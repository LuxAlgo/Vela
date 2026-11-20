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

/** The most a candle can prove the device clock slow by. A bigger gap points at the
 *  candle's own time (a feed with bad timestamps), not at this device. */
const MAX_CORRECTION_MS = 2 * 60_000;

/** The longest candle that may teach the correction. Daily and longer candles can be dated
 *  by trading day — a futures daily that opens the evening before carries the next date —
 *  so they sit ahead of a correct clock and prove nothing about it. */
const MAX_LEARNING_INTERVAL_MS = 60 * 60_000;

/** A change this big between the device clock and the monotonic clock means the device
 *  clock was set (an OS time sync, a manual change) or the machine slept. */
const CLOCK_STEP_MS = 1_000;

const monotonicNow = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * The device clock, corrected by what live candles prove about it. Time chrome (the
 * countdown to bar close, the bottom-bar clock) reads this device's clock, but candles
 * open on the exchange's. On a device running a few seconds slow, the next candle lands
 * while the clock still reads before its open time, so a 1-minute countdown read `01:04`
 * the moment it arrived and stayed those seconds high all minute.
 *
 * A candle can't arrive before it opens, so one whose open time is still ahead of the
 * device clock when it arrives proves the clock is slow by at least that gap. The
 * correction keeps the largest gap seen and adds it to the device clock. A correct or fast
 * clock leaves no trace in candle times and reads unchanged (a fast clock still hides the
 * countdown a moment early, until the next candle arrives). It learns only from intraday
 * candles and only gaps up to {@link MAX_CORRECTION_MS}, and it forgets what it learned
 * when the device clock is set or the machine sleeps: the old gap no longer applies.
 */
export class ClockCorrection {
    /** How far behind the device clock is proven to run, in ms (0: nothing proves it slow). */
    private behindMs = 0;
    /** Device clock minus monotonic clock at the last read: a jump in it is a clock step. */
    private skew: number | null = null;

    constructor(
        private readonly deviceNow: () => number = () => Date.now(),
        private readonly monotonic: () => number = monotonicNow,
    ) {}

    /** A candle opening at `openMs`, on an `intervalMs` cadence, has just arrived. */
    observeCandle(openMs: number, intervalMs: number): void {
        if (!Number.isFinite(openMs) || !(intervalMs > 0) || intervalMs > MAX_LEARNING_INTERVAL_MS) return;
        const ahead = openMs - this.readDevice();
        if (ahead > this.behindMs && ahead <= MAX_CORRECTION_MS) this.behindMs = ahead;
    }

    /** How many ms the device clock is proven to run behind (0 when nothing proves it slow). */
    get offsetMs(): number {
        this.readDevice();
        return this.behindMs;
    }

    /** The corrected time (epoch ms): the device clock plus the proven lag. */
    now(): number {
        return this.readDevice() + this.behindMs;
    }

    /** Forget what was learned. */
    reset(): void {
        this.behindMs = 0;
        this.skew = null;
    }

    /** Read the device clock, dropping the correction when the clock was set or the machine slept. */
    private readDevice(): number {
        const device = this.deviceNow();
        const skew = device - this.monotonic();
        if (this.skew !== null && Math.abs(skew - this.skew) > CLOCK_STEP_MS) this.behindMs = 0;
        this.skew = skew;
        return device;
    }
}

/** The page's one correction: every chart teaches it and every time display reads it. */
export const clockCorrection = new ClockCorrection();

/**
 * A {@link WallClock} aligned to the wall clock's second boundaries. Free-running
 * `setInterval(1000)` timers start at an arbitrary sub-second phase and slide against
 * each other, so two of them sample different seconds part of the time; this one
 * re-arms a `setTimeout` to the NEXT boundary after every tick, so it fires just past
 * `hh:mm:ss.000` regardless of when it was started or how long the callback took (a
 * throttled background tab simply skips seconds — it never drifts). Runs only while it
 * has subscribers: zero idle timers when nothing displays time. Its seconds are those of
 * the corrected clock ({@link clockCorrection}) unless it is given another.
 */
export class SecondClock implements WallClock {
    private readonly subs = new Set<(now: number) => void>();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly now: () => number = () => clockCorrection.now()) {}

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
