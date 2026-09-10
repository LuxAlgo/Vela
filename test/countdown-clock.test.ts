// The countdown-to-bar-close chip and the second pulse it ticks on. Two things a user
// can see go wrong: the chip disagreeing with a whole-second clock next to it (a
// free-running 1 Hz timer samples a different second part of the time, and flooring
// the remainder reads one second low all the time), and the chip parking at `00:00`
// after the bar closed. DOM-free — node env.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { countdownText, formatCountdown } from '../src/renderers/native/chrome/countdown';
import { SecondClock } from '../src/core/util/wall-clock';

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
