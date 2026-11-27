// A live chart on a device whose clock runs fast. Candles never land early on such a
// device, so they can't correct it: on its own the countdown runs out before every close
// and stays hidden until the next candle arrives. Given the server's time, the countdown
// reads the time left on the market's clock.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { clockCorrection } from '../src/core/util/wall-clock';
import { countdownText } from '../src/renderers/native/chrome/countdown';
import type { OHLCV } from '../src/core/model/ohlcv';

const MIN = 60_000;
const OPEN = Date.UTC(2026, 10, 26, 12, 31, 0); // the forming 07:31 ET candle
const bar = (time: number): OHLCV => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 });

/* eslint-disable @typescript-eslint/no-explicit-any -- the renderer is unmounted; the test stubs its frame loop */
function chartEndingAt(newestOpen: number): NativeRenderer {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1);
    anyR.scheduler = { invalidate: () => {} };
    anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    r.setBars(Array.from({ length: 100 }, (_, i) => bar(newestOpen - (99 - i) * MIN)));
    return r;
}

afterEach(async () => {
    vi.useRealTimers();
    await clockCorrection.setServerTimeSource(null);
    clockCorrection.reset();
});

describe('a fast device clock on a live chart', () => {
    it('ends the countdown 22 s early on its own, and runs it to the close once the server answers', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const market = OPEN + 38_000; // 07:31:38 on the market's clock
        vi.setSystemTime(market + 22_000); // the device already reads 07:32:00
        const r = chartEndingAt(OPEN);
        r.updateBar({ ...bar(OPEN), close: 1.7 }); // a live tick on the forming candle
        expect(countdownText(OPEN, MIN, clockCorrection.now())).toBeNull();
        await clockCorrection.setServerTimeSource(async () => market);
        expect(countdownText(OPEN, MIN, clockCorrection.now())).toBe('00:22');
    });

    it('a live candle never pushes a fast clock further ahead', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(OPEN + MIN + 2_200 + 22_000); // the 07:32 candle lands 2.2 s after the minute
        await clockCorrection.setServerTimeSource(async () => OPEN + MIN + 2_200);
        const r = chartEndingAt(OPEN);
        r.updateBar(bar(OPEN + MIN));
        expect(countdownText(OPEN + MIN, MIN, clockCorrection.now())).toBe('00:58');
    });
});
