// @vitest-environment jsdom
// Day, week and month bars are stamped at 00:00 UTC of their trading date: a date, not an
// instant. Every surface that shows a coarse bar's date must read it in UTC whatever the
// display zone, while intraday bars keep reading in the display zone.
import { describe, it, expect } from 'vitest';
import { formatTimeStamp, timeTicks } from '../src/renderers/native/chrome/ticks';
import { displayZone, tzOffsetMs } from '../src/renderers/native/chrome/tz';
import { EXCHANGE_TIMEZONE, resolveTimezone } from '../src/core/timezones';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { CrosshairRenderer } from '../src/renderers/native/chrome/CrosshairRenderer';
import { BackdropRenderer } from '../src/renderers/native/backdrop/BackdropRenderer';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { DARK_THEME } from '../src/core/theme';
import type { OHLCV } from '../src/core/model/ohlcv';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const CHICAGO_EXCHANGE = resolveTimezone(EXCHANGE_TIMEZONE, 'America/Chicago');
const ZONES = ['America/New_York', 'Asia/Tokyo', 'UTC', 'Etc/UTC', CHICAGO_EXCHANGE];

const friday23Oct = Date.UTC(2026, 9, 23);

describe('displayZone', () => {
    it('reads bars of a day or longer in UTC and intraday bars in the display zone', () => {
        expect(displayZone('America/New_York', DAY)).toBe('UTC');
        expect(displayZone('America/New_York', 2 * DAY)).toBe('UTC');
        expect(displayZone('Asia/Tokyo', WEEK)).toBe('UTC');
        expect(displayZone('America/Chicago', 3 * MONTH)).toBe('UTC');
        expect(displayZone('America/New_York', 12 * HOUR)).toBe('America/New_York');
        expect(displayZone('America/New_York', HOUR)).toBe('America/New_York');
    });

    it('keeps the display zone while the bar interval is unknown (no bars yet)', () => {
        expect(displayZone('America/New_York', 0)).toBe('America/New_York');
    });
});

describe('formatTimeStamp on coarse bars', () => {
    it("reads a daily bar's UTC date in every display zone", () => {
        for (const zone of ZONES) expect(formatTimeStamp(friday23Oct, zone, DAY), zone).toBe("Fri 23 Oct '26");
    });

    it('applies the same rule to custom day, week and month counts', () => {
        for (const interval of [2 * DAY, 3 * DAY, 2 * WEEK, 3 * MONTH]) {
            expect(formatTimeStamp(friday23Oct, 'America/New_York', interval), String(interval)).toBe("Fri 23 Oct '26");
        }
    });

    it('shows a weekly bar on its Monday and a monthly bar on its 1st in every zone', () => {
        for (const zone of ZONES) {
            expect(formatTimeStamp(Date.UTC(2026, 9, 19), zone, WEEK), zone).toBe("Mon 19 Oct '26");
            expect(formatTimeStamp(Date.UTC(2026, 9, 1), zone, MONTH), zone).toBe("Thu 1 Oct '26");
        }
    });

    it('keeps converting intraday bars into the display zone', () => {
        expect(formatTimeStamp(Date.UTC(2026, 9, 23, 3, 0), 'America/New_York', HOUR)).toBe("Thu 22 Oct '26 23:00");
        expect(formatTimeStamp(Date.UTC(2026, 9, 23, 0, 0), 'America/New_York', 12 * HOUR)).toBe("Thu 22 Oct '26 20:00");
        expect(formatTimeStamp(Date.UTC(2026, 9, 23, 3, 0), CHICAGO_EXCHANGE, HOUR)).toBe("Thu 22 Oct '26 22:00");
    });
});

describe('timeTicks on a daily chart', () => {
    it("places the day ticks at the bars' UTC midnights with display zone New York", () => {
        const from = Date.UTC(2026, 9, 19);
        const to = Date.UTC(2026, 9, 28);
        const offset = tzOffsetMs((from + to) / 2, displayZone('America/New_York', DAY));
        const ticks = timeTicks(from, to, 9, offset);
        for (const d of [19, 20, 21, 22, 23, 26, 27]) {
            const tick = ticks.find((t) => t.label === `Oct ${d}`);
            expect(tick?.time, `Oct ${d}`).toBe(Date.UTC(2026, 9, d));
        }
    });
});

// ── renderer surfaces ──

/** Weekday daily bars, Mon 19 Oct → Tue 27 Oct 2026, stamped at 00:00 UTC. */
const DAILY = [19, 20, 21, 22, 23, 26, 27].map((d) => Date.UTC(2026, 9, d));
/** 48 hourly bars from Thu 22 Oct 2026 00:00 UTC. */
const HOURLY = Array.from({ length: 48 }, (_, i) => Date.UTC(2026, 9, 22) + i * HOUR);

function coordsFor(times: number[], width: number, barSpacing: number): CoordinateSystem {
    const coords = new CoordinateSystem();
    coords.setSize(width, 300, 1);
    coords.setBars(times);
    coords.setViewport({ barSpacing, rightOffset: 0 });
    return coords;
}

/** A 2d context that records drawn texts with their x and every path vertex. */
function recorder() {
    const texts: Array<{ text: string; x: number }> = [];
    const moves: Array<[number, number]> = [];
    const ctx = {
        font: '',
        textBaseline: '',
        textAlign: '',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo(x: number, y: number) { moves.push([x, y]); },
        lineTo() {},
        stroke() {},
        setLineDash() {},
        fillRect() {},
        fillText(text: string, x: number) { texts.push({ text, x }); },
        measureText: (t: string) => ({ width: t.length * 6 }),
    };
    return { ctx, texts, moves };
}

function axisLabels(times: number[], width: number, barSpacing: number, zone: string): { coords: CoordinateSystem; texts: Array<{ text: string; x: number }> } {
    const coords = coordsFor(times, width, barSpacing);
    const scene = new SceneGraph();
    scene.timezone = zone;
    const rec = recorder();
    (new ChromeRenderer() as any).drawTimeAxis(rec.ctx, scene, coords, DARK_THEME, width, 300, 328);
    return { coords, texts: rec.texts };
}

function gridLines(times: number[], width: number, barSpacing: number, zone: string): number[] {
    const coords = coordsFor(times, width, barSpacing);
    const scene = new SceneGraph();
    scene.timezone = zone;
    const rec = recorder();
    (new BackdropRenderer() as any).drawGrid(rec.ctx, scene, coords, DARK_THEME, width, 1);
    return rec.moves.filter(([, y]) => y === 0).map(([x]) => x);
}

describe('time axis and grid on a daily chart', () => {
    it("puts every day label under its bar's UTC midnight, whatever the display zone", () => {
        const utc = axisLabels(DAILY, 600, 100, 'UTC');
        expect(utc.texts.length).toBeGreaterThanOrEqual(4);
        for (const { text, x } of utc.texts) {
            const day = Number(/^Oct (\d+)$/.exec(text)?.[1]);
            expect(x, text).toBeCloseTo(utc.coords.timeToX(Date.UTC(2026, 9, day)), 6);
        }
        for (const d of [20, 21, 22, 23]) {
            expect(utc.texts.find((t) => t.text === `Oct ${d}`)?.x, `Oct ${d}`).toBeCloseTo(utc.coords.logicalToX(DAILY.indexOf(Date.UTC(2026, 9, d))), 6);
        }
        for (const zone of ZONES) expect(axisLabels(DAILY, 600, 100, zone).texts, zone).toEqual(utc.texts);
    });

    it('draws the vertical grid on the same UTC midnights in every zone', () => {
        const utc = gridLines(DAILY, 600, 100, 'UTC');
        expect(utc).toContain(Math.round(coordsFor(DAILY, 600, 100).logicalToX(1)) + 0.5);
        for (const zone of ZONES) expect(gridLines(DAILY, 600, 100, zone), zone).toEqual(utc);
    });

    it('still shifts the axis labels and the grid into the display zone on an intraday chart', () => {
        const utc = axisLabels(HOURLY, 480, 10, 'UTC');
        const ny = axisLabels(HOURLY, 480, 10, 'America/New_York');
        expect(utc.texts.find((t) => t.text === 'Oct 23')?.x).toBeCloseTo(utc.coords.timeToX(Date.UTC(2026, 9, 23, 0)), 6);
        expect(ny.texts.find((t) => t.text === 'Oct 23')?.x).toBeCloseTo(ny.coords.timeToX(Date.UTC(2026, 9, 23, 4)), 6);
        expect(gridLines(HOURLY, 480, 10, 'America/New_York')).not.toEqual(gridLines(HOURLY, 480, 10, 'UTC'));
    });
});

describe('crosshair time chip on a daily chart', () => {
    function chip(zone: string, barInterval: number, time: number): string | undefined {
        const rec = recorder();
        const canvas = { width: 400, height: 300, getContext: () => rec.ctx } as unknown as HTMLCanvasElement;
        const cr = new CrosshairRenderer();
        cr.mount(canvas);
        const scene = new SceneGraph();
        scene.timezone = zone;
        scene.crosshair = { x: 100, y: 120 };
        scene.crosshairOverride = { horizontal: false };
        scene.panes.set('price', { id: 'price', kind: 'price', bounds: { top: 0, height: 280 }, scale: { min: 0, max: 100 }, axisFormat: 'price' } as never);
        const coords = {
            dpr: 1,
            width: 380,
            height: 280,
            barInterval,
            xToLogical: (x: number) => x / 10,
            logicalToX: (l: number) => l * 10,
            logicalToTime: () => time,
            yToPrice: () => 50,
        } as unknown as CoordinateSystem;
        cr.render(scene, coords, DARK_THEME, null, null);
        return rec.texts[0]?.text;
    }

    it("reads the hovered daily bar's UTC date in every zone", () => {
        for (const zone of ZONES) expect(chip(zone, DAY, friday23Oct), zone).toBe("Fri 23 Oct '26");
    });

    it('keeps the display zone for an intraday bar', () => {
        expect(chip('America/New_York', HOUR, Date.UTC(2026, 9, 23, 3))).toBe("Thu 22 Oct '26 23:00");
    });
});

describe('data window on a daily chart', () => {
    function readout(times: number[], zone: string): { date: string; time: string } {
        const r = new NativeRenderer();
        const anyR = r as any;
        anyR.coords.setSize(800, 200, 1);
        if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
        if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
        anyR.introPlayed = true;
        r.applyFeature('timezone', zone);
        r.setBars(times.map((time): OHLCV => ({ time, open: 1, high: 2, low: 0.5, close: 1.5 })));
        const { date, time } = r.getDataWindowReadout();
        return { date, time };
    }

    it("reads the latest daily bar's UTC date in every zone", () => {
        for (const zone of ZONES) expect(readout(DAILY, zone).date, zone).toBe('2026-10-27');
    });

    it('keeps the display zone for an intraday bar', () => {
        expect(readout(HOURLY, 'America/New_York')).toEqual({ date: '2026-10-23', time: '19:00' });
    });
});
