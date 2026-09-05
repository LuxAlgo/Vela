import { describe, it, expect } from 'vitest';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { PriceLine } from '../src/core/model/scene';

/**
 * `PriceLine.axisLabel` opts a horizontal price line into a gutter tag on the price
 * axis, analogous to the built-in last-price chip — these tests drive the chrome
 * layer (which owns every axis chip) with a recording 2d context and assert the tag
 * geometry/text/colors it paints. The line itself (Canvas2d/WebGL geometry backends)
 * is untouched by this feature and isn't exercised here.
 */

/**
 * The chip's text-contrast pick (`tagTextColor`) normalizes CSS colors via a real
 * canvas2d readback (`parseColor` in `backend/gl/color.ts`), which needs a `document`.
 * This suite runs under the plain `node` test environment (no DOM), so this is a
 * minimal `document.createElement('canvas')` stand-in — just enough for a 1×1
 * fillStyle→getImageData round trip on the plain `#rrggbb` colors these tests use.
 */
(globalThis as unknown as { document: unknown }).document ??= {
    createElement: () => {
        let current = '#000000';
        return {
            width: 0,
            height: 0,
            getContext: () => ({
                clearRect() {},
                set fillStyle(v: string) {
                    current = v;
                },
                get fillStyle() {
                    return current;
                },
                fillRect() {},
                getImageData: () => ({ data: hexToRgba255(current) }),
            }),
        };
    },
};

function hexToRgba255(hex: string): [number, number, number, number] {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [0, 0, 0, 255];
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

/** Records fillRect/fillText calls (with the fillStyle active at call time) + measures
 *  text at a fixed 10px/char so widths are deterministic. */
function recordingCtx() {
    const rects: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
    const texts: Array<{ text: string; x: number; y: number; style: string; align: string }> = [];
    let style = '';
    let align = 'start';
    const ctx = {
        set fillStyle(v: string) {
            style = v;
        },
        get fillStyle(): string {
            return style;
        },
        set textAlign(v: string) {
            align = v;
        },
        get textAlign(): string {
            return align;
        },
        font: '',
        textBaseline: 'alphabetic',
        strokeStyle: '',
        lineWidth: 1,
        setTransform() {},
        clearRect() {},
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        setLineDash() {},
        rect() {},
        clip() {},
        fillRect(x: number, y: number, w: number, h: number) {
            rects.push({ x, y, w, h, style });
        },
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, style, align });
        },
        measureText: (text: string) => ({ width: text.length * 10 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, rects, texts };
}

function fakeCanvas(width: number, height: number) {
    const { ctx, rects, texts } = recordingCtx();
    return { canvas: { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement, rects, texts };
}

function priceLine(over: Partial<PriceLine> = {}): PriceLine {
    return { id: 'pl', paneId: '', price: 50, ...over };
}

function model(priceLines: PriceLine[], over: Partial<IndicatorModel> = {}): IndicatorModel {
    return {
        id: 'ind', title: 'Indicator', overlay: false, paneHint: 'price', paneId: 'price',
        series: [], fills: [], backgrounds: [], priceLines,
        inputs: [], inputValues: {},
        ...over,
    };
}

/** One price pane, 100px tall, scale [0, 100] (so price 50 → y 50), one bar so the
 *  chrome doesn't take the empty-bars early-out. */
function scene(): SceneGraph {
    const s = new SceneGraph();
    const pane = s.ensurePane('price', 'price', 0, 3);
    pane.bounds = { top: 0, height: 100 };
    pane.scale = { min: 0, max: 100 };
    s.priceMintick = 0.01; // deterministic 2-decimal formatting
    s.bars = [{ time: 0, open: 50, high: 50, low: 50, close: 50, volume: 0 }];
    s.showPriceLine = false;
    s.showPriceLabel = false;
    s.showCountdown = false;
    return s;
}

function render(s: SceneGraph) {
    const { canvas, rects, texts } = fakeCanvas(400, 100);
    const coords = new CoordinateSystem();
    coords.setSize(400, 100, 1);
    coords.setBars([0]);
    const chrome = new ChromeRenderer();
    chrome.mount(canvas);
    chrome.render(s, coords, DARK_THEME);
    return { rects, texts };
}

describe('PriceLine.axisLabel — gutter tag', () => {
    it('opt-in (`true`) draws a tag with the formatted price, in the line\'s own color', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, color: '#123456', axisLabel: true })]));
        const { rects, texts } = render(s);
        expect(rects).toHaveLength(1);
        const [r] = rects;
        expect(r!.x).toBe(401);
        expect(r!.y).toBeCloseTo(50);
        expect(r!.w).toBe(58);
        expect(r!.h).toBe(16);
        expect(r!.style).toBe('#123456');
        expect(texts.map((t) => t.text)).toContain('42.00');
    });

    it('no `axisLabel` ⇒ no tag at all (existing lines render exactly as before)', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, color: '#123456' })]));
        const { rects } = render(s);
        expect(rects).toEqual([]); // only a tag chip fills a rect here; price ticks only draw text
    });

    it('a custom `text` overrides the formatted price', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, axisLabel: { text: 'Stop' } })]));
        const { texts } = render(s);
        expect(texts.map((t) => t.text)).toContain('Stop');
    });

    it('a custom `background` overrides the line color', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, color: '#123456', axisLabel: { background: '#ff00ff' } })]));
        const { rects } = render(s);
        expect(rects.some((r) => r.style === '#ff00ff')).toBe(true);
    });

    it('falls back to the axis text color when the line has no `color`', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, axisLabel: true })]));
        const { rects } = render(s);
        expect(rects.some((r) => r.style === DARK_THEME.textColor)).toBe(true);
    });

    it('a line outside the pane\'s visible price window draws no tag', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 999, axisLabel: true })]));
        const { rects } = render(s);
        expect(rects).toEqual([]);
    });

    it('a collapsed pane draws no tags', () => {
        const s = scene();
        s.panes.get('price')!.collapsed = true;
        s.indicators.set('ind', model([priceLine({ price: 42, axisLabel: true })]));
        const { rects } = render(s);
        expect(rects).toEqual([]);
    });

    it('removing the owning indicator removes its tag (hidden/removed indicators leave nothing behind)', () => {
        const s = scene();
        s.indicators.set('ind', model([priceLine({ price: 42, axisLabel: true })]));
        s.indicators.delete('ind');
        const { rects } = render(s);
        expect(rects).toEqual([]);
    });

    it('respects the pane\'s percent axis mode for the default text, like the price ticks', () => {
        const s = scene();
        s.scaleMode = 'percent';
        s.panes.get('price')!.percentBaseline = 50; // 50 → +0.00% vs a 50 baseline
        s.indicators.set('ind', model([priceLine({ price: 50, axisLabel: true })]));
        const { texts } = render(s);
        expect(texts.map((t) => t.text)).toContain('+0.00%');
    });

    it('two overlapping lines stack deterministically instead of overlapping', () => {
        const s = scene();
        s.indicators.set('ind', model([
            priceLine({ id: 'a', price: 50, axisLabel: true }),
            priceLine({ id: 'b', price: 51, axisLabel: true }), // 1px apart in y → would overlap a 16px-tall chip
        ]));
        const { rects } = render(s);
        expect(rects).toHaveLength(2);
        const [r1, r2] = [...rects].sort((a, b) => a.y - b.y);
        // The lower tag (larger y) is pushed down clear of the upper one, never overlapping it.
        expect(r2!.y).toBeGreaterThanOrEqual(r1!.y + r1!.h);
    });

    it('a merged (own-scale) indicator\'s tag uses its OWN scale, not the pane\'s', () => {
        const s = scene();
        const m = model([priceLine({ price: 5, axisLabel: true })], { ownScale: true });
        s.indicators.set('ind', m);
        s.ensureIndicatorScale('ind', { min: 0, max: 10 }); // own scale: 5 sits at the vertical MIDDLE (y 50)…
        const { rects } = render(s); // …not the pane's [0,100] scale, where 5 would sit near the bottom (y ~95)
        expect(rects).toHaveLength(1);
        expect(rects[0]!.y).toBeCloseTo(42); // chip top = y(50) - 8
    });
});
