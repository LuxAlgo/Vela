// @vitest-environment jsdom
// Day, week and month bars are stamped at 00:00 UTC of their trading date: a date, not an
// instant. Every surface that shows a coarse bar's date must read it in UTC whatever the
// display zone, while intraday bars keep reading in the display zone.
import { describe, it, expect } from 'vitest';
import { formatTimeStamp, timeTicks, viewportTimeTicks } from '../src/renderers/native/chrome/ticks';
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

function coordsFor(times: number[], width: number, barSpacing: number, rightOffset = 0): CoordinateSystem {
    const coords = new CoordinateSystem();
    coords.setSize(width, 300, 1);
    coords.setBars(times);
    coords.setViewport({ barSpacing, rightOffset });
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

function axisLabels(times: number[], width: number, barSpacing: number, zone: string, rightOffset = 0): { coords: CoordinateSystem; texts: Array<{ text: string; x: number }> } {
    const coords = coordsFor(times, width, barSpacing, rightOffset);
    const scene = new SceneGraph();
    scene.timezone = zone;
    const rec = recorder();
    (new ChromeRenderer() as any).drawTimeAxis(rec.ctx, scene, coords, DARK_THEME, width, 300, 328);
    return { coords, texts: rec.texts };
}

function gridLines(times: number[], width: number, barSpacing: number, zone: string, rightOffset = 0): number[] {
    const coords = coordsFor(times, width, barSpacing, rightOffset);
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

describe('time axis and grid across a compressed intraday gap', () => {
    it('skips the clock ticks inside a break while keeping the bar positions and neighboring ticks', () => {
        const minute = HOUR / 60;
        const lastMorning = Date.UTC(2026, 10, 20, 3, 30); // 11:30 in the display zone
        const firstAfternoon = Date.UTC(2026, 10, 20, 5, 1);
        const bars = [
            ...Array.from({ length: 120 }, (_, i) => lastMorning - (119 - i) * minute),
            ...Array.from({ length: 120 }, (_, i) => firstAfternoon + i * minute),
        ];
        const zone = 'Asia/Shanghai';
        const { coords, texts } = axisLabels(bars, 960, 4, zone);
        const lines = gridLines(bars, 960, 4, zone);
        expect(coords.timeToX(firstAfternoon) - coords.timeToX(lastMorning)).toBe(4);

        const labels = texts.map(({ text }) => text);
        const gridX = (hour: number) => Math.round(coords.timeToX(Date.UTC(2026, 10, 20, hour - 8))) + 0.5;
        for (const [hour, label] of [[11, '11:00'], [14, '14:00']] as const) {
            expect(labels).toContain(label);
            expect(lines).toContain(gridX(hour));
        }
        for (const [hour, label] of [[12, '12:00'], [13, '13:00']] as const) {
            expect(labels).not.toContain(label);
            expect(lines).not.toContain(gridX(hour));
        }
    });

    it('skips a break shorter than one bar while keeping ticks inside ordinary bars', () => {
        const day = Date.UTC(2026, 10, 20);
        const bars = [9, 10, 11, 12.5, 13.5, 14.5].map((hour) => day + hour * HOUR);
        const { coords, texts } = axisLabels(bars, 720, 120, 'UTC');
        const lines = gridLines(bars, 720, 120, 'UTC');
        const gridX = (hour: number) => Math.round(coords.timeToX(day + hour * HOUR)) + 0.5;
        expect(texts.map(({ text }) => text)).not.toContain('12:00');
        expect(lines).not.toContain(gridX(12));
        expect(texts.map(({ text }) => text)).toContain('13:00');
        expect(lines).toContain(gridX(13));
    });

    it('keeps exactly midnight as the calendar boundary on a seconds chart', () => {
        const midnight = Date.UTC(2026, 10, 21);
        const bars = [-40, -35, -30, -25, -20, 45, 50, 55, 60, 65].map((seconds) => midnight + 1000 * seconds);
        const { coords, texts } = axisLabels(bars, 800, 80, 'UTC');
        const lines = gridLines(bars, 800, 80, 'UTC');
        const gridX = (seconds: number) => Math.round(coords.timeToX(midnight + 1000 * seconds)) + 0.5;
        expect(lines).toContain(gridX(0));
        expect(lines).not.toContain(gridX(15));
        expect(lines).not.toContain(gridX(30));
        expect(texts.some(({ x }) => x === coords.timeToX(midnight))).toBe(true);
    });

    it('shares the date nearest the next bar across a compressed weekend', () => {
        const fridayClose = Date.UTC(2026, 10, 13, 7); // 15:00 Friday in the display zone
        const mondayOpen = Date.UTC(2026, 10, 16, 1, 35);
        const interval = HOUR / 12;
        const bars = [
            ...Array.from({ length: 48 }, (_, i) => fridayClose + (i - 47) * interval),
            ...Array.from({ length: 48 }, (_, i) => mondayOpen + i * interval),
        ];
        const zone = 'Asia/Shanghai';
        const { coords, texts } = axisLabels(bars, 960, 13.5, zone);
        const lines = gridLines(bars, 960, 13.5, zone);
        const left = coords.timeToX(fridayClose);
        const right = coords.timeToX(mondayOpen);
        const labelX = coords.timeToX(Date.UTC(2026, 10, 15, 16));
        expect(right - left).toBe(13.5);
        expect(texts.filter(({ x }) => x > left && x < right).map(({ text }) => text)).toEqual(['Nov 16']);
        expect(lines.filter((x) => x > left && x <= right + 0.5)).toEqual([Math.round(labelX) + 0.5]);
    });

    it('shares the same date in a narrow chart across a longer holiday', () => {
        const lastBar = Date.UTC(2026, 9, 2, 7);
        const nextBar = Date.UTC(2026, 9, 12, 1, 35);
        const interval = HOUR / 12;
        const bars = [
            ...Array.from({ length: 16 }, (_, i) => lastBar + (i - 15) * interval),
            ...Array.from({ length: 10 }, (_, i) => nextBar + i * interval),
        ];
        const zone = 'Asia/Shanghai';
        const { coords, texts } = axisLabels(bars, 300, 13.5, zone);
        const lines = gridLines(bars, 300, 13.5, zone);
        const left = coords.timeToX(lastBar);
        const right = coords.timeToX(nextBar);
        const labelX = coords.timeToX(Date.UTC(2026, 9, 11, 16));
        expect(texts.filter(({ x }) => x > left && x < right).map(({ text }) => text)).toEqual(['Oct 12']);
        expect(lines.filter((x) => x > left && x <= right + 0.5)).toEqual([Math.round(labelX) + 0.5]);
    });

    it.each([
        { zone: 'UTC', offset: 0, barSpacing: 90 },
        { zone: 'Asia/Shanghai', offset: 8 * HOUR, barSpacing: 91 },
    ])('shows the midnight reopening date in $zone', ({ zone, offset, barSpacing }) => {
        const fridayClose = Date.UTC(2026, 10, 13, 18) - offset;
        const mondayOpen = Date.UTC(2026, 10, 16) - offset;
        const bars = [
            ...Array.from({ length: 6 }, (_, i) => fridayClose + (i - 5) * HOUR),
            ...Array.from({ length: 5 }, (_, i) => mondayOpen + i * HOUR),
        ];
        const { coords, texts } = axisLabels(bars, 720, barSpacing, zone);
        const lines = gridLines(bars, 720, barSpacing, zone);
        const left = coords.timeToX(fridayClose);
        const right = coords.timeToX(mondayOpen);
        const reopening = texts.find(({ text }) => text === 'Nov 16');
        expect(reopening).toBeDefined();
        expect(Math.round(reopening!.x)).toBe(Math.round(right));
        expect(lines.filter((x) => x > left && x <= Math.round(right) + 0.5)).toEqual([Math.round(right) + 0.5]);
    });

    it('adds the reopening date when only the grid ladder selects it', () => {
        const lastBar = Date.UTC(2026, 10, 10, 18);
        const reopening = Date.UTC(2026, 10, 16);
        const bars = [lastBar - HOUR, lastBar, reopening, reopening + HOUR, reopening + 2 * HOUR];
        const { coords, texts } = axisLabels(bars, 300, 70, 'UTC');
        const lines = gridLines(bars, 300, 70, 'UTC');
        const left = coords.timeToX(lastBar);
        const right = coords.timeToX(reopening);
        expect(texts).toEqual([{ text: 'Nov 16', x: right }]);
        expect(lines.filter((x) => x > left && x <= right + 0.5)).toEqual([Math.round(right) + 0.5]);
    });

    it('uses a date the axis can show when the reopening is near the edge', () => {
        const lastBar = Date.UTC(2026, 10, 10, 18);
        const reopening = Date.UTC(2026, 10, 16);
        const bars = [lastBar - 3 * HOUR, lastBar - 2 * HOUR, lastBar - HOUR, lastBar, reopening];
        const { coords, texts } = axisLabels(bars, 300, 100, 'UTC', 0.15);
        const lines = gridLines(bars, 300, 100, 'UTC', 0.15);
        const left = coords.timeToX(lastBar);
        const right = coords.timeToX(reopening);
        const beforeReopening = coords.timeToX(Date.UTC(2026, 10, 15));
        const reopeningStroke = Math.round(right) + 0.5;
        expect(texts).toContainEqual({ text: 'Nov 15', x: beforeReopening });
        expect(lines.filter((x) => x > left && x <= reopeningStroke)).toEqual([
            Math.round(beforeReopening) + 0.5,
            reopeningStroke,
        ]);
    });

    it('keeps a month boundary inside a multi-day intraday break', () => {
        const septemberClose = Date.UTC(2026, 8, 30, 18);
        const octoberOpen = Date.UTC(2026, 9, 4, 7);
        const bars = [
            ...Array.from({ length: 6 }, (_, i) => septemberClose + (i - 5) * HOUR),
            ...Array.from({ length: 6 }, (_, i) => octoberOpen + i * HOUR),
        ];
        const { coords, texts } = axisLabels(bars, 900, 80, 'UTC');
        const lines = gridLines(bars, 900, 80, 'UTC');
        const firstOfMonth = coords.timeToX(Date.UTC(2026, 9, 1));
        const left = coords.timeToX(septemberClose);
        const right = coords.timeToX(octoberOpen);
        expect(texts.filter(({ x }) => x > left && x < right)).toEqual([{ text: 'Oct 1', x: firstOfMonth }]);
        expect(lines.filter((x) => x > left && x <= right + 0.5)).toEqual([Math.round(firstOfMonth) + 0.5]);
    });

    it('keeps the axis priority of a month tick on the reopening candle', () => {
        const friday = Date.UTC(2025, 10, 28, 7);
        const monday = Date.UTC(2025, 11, 1);
        const bars = [friday, monday].flatMap((first) => Array.from({ length: 12 }, (_, i) => first + i * HOUR));
        const { coords, texts } = axisLabels(bars, 300, 13.5, 'UTC');
        expect(texts).toContainEqual({ text: 'Dec', x: coords.timeToX(monday) });
    });

    it('gives an existing quarter label priority over a date borrowed from the grid', () => {
        const may = Date.UTC(2018, 4, 21);
        const octoberOpen = Date.UTC(2018, 9, 1);
        const bars = [may, octoberOpen].flatMap((first) => Array.from({ length: 12 }, (_, i) => first + i * WEEK));
        const { coords, texts } = axisLabels(bars, 300, 13.5, 'UTC');
        const september = Date.UTC(2018, 8, 1);
        const lines = gridLines(bars, 300, 13.5, 'UTC');
        expect(lines).toContain(Math.round(coords.timeToX(september)) + 0.5);
        expect(texts).toContainEqual({ text: 'Oct', x: coords.timeToX(octoberOpen) });
        expect(texts.map(({ text }) => text)).not.toContain('Sep');
    });

    it('preserves the quarter marker inside a gap on a weekly chart', () => {
        const june = Date.UTC(2021, 5, 28);
        const november = Date.UTC(2021, 10, 8);
        const bars = [june, november].flatMap((first) => Array.from({ length: 13 }, (_, i) => first + i * WEEK));
        const { coords, texts } = axisLabels(bars, 300, 12, 'UTC');
        const lines = gridLines(bars, 300, 12, 'UTC');
        const october = coords.timeToX(Date.UTC(2021, 9, 1));
        expect(texts).toContainEqual({ text: 'Oct', x: october });
        expect(lines).toContain(Math.round(october) + 0.5);
    });

    it('preserves an axis-only date in a daily holiday gap', () => {
        const thanksgiving = Date.UTC(2024, 10, 28);
        const bars = Array.from({ length: 17 }, (_, i) => Date.UTC(2024, 10, 18 + i)).filter((time) => {
            const weekday = new Date(time).getUTCDay();
            return weekday !== 0 && weekday !== 6 && time !== thanksgiving;
        });
        const { coords, texts } = axisLabels(bars, 300, 32, 'UTC', 0.5);
        const lines = gridLines(bars, 300, 32, 'UTC', 0.5);
        const x = coords.timeToX(thanksgiving);
        expect(texts).toContainEqual({ text: 'Nov 28', x });
        expect(lines).not.toContain(Math.round(x) + 0.5);
    });

    it('keeps the existing tick density in a narrow view of continuous bars', () => {
        const coords = coordsFor(HOURLY, 300, 10);
        const { from, to } = coords.visibleTimeRange();
        for (const target of [4, 8]) {
            expect(viewportTimeTicks(coords, 'UTC', target)).toEqual(timeTicks(from, to, target, 0, undefined, HOURLY[0]));
        }
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
