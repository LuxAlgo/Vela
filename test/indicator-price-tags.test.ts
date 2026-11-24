// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { spreadAxisTags } from '../src/renderers/native/chrome/axisTags';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME, LIGHT_THEME } from '../src/core/theme';
import type { VelaTheme } from '../src/core/options';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { LineLikeSeries, SeriesDisplay } from '../src/core/model/series';

// ── indicator value tags: each plot's latest value as a chip on the price scale ──

const W = 800;
const H = 400;
const DATA_W = 736; // 800 minus the 64px master scale column

/** `color` is the fill as `#rrggbb` (alpha dropped); `raw` is the fill exactly as set. */
interface Chip { x: number; y: number; w: number; h: number; color: string; raw: string }
interface Text { text: string; x: number; y: number; color: string; raw: string }

/** A recording 2d-context stand-in: every filled rect and every text with its fill color. */
function fakeCanvas() {
    const chips: Chip[] = [];
    const texts: Text[] = [];
    const ctx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textBaseline: '',
        textAlign: '',
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        strokeRect() {},
        setLineDash() {},
        fill() {},
        rect() {},
        clip() {},
        arc() {},
        closePath() {},
        drawImage() {},
        measureText: (t: string) => ({ width: t.length * 7 }),
        fillRect(x: number, y: number, w: number, h: number) {
            chips.push({ x, y, w, h, color: hex(String(this.fillStyle)), raw: String(this.fillStyle) });
        },
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, color: hex(String(this.fillStyle)), raw: String(this.fillStyle) });
        },
    };
    return { canvas: { width: W, height: H, getContext: () => ctx } as unknown as HTMLCanvasElement, chips, texts };
}

const BARS = 20;
const T0 = Date.UTC(2026, 0, 5);
const DAY = 86_400_000;

function plot(title: string, color: string, last: number | null, display?: SeriesDisplay): LineLikeSeries {
    // Every bar but the last sits at 100; the last carries the value under test.
    const points = Array.from({ length: BARS }, (_, i) => ({ time: T0 + i * DAY, value: i === BARS - 1 ? last : 100 }));
    return { id: title, title, kind: 'line', paneId: 'price', points, style: { color, width: 1, lineStyle: 'solid' }, ...(display ? { display } : {}) };
}

function indicator(id: string, shorttitle: string, series: LineLikeSeries[], paneId = 'price'): IndicatorModel {
    return { id, title: shorttitle, shorttitle, overlay: paneId === 'price', paneHint: paneId === 'price' ? 'price' : 'new', paneId, series: series.map((s) => ({ ...s, paneId })), fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {} } as IndicatorModel;
}

interface SetupOptions {
    /** A study pane below the price pane, over 0–100: `true` for the 300–400 band, or its own band. */
    study?: boolean | { top: number; height: number };
    priceLabel?: boolean;
    /** The last candle's close (100 by default, y = 150). */
    close?: number;
    theme?: VelaTheme;
    /** Indicators merged into their pane on a scale of their own, by id. */
    ownScale?: Record<string, { min: number; max: number }>;
}

/** A price pane spanning 0–300 over prices 90–110, an optional study pane below it, and
 *  candles whose last close is 100 (y = 150). */
function setup(models: IndicatorModel[], opts: SetupOptions = {}) {
    const s = new SceneGraph();
    const price = s.ensurePane('price', 'price', 0, 3);
    price.bounds = { top: 0, height: 300 };
    price.scale = { min: 90, max: 110 };
    if (opts.study) {
        const study = s.ensurePane('study', 'study', 1, 1);
        study.bounds = opts.study === true ? { top: 300, height: 100 } : opts.study;
        study.scale = { min: 0, max: 100 };
    }
    const close = (i: number): number => (i === BARS - 1 ? (opts.close ?? 100) : 100);
    s.bars = Array.from({ length: BARS }, (_, i) => ({ time: T0 + i * DAY, open: 100, high: 101, low: 99, close: close(i), volume: 1 }));
    s.showCountdown = false;
    s.showPriceLabel = opts.priceLabel ?? false;
    for (const m of models) s.indicators.set(m.id, m);
    for (const [id, scale] of Object.entries(opts.ownScale ?? {})) {
        s.indicators.get(id)!.ownScale = true;
        s.ensureIndicatorScale(id).scale = scale;
    }
    const coords = new CoordinateSystem();
    coords.setSize(DATA_W, H, 1);
    coords.setBars(s.bars.map((b) => b.time));
    const { canvas, chips, texts } = fakeCanvas();
    const chrome = new ChromeRenderer();
    chrome.mount(canvas);
    return { scene: s, render: () => chrome.render(s, coords, opts.theme ?? DARK_THEME), chips, texts };
}

/** `#rrggbb` for any `#rrggbb` / `rgb()` / `rgba()` fill, so chips compare by color. */
function hex(css: string): string {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(css);
    if (!m) return css.toLowerCase();
    return '#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
}

/** Channels (0–255) of an `rgb()` / `rgba()` / `#rrggbb` string. */
function channels(css: string): [number, number, number] {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(css);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    const h = /^#([0-9a-f]{6})/i.exec(css)![1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG contrast ratio between two opaque colors. */
function contrast(a: string, b: string): number {
    const lum = (css: string): number => {
        const [r, g, b] = channels(css).map((v) => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        }) as [number, number, number];
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
}

/** Chips drawn on the price scale (right of the data area), 16px tall. */
const axisChips = (chips: Chip[]): Chip[] => chips.filter((c) => c.x > DATA_W && c.h === 16);
const textAt = (texts: Text[], text: string): Text | undefined => texts.find((t) => t.text === text);
/** The text printed inside a chip (the axis tick labels sit beside, never inside one). */
const textOn = (texts: Text[], chip: Chip): Text | undefined => texts.find((t) => t.x > chip.x && t.x < chip.x + chip.w && Math.abs(t.y - (chip.y + chip.h / 2)) < 0.5);
/** The chip a text is printed on (the last one drawn under it, as the eye sees it). */
const chipUnder = (chips: Chip[], text: Text): Chip | undefined => [...chips].reverse().find((c) => c.h === 16 && text.x > c.x && text.x < c.x + c.w && Math.abs(text.y - (c.y + c.h / 2)) < 0.5);

describe('indicator value labels on the price scale', () => {
    it('shows each indicator plot’s latest value in its own color, centered on that value', () => {
        const { render, chips, texts } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', 105)])]);
        render();
        const tag = axisChips(chips).find((c) => c.color === '#f0a030');
        expect(tag).toBeDefined();
        expect(tag!.y + tag!.h / 2).toBeCloseTo(75); // 105 on a 90–110 scale over 300px
        expect(textOn(texts, tag!)?.text).toMatch(/^105(\.0+)?$/);
    });

    it('is on by default and disappears when indicator value labels are turned off', () => {
        const { scene, render, chips } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', 105)])]);
        expect(scene.showIndicatorValueLabels).toBe(true);
        scene.showIndicatorValueLabels = false;
        render();
        expect(axisChips(chips).some((c) => c.color === '#f0a030')).toBe(false);
    });

    it('gives no label to a plot its script keeps off the price scale', () => {
        const { render, chips } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', 105, { priceScale: false })])]);
        render();
        expect(axisChips(chips).some((c) => c.color === '#f0a030')).toBe(false);
    });

    it('gives no label to a plot with no value on the last bar', () => {
        const { render, chips } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', null)])]);
        render();
        expect(axisChips(chips).some((c) => c.color === '#f0a030')).toBe(false);
    });

    it('labels an indicator in its own pane on that pane’s scale', () => {
        const { render, chips, texts } = setup([indicator('rsi', 'RSI', [plot('RSI', '#7e57c2', 70)], 'study')], { study: true });
        render();
        const tag = axisChips(chips).find((c) => c.color === '#7e57c2');
        expect(tag).toBeDefined();
        expect(tag!.y + tag!.h / 2).toBeCloseTo(330); // 70 on a 0–100 scale over the 300–400 band
        expect(textOn(texts, tag!)?.text).toMatch(/^70(\.0+)?$/);
    });

    it('never covers the last price label: an indicator value next to the price steps aside', () => {
        const { render, chips } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', 100.2)])], { priceLabel: true });
        render();
        const tags = axisChips(chips);
        const tag = tags.find((c) => c.color === '#f0a030')!;
        const priceChip = tags.find((c) => c.color !== '#f0a030')!;
        expect(priceChip.y + 8).toBeCloseTo(150); // the last price stays on its own level
        const overlap = Math.min(tag.y + tag.h, priceChip.y + priceChip.h) - Math.max(tag.y, priceChip.y);
        expect(overlap).toBeLessThanOrEqual(0);
    });
});

describe('indicator name labels', () => {
    it('are off by default', () => {
        const { scene, render, texts } = setup([indicator('ma', 'MA', [plot('MA', '#f0a030', 105)])]);
        expect(scene.showIndicatorNameLabels).toBe(false);
        render();
        expect(textAt(texts, 'MA')).toBeUndefined();
    });

    it('name the indicator beside its value, and the plot too when the indicator has several', () => {
        const bb = indicator('bb', 'BB', [plot('Upper', '#5b8def', 106), plot('Basis', '#f0a030', 100), plot('Lower', '#5b8def', 94)]);
        const ma = indicator('ma', 'MA', [plot('MA', '#e5484d', 108)]);
        const { scene, render, chips, texts } = setup([bb, ma]);
        scene.showIndicatorNameLabels = true;
        render();
        for (const name of ['BB Upper', 'BB Basis', 'BB Lower', 'MA']) {
            const label = textAt(texts, name);
            expect(label, name).toBeDefined();
            expect(label!.x).toBeLessThan(DATA_W); // inside the plot, not on the scale
        }
        // Each name sits on the same level as its value.
        const upper = axisChips(chips).find((c) => c.color === '#5b8def' && c.y < 150)!;
        expect(textAt(texts, 'BB Upper')!.y).toBeCloseTo(upper.y + upper.h / 2);
    });

    it('name a one-plot indicator by the indicator alone, even when it carries a hidden fill anchor', () => {
        const anchor = plot('Zero Anchor', '#78787800', 0, { pane: false, legend: false, dataWindow: false });
        const cc = indicator('cc', 'CC', [plot('Correlation', '#2962ff', 50), anchor], 'study');
        const { scene, render, texts } = setup([cc], { study: true });
        scene.showIndicatorNameLabels = true;
        render();
        expect(textAt(texts, 'CC')).toBeDefined();
        expect(textAt(texts, 'CC Correlation')).toBeUndefined();
        expect(textAt(texts, 'CC Zero Anchor')).toBeUndefined();
    });

    it('give an indicator on its own scale a row of its own, level with its own value', () => {
        // MA at 105 and the merged RSI at 75 both fall at y = 75 on their own scales.
        const ma = indicator('ma', 'MA', [plot('MA', '#f0a030', 105)]);
        const rsi = indicator('rsi', 'RSI', [plot('RSI', '#7e57c2', 75)]);
        const { scene, render, chips, texts } = setup([ma, rsi], { ownScale: { rsi: { min: 0, max: 100 } } });
        scene.showIndicatorNameLabels = true;
        render();
        const maName = textAt(texts, 'MA')!;
        const rsiName = textAt(texts, 'RSI')!;
        expect(Math.abs(maName.y - rsiName.y)).toBeGreaterThanOrEqual(16); // never on top of each other
        const maValue = axisChips(chips).find((c) => c.color === '#f0a030')!;
        const rsiValue = axisChips(chips).find((c) => c.color === '#7e57c2')!;
        expect(rsiValue.x).toBeGreaterThan(DATA_W + 64); // in the merged indicator's own column
        expect(maName.y).toBeCloseTo(maValue.y + 8);
        expect(rsiName.y).toBeCloseTo(rsiValue.y + 8);
    });

    it('leave each scale’s values at their own level while names are off', () => {
        const ma = indicator('ma', 'MA', [plot('MA', '#f0a030', 105)]);
        const rsi = indicator('rsi', 'RSI', [plot('RSI', '#7e57c2', 75)]);
        const { render, chips } = setup([ma, rsi], { ownScale: { rsi: { min: 0, max: 100 } } });
        render();
        expect(axisChips(chips).find((c) => c.color === '#f0a030')!.y + 8).toBeCloseTo(75);
        expect(axisChips(chips).find((c) => c.color === '#7e57c2')!.y + 8).toBeCloseTo(75);
    });

    it('stay readable on a light chart, even in a pale plot color', () => {
        const pale = indicator('pale', 'Pale', [plot('Pale', 'hsl(50, 100%, 85%)', 105)]);
        const { scene, render, chips, texts } = setup([pale], { theme: LIGHT_THEME });
        scene.showIndicatorNameLabels = true;
        render();
        const name = textAt(texts, 'Pale')!;
        const chip = chipUnder(chips, name)!;
        expect(chip.x).toBeLessThan(DATA_W);
        expect(contrast(name.raw, chip.raw)).toBeGreaterThanOrEqual(4.5);
    });

    it('stay readable on a dark chart, in a dark plot color', () => {
        const navy = indicator('navy', 'Navy', [plot('Navy', '#1a237e', 105)]);
        const { scene, render, chips, texts } = setup([navy]);
        scene.showIndicatorNameLabels = true;
        render();
        const name = textAt(texts, 'Navy')!;
        expect(contrast(name.raw, chipUnder(chips, name)!.raw)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('labels stay inside their pane', () => {
    it('leaves off the tags a short pane has no room for instead of drawing them over the next pane', () => {
        const band = { top: 300, height: 40 };
        const plots = [50, 51, 52, 53].map((v, i) => plot(`P${i}`, '#7e57c2', v));
        const { render, chips } = setup([indicator('osc', 'OSC', plots, 'study')], { study: band });
        render();
        const tags = axisChips(chips).filter((c) => c.color === '#7e57c2');
        expect(tags.length).toBeGreaterThan(0);
        expect(tags.length).toBeLessThan(4);
        for (const t of tags) {
            expect(t.y).toBeGreaterThanOrEqual(band.top);
            expect(t.y + t.h).toBeLessThanOrEqual(band.top + band.height);
        }
    });

    it('leaves off a tag the last price label pushes past the bottom of the price pane', () => {
        // The last price (90.6) sits near the bottom edge; a value just under it has no room left.
        const low = indicator('low', 'LOW', [plot('LOW', '#26a69a', 90.5)]);
        const mid = indicator('mid', 'MID', [plot('MID', '#f0a030', 95)]);
        const { render, chips } = setup([low, mid], { priceLabel: true, close: 90.6 });
        render();
        expect(axisChips(chips).some((c) => c.color === '#26a69a')).toBe(false);
        expect(axisChips(chips).some((c) => c.color === '#f0a030')).toBe(true);
    });
});

describe('plot colors in any CSS form', () => {
    afterEach(() => vi.restoreAllMocks());

    it('tints a name chip with a named plot color rather than filling it solid', () => {
        // The browser canvas reads any CSS color; stand one in for the colors this test uses.
        const named: Record<string, [number, number, number, number]> = { '#000': [0, 0, 0, 255], gold: [255, 215, 0, 255] };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
            let style = '#000';
            let px: [number, number, number, number] = [0, 0, 0, 255];
            return {
                set fillStyle(v: string) {
                    if (v in named || /^rgba?\(|^#/.test(v)) style = v;
                },
                get fillStyle() {
                    return style;
                },
                clearRect() {},
                fillRect() {
                    px = named[style] ?? [...channels(style), 255];
                },
                getImageData: () => ({ data: px }),
            } as unknown as CanvasRenderingContext2D;
        } as never);
        const g = indicator('g', 'Gold', [plot('Gold', 'gold', 105)]);
        const { scene, render, chips, texts } = setup([g]);
        scene.showIndicatorNameLabels = true;
        render();
        expect(axisChips(chips).some((c) => c.color === '#ffd700')).toBe(true); // the value chip wears it
        const name = textAt(texts, 'Gold')!;
        const chip = chipUnder(chips, name)!;
        expect(chip.color).not.toBe('#ffd700');
        expect(contrast(name.raw, chip.raw)).toBeGreaterThanOrEqual(4.5);
    });
});

describe('spreading price-scale labels apart', () => {
    const chip = (top: number, fixed = false) => ({ top, height: 16, ...(fixed ? { fixed } : {}) });
    const overlaps = (tops: number[]): boolean => {
        const sorted = [...tops].sort((a, b) => a - b);
        return sorted.some((t, i) => i > 0 && t < sorted[i - 1]! + 16 - 1e-6);
    };

    it('leaves labels that do not touch exactly where they are', () => {
        expect(spreadAxisTags([chip(10), chip(50), chip(90)], 0, 300)).toEqual([10, 50, 90]);
    });

    it('pushes crowded labels apart so none overlap, keeping their price order', () => {
        const tops = spreadAxisTags([chip(100), chip(104), chip(108), chip(102)], 0, 300);
        expect(overlaps(tops)).toBe(false);
        expect(tops[0]!).toBeLessThan(tops[3]!);
        expect(tops[3]!).toBeLessThan(tops[1]!);
        expect(tops[1]!).toBeLessThan(tops[2]!);
    });

    it('never moves the last price label; the others make room around it', () => {
        const tops = spreadAxisTags([chip(98), chip(100, true), chip(103)], 0, 300);
        expect(tops[1]).toBe(100);
        expect(overlaps(tops)).toBe(false);
    });

    it('keeps labels inside their pane when they crowd its edge', () => {
        const tops = spreadAxisTags([chip(290), chip(292), chip(294)], 0, 300);
        expect(overlaps(tops)).toBe(false);
        expect(Math.max(...tops) + 16).toBeLessThanOrEqual(300);
    });
});
