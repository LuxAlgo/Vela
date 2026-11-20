// The live-bar path teaches the page's clock correction. A candle that lands while this
// device's clock still reads before its open proves the clock slow, and the correction is
// learned before the frame that paints the candle, so the countdown never reads 01:04.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { clockCorrection } from '../src/core/util/wall-clock';
import { countdownText } from '../src/renderers/native/chrome/countdown';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;
const OPEN = Date.UTC(2026, 10, 20, 14, 31, 0); // the forming 14:31 candle
const bar = (time: number): OHLCV => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

/* eslint-disable @typescript-eslint/no-explicit-any -- the renderer is unmounted; the test stubs its frame loop */
function chartEndingAt(newestOpen: number, interval = MIN): NativeRenderer {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1);
    anyR.scheduler = { invalidate: () => {} };
    anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    r.setBars(Array.from({ length: 100 }, (_, i) => bar(newestOpen - (99 - i) * interval)));
    return r;
}

afterEach(() => {
    vi.useRealTimers();
    clockCorrection.reset();
});

describe('a slow device clock on a live chart', () => {
    it('the next candle landing early on this device shows 01:00, not 01:04', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        // The 14:32 candle lands 2.2 s after the minute; the device runs 6 s slow.
        vi.setSystemTime(OPEN + MIN + 2_200 - 6_000);
        const r = chartEndingAt(OPEN);
        expect(clockCorrection.offsetMs).toBe(0); // the 14:31 candle proved nothing
        r.updateBar(bar(OPEN + MIN));
        expect(clockCorrection.offsetMs).toBe(3_800);
        expect(countdownText(OPEN + MIN, MIN, Date.now())).toBe('01:04'); // the device clock alone
        expect(countdownText(OPEN + MIN, MIN, clockCorrection.now())).toBe('01:00');
    });

    it('a tick on the forming candle teaches nothing', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(OPEN + 30_000);
        const r = chartEndingAt(OPEN);
        r.updateBar({ ...bar(OPEN), close: 1.8 });
        expect(clockCorrection.offsetMs).toBe(0);
    });

    it('a history load whose newest candle is ahead of the device clock teaches it too', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(OPEN - 2_000); // opened on a device 2+ s slow, just after the minute
        chartEndingAt(OPEN);
        expect(clockCorrection.offsetMs).toBe(2_000);
    });

    it('replaying history teaches nothing', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(OPEN + 5 * 24 * 60 * MIN);
        const r = chartEndingAt(OPEN);
        r.updateBar(bar(OPEN + MIN));
        expect(clockCorrection.offsetMs).toBe(0);
    });

    it('a daily chart teaches nothing', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(OPEN - 30_000);
        chartEndingAt(OPEN, 24 * 60 * MIN);
        expect(clockCorrection.offsetMs).toBe(0);
    });
});
