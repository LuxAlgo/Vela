// The countdown-to-bar-close chip and the second pulse it ticks on. Two things a user
// can see go wrong: the chip disagreeing with a whole-second clock next to it (a
// free-running 1 Hz timer samples a different second part of the time, and flooring
// the remainder reads one second low all the time), the chip parking at `00:00`
// after the bar closed, and (on a device whose clock runs slow) the chip jumping up a
// minute as the next candle lands. DOM-free — node env.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { countdownText, formatCountdown } from '../src/renderers/native/chrome/countdown';
import { ClockCorrection, SecondClock, clockCorrection } from '../src/core/util/wall-clock';

const MIN = 60_000;
const T0 = Date.UTC(2026, 8, 9, 14, 44, 0); // a 1-minute bar opening at 14:44:00

describe('countdownText', () => {
    it('agrees with a whole-second clock for the entire second', () => {
        // The clock reads :54 for all of [54.000, 55.000) — 6 s to the minute.
        expect(countdownText(T0, MIN, T0 + 54_000)).toBe('00:06');
        expect(countdownText(T0, MIN, T0 + 54_500)).toBe('00:06');
        expect(countdownText(T0, MIN, T0 + 54_999)).toBe('00:06');
        expect(countdownText(T0, MIN, T0 + 55_000)).toBe('00:05');
    });

    it('reads 00:01 through the last second and disappears once the bar has closed', () => {
        expect(countdownText(T0, MIN, T0 + 59_000)).toBe('00:01');
        expect(countdownText(T0, MIN, T0 + 59_999)).toBe('00:01');
        expect(countdownText(T0, MIN, T0 + MIN)).toBeNull();
        expect(countdownText(T0, MIN, T0 + MIN + 4_000)).toBeNull(); // the next bar hasn't arrived
    });

    it('shows the full interval at the bar open', () => {
        expect(countdownText(T0, MIN, T0)).toBe('01:00');
        expect(countdownText(T0, 4 * 60 * MIN, T0)).toBe('4:00:00');
    });

    it('is hidden without a known bar cadence', () => {
        expect(countdownText(T0, 0, T0 + 1000)).toBeNull();
        expect(countdownText(T0, NaN, T0 + 1000)).toBeNull();
    });
});

describe('formatCountdown', () => {
    it('rounds the remainder up and pads to MM:SS / H:MM:SS', () => {
        expect(formatCountdown(5_500)).toBe('00:06');
        expect(formatCountdown(6_000)).toBe('00:06');
        expect(formatCountdown(1)).toBe('00:01');
        expect(formatCountdown(0)).toBe('00:00');
        expect(formatCountdown(-1)).toBe('00:00');
        expect(formatCountdown(3_600_000 + 65_000)).toBe('1:01:05');
    });
});

describe('SecondClock', () => {
    afterEach(() => vi.useRealTimers());

    it('fires just past every wall-clock second boundary, whenever it was started', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0 + 54_370); // started mid-second
        const clock = new SecondClock();
        const seen: number[] = [];
        const off = clock.onTick((now) => seen.push(now));

        vi.advanceTimersByTime(600);
        expect(seen).toEqual([]); // still inside :54
        vi.advanceTimersByTime(100);
        expect(seen).toEqual([T0 + 55_005]);
        vi.advanceTimersByTime(3_000);
        expect(seen).toEqual([T0 + 55_005, T0 + 56_005, T0 + 57_005, T0 + 58_005]);
        off();
    });

    it('hands every subscriber the same instant, so they read the same second', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0 + 54_370);
        const clock = new SecondClock();
        const a: number[] = [];
        const b: number[] = [];
        const offA = clock.onTick((now) => a.push(now));
        const offB = clock.onTick((now) => b.push(now));
        vi.advanceTimersByTime(2_500);
        expect(a).toEqual(b);
        expect(a.length).toBe(2);
        // A chip and a clock fed by the same tick agree: :55 ⇔ 00:05.
        expect(countdownText(T0, MIN, a[0]!)).toBe('00:05');
        expect(new Date(a[0]!).getUTCSeconds()).toBe(55);
        offA();
        offB();
    });

    it('runs only while it has subscribers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        const clock = new SecondClock();
        expect(vi.getTimerCount()).toBe(0);
        const off = clock.onTick(() => undefined);
        expect(vi.getTimerCount()).toBe(1);
        off();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(5_000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('re-aligns after a late tick instead of carrying the lag forward', () => {
        vi.useFakeTimers();
        let now = T0;
        const clock = new SecondClock(() => now);
        const seen: number[] = [];
        clock.onTick((t) => seen.push(t));
        // The timer fires 700 ms late (a busy main thread): the tick reports the late
        // instant, and the NEXT one is armed from it — 305 ms to the :02 boundary, not
        // a full second that would land at :02.705 and stay 700 ms late forever.
        now = T0 + 1_700;
        vi.advanceTimersByTime(1_005);
        expect(seen).toEqual([T0 + 1_700]);
        now = T0 + 2_005;
        vi.advanceTimersByTime(304);
        expect(seen.length).toBe(1);
        vi.advanceTimersByTime(1);
        expect(seen).toEqual([T0 + 1_700, T0 + 2_005]);
    });
});

// A device clock running slow: candles open on the exchange's clock, so the next candle
// lands while this device still reads the old minute. Reported on MNQ1! and BTCUSDT 1m:
// the countdown jumped from 00:04 to 01:04 as the candle arrived, then read 4 s high.
describe('ClockCorrection', () => {
    const DAY = 24 * 60 * MIN;
    const NEXT = T0 + MIN; // the 14:45:00 candle

    /** A device clock and a monotonic clock that tick together unless the device clock is set. */
    function device(startMs: number) {
        let deviceMs = startMs;
        let monoMs = 1_000;
        const correction = new ClockCorrection(
            () => deviceMs,
            () => monoMs,
        );
        return {
            correction,
            get deviceMs() {
                return deviceMs;
            },
            pass(ms: number) {
                deviceMs += ms;
                monoMs += ms;
            },
            setDeviceClock(ms: number) {
                deviceMs = ms;
            },
        };
    }

    it('reads the device clock until a candle proves it slow', () => {
        const d = device(T0 + 30_000);
        expect(d.correction.offsetMs).toBe(0);
        expect(d.correction.now()).toBe(T0 + 30_000);
    });

    it('a candle that lands before the device clock reaches its open shows 01:00, not 01:04', () => {
        // The 14:45 candle lands 2.2 s after the minute; the device runs 6 s slow, so it reads 14:44:56.2.
        const d = device(NEXT + 2_200 - 6_000);
        expect(countdownText(NEXT, MIN, d.deviceMs)).toBe('01:04'); // what the chip read before
        d.correction.observeCandle(NEXT, MIN);
        expect(d.correction.offsetMs).toBe(3_800);
        expect(countdownText(NEXT, MIN, d.correction.now())).toBe('01:00');
    });

    it('counts the rest of the minute down to 00:01 and hides as the next candle is due', () => {
        const d = device(NEXT + 2_200 - 6_000);
        d.correction.observeCandle(NEXT, MIN);
        d.pass(59_000);
        expect(countdownText(NEXT, MIN, d.correction.now())).toBe('00:01');
        d.pass(1_000);
        expect(countdownText(NEXT, MIN, d.correction.now())).toBeNull();
    });

    it('keeps the largest lag proven, so a slower feed does not pull it back', () => {
        const d = device(NEXT - 3_800);
        d.correction.observeCandle(NEXT, MIN); // a fast feed: 3.8 s ahead
        d.pass(60_000);
        d.correction.observeCandle(NEXT + MIN, MIN); // a slow feed proves less this time
        expect(d.correction.offsetMs).toBe(3_800);
    });

    it('learns nothing from a candle that lands after its open (a correct or fast clock)', () => {
        const d = device(NEXT + 300);
        d.correction.observeCandle(NEXT, MIN);
        expect(d.correction.offsetMs).toBe(0);
        expect(d.correction.now()).toBe(NEXT + 300);
    });

    it('learns nothing from daily candles, which can be dated ahead by trading day', () => {
        // A futures daily that opens the evening before carries the next date.
        const d = device(NEXT - 30_000);
        d.correction.observeCandle(NEXT, DAY);
        expect(d.correction.offsetMs).toBe(0);
    });

    it('learns nothing from a gap over 2 minutes: that is the feed, not the device', () => {
        const d = device(NEXT - 10 * MIN);
        d.correction.observeCandle(NEXT, MIN);
        expect(d.correction.offsetMs).toBe(0);
        d.correction.observeCandle(NEXT, 0); // no known cadence
        d.correction.observeCandle(Number.NaN, MIN);
        expect(d.correction.offsetMs).toBe(0);
    });

    it('keeps the lag as time passes', () => {
        const d = device(NEXT - 3_800);
        d.correction.observeCandle(NEXT, MIN);
        d.pass(45 * MIN);
        expect(d.correction.offsetMs).toBe(3_800);
    });

    it('forgets the lag when the device clock is set or the machine sleeps', () => {
        const d = device(NEXT - 3_800);
        d.correction.observeCandle(NEXT, MIN);
        d.setDeviceClock(d.deviceMs + 3_800); // the OS syncs the clock
        expect(d.correction.offsetMs).toBe(0);
        expect(d.correction.now()).toBe(NEXT);
        d.pass(MIN + 150);
        d.correction.observeCandle(NEXT + MIN, MIN); // a correct clock now: nothing to learn
        expect(d.correction.offsetMs).toBe(0);
    });

    it('a sub-second wobble between the clocks is not a clock change', () => {
        const d = device(NEXT - 3_800);
        d.correction.observeCandle(NEXT, MIN);
        d.setDeviceClock(d.deviceMs + 400);
        expect(d.correction.offsetMs).toBe(3_800);
    });

    it('reset forgets the lag', () => {
        const d = device(NEXT - 3_800);
        d.correction.observeCandle(NEXT, MIN);
        d.correction.reset();
        expect(d.correction.offsetMs).toBe(0);
    });
});

describe('the second pulse on a corrected clock', () => {
    afterEach(() => {
        vi.useRealTimers();
        clockCorrection.reset();
    });

    it('ticks on the corrected second, so the countdown and the clock beside it agree', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0 + 54_370);
        // The device runs 3.8 s slow (proven by a candle); its seconds sit 0.8 s off the market's.
        const correction = new ClockCorrection(
            () => Date.now(),
            () => Date.now(),
        );
        correction.observeCandle(T0 + 58_170, MIN);
        expect(correction.offsetMs).toBe(3_800);
        const clock = new SecondClock(() => correction.now());
        const seen: number[] = [];
        const off = clock.onTick((now) => seen.push(now));
        vi.advanceTimersByTime(3_000);
        // Corrected time ran from 14:44:58.170; ticks land just past :59, :00, :01.
        expect(seen).toEqual([T0 + 59_005, T0 + 60_005, T0 + 61_005]);
        expect(countdownText(T0, MIN, seen[0]!)).toBe('00:01');
        expect(new Date(seen[0]!).getUTCSeconds()).toBe(59);
        off();
    });

    it('a pulse made without a clock of its own reads the corrected clock', () => {
        vi.useFakeTimers();
        vi.setSystemTime(T0 + 54_370);
        const read = vi.spyOn(clockCorrection, 'now');
        const off = new SecondClock().onTick(() => undefined);
        vi.advanceTimersByTime(1_000);
        expect(read).toHaveBeenCalled();
        off();
        read.mockRestore();
    });
});
