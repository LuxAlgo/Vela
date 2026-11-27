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

/** The slowest server answer worth trusting: it can be off by up to half its round trip. */
const MAX_ROUND_TRIP_MS = 5_000;

/** A round trip this short is precise enough: no further sample is asked for. */
const PRECISE_ROUND_TRIP_MS = 100;

/** Answers asked for per sync; the one with the shortest round trip is kept (the first
 *  request of a page often pays for opening the connection). */
const SAMPLES_PER_SYNC = 3;

/** Ask the server again after this long: device clocks drift between OS time syncs. */
const RESYNC_MS = 30 * 60_000;

/** After an ask fails (the server is down, the page is offline), wait this long to ask again. */
const RETRY_MS = 60_000;

/** An answer further than this from the device clock is a broken answer (seconds instead of
 *  milliseconds), not a device clock that far off. */
const MAX_SERVER_OFFSET_MS = 30 * 24 * 60 * 60_000;

const monotonicNow = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** Asks the host's server for its current time: resolves with epoch milliseconds, rejects when it can't. */
export type ServerTimeSource = () => Promise<number>;

/**
 * The device clock, corrected to the time candles open on. Time chrome (the countdown to
 * bar close, the bottom-bar clock) reads this device's clock, but candles open on the
 * exchange's, so a device clock that runs off shows a countdown that is off by as much: a
 * clock 20 s fast ends every 1-minute countdown 20 s early and hides it until the next
 * candle arrives; a clock 4 s slow shows `01:04` the moment the next candle lands.
 *
 * With a server time source ({@link ClockCorrection.setServerTimeSource}) it reads the
 * server's time: it asks once, splits each answer's round trip in half, and keeps the
 * answer with the shortest round trip. It asks again after the device clock is set or the
 * machine sleeps, every {@link RESYNC_MS}, and a minute after an ask fails.
 *
 * Without one, or until the server answers, live candles teach it what they can: a candle
 * can't arrive before it opens, so one whose open time is still ahead of the clock when
 * it arrives proves the clock slow by at least that gap. It keeps the largest gap seen
 * (intraday candles only, gaps up to {@link MAX_CORRECTION_MS}) and adds it. A fast clock
 * leaves no trace in candle times, so only a server can correct one. Everything learned is
 * forgotten when the device clock is set or the machine sleeps: it no longer applies.
 */
export class ClockCorrection {
    /** How far behind the server-corrected clock candles prove it runs, in ms (0: nothing proves it slow). */
    private behindMs = 0;
    /** Device clock minus monotonic clock at the last read: a jump in it is a clock step. */
    private skew: number | null = null;
    /** The server's time minus the device's, from the answer in use (null: none yet). */
    private serverOffset: number | null = null;
    /** The round trip of the answer in use: half of it bounds that answer's error. */
    private serverRoundTrip = Infinity;
    /** Monotonic time the answer in use arrived, and the last ask started (null: never). */
    private syncedAt: number | null = null;
    private askedAt: number | null = null;
    private source: ServerTimeSource | null = null;
    private syncing: Promise<void> | null = null;
    /** Bumped when the source changes or the device clock steps: answers to earlier asks are dropped. */
    private epoch = 0;

    constructor(
        private readonly deviceNow: () => number = () => Date.now(),
        private readonly monotonic: () => number = monotonicNow,
    ) {}

    /** A candle opening at `openMs`, on an `intervalMs` cadence, has just arrived. */
    observeCandle(openMs: number, intervalMs: number): void {
        if (!Number.isFinite(openMs) || !(intervalMs > 0) || intervalMs > MAX_LEARNING_INTERVAL_MS) return;
        const ahead = openMs - (this.readDevice() + (this.serverOffset ?? 0));
        if (ahead > this.behindMs && ahead <= MAX_CORRECTION_MS) this.behindMs = ahead;
    }

    /**
     * Read the time from the host's server instead of trusting this device's clock: the
     * library's answer to a device clock that runs fast, which candles can't prove. The
     * source is asked right away (the returned promise settles when that first ask is
     * done, answered or not) and again as described on the class. `null` goes back to the
     * device clock.
     */
    setServerTimeSource(source: ServerTimeSource | null): Promise<void> {
        this.source = source;
        this.forgetServer();
        this.behindMs = 0;
        return source ? this.sync() : Promise.resolve();
    }

    /**
     * One answer from the server, for a host that already receives the server's time (a
     * socket's greeting, say): `serverMs` is the server's time (epoch ms) and `roundTripMs`
     * how long the exchange took. Call it the moment the answer arrives. Returns whether
     * the answer was used: one slower than {@link MAX_ROUND_TRIP_MS}, one that isn't a time
     * in milliseconds, or one less precise than a recent answer is ignored.
     */
    observeServerTime(serverMs: number, roundTripMs: number): boolean {
        if (!Number.isFinite(serverMs) || !Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > MAX_ROUND_TRIP_MS) return false;
        const offset = serverMs + roundTripMs / 2 - this.readDevice();
        if (Math.abs(offset) > MAX_SERVER_OFFSET_MS) return false;
        const recent = this.syncedAt !== null && this.monotonic() - this.syncedAt < RESYNC_MS;
        if (recent && roundTripMs > this.serverRoundTrip) return false;
        this.serverOffset = offset;
        this.serverRoundTrip = roundTripMs;
        this.syncedAt = this.monotonic();
        // What candles proved was measured against the clock this answer replaces.
        this.behindMs = 0;
        return true;
    }

    /** How far the corrected clock is from the device clock, in ms: positive when the device runs slow, negative when it runs fast. */
    get offsetMs(): number {
        this.readDevice();
        return (this.serverOffset ?? 0) + this.behindMs;
    }

    /** The corrected time (epoch ms): the server's time when it has answered, plus any lag candles prove. */
    now(): number {
        const device = this.readDevice();
        this.syncIfDue();
        return device + (this.serverOffset ?? 0) + this.behindMs;
    }

    /** Forget what was learned (the next read asks the server again, when there is one). */
    reset(): void {
        this.behindMs = 0;
        this.skew = null;
        this.forgetServer();
    }

    private forgetServer(): void {
        this.epoch++;
        this.serverOffset = null;
        this.serverRoundTrip = Infinity;
        this.syncedAt = null;
        this.askedAt = null;
        this.syncing = null;
    }

    /** Ask the server when no answer is in use, or when the one in use is old. */
    private syncIfDue(): void {
        if (!this.source || this.syncing) return;
        const since = (at: number | null): number => (at === null ? Infinity : this.monotonic() - at);
        const due = this.serverOffset === null ? since(this.askedAt) >= RETRY_MS : since(this.syncedAt) >= RESYNC_MS;
        if (due) void this.sync();
    }

    /** Ask the source up to {@link SAMPLES_PER_SYNC} times, stopping at a precise answer or a failure. */
    private sync(): Promise<void> {
        const source = this.source;
        if (!source) return Promise.resolve();
        if (this.syncing) return this.syncing;
        const epoch = this.epoch;
        this.askedAt = this.monotonic();
        const run = async (): Promise<void> => {
            for (let i = 0; i < SAMPLES_PER_SYNC; i++) {
                const sentAt = this.monotonic();
                let serverMs: number;
                try {
                    serverMs = await source();
                } catch {
                    return; // asked again after RETRY_MS
                }
                if (epoch !== this.epoch) return; // a new source, or the device clock stepped mid-ask
                const roundTrip = this.monotonic() - sentAt;
                this.observeServerTime(serverMs, roundTrip);
                if (roundTrip <= PRECISE_ROUND_TRIP_MS) return;
            }
        };
        const syncing: Promise<void> = run().finally(() => {
            if (this.syncing === syncing) this.syncing = null;
        });
        this.syncing = syncing;
        return syncing;
    }

    /** Read the device clock, dropping everything learned when the clock was set or the machine slept. */
    private readDevice(): number {
        const device = this.deviceNow();
        const skew = device - this.monotonic();
        if (this.skew !== null && Math.abs(skew - this.skew) > CLOCK_STEP_MS) {
            this.behindMs = 0;
            this.forgetServer();
        }
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
