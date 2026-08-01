import { describe, it, expect } from 'vitest';
import {
    defaultTradeMarkersState,
    mergeTradeMarkersState,
    renderTradeMarkers,
    tradesPriceHints,
    TRADE_LONG_COLOR,
    TRADE_SHORT_COLOR,
    TRADE_EXIT_COLOR,
    type TradeMarkerDeps,
    type TradeMarkersState,
} from '../src/renderers/shared/trade-markers';
import { expandScaleByPixels } from '../src/renderers/native/core/autoscale';
import { summarizeModel, inspectModels } from '../src/core/engine/inspect';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { TradeExecution } from '../src/core/model/trades';
import type { IndicatorModel } from '../src/core/model/indicator';

// Bars live at logical index = time; every bar spans [90, 110].
const deps: TradeMarkerDeps = {
    timeToLogical: (ms) => ms,
    barAt: (logical) => (logical >= 0 && logical <= 50 ? { high: 110, low: 90 } : null),
};

const FONT = 11; // line height = fontSize + 4 = 15
const LINE_H = FONT + 4;
const ARROW_H = 14;
const BAR_GAP = 10;
const TEXT_GAP = 3;
const UNIT_GAP = 6;

function exec(over: Partial<TradeExecution>): TradeExecution {
    return { time: 0, price: 100, side: 'buy', kind: 'entry', label: 'Long', qty: 2, ...over };
}

/** Records fill-style changes, fill calls, rects and text (with positions). */
function recordingCtx() {
    const texts: Array<{ text: string; x: number; y: number; style: string }> = [];
    const rects: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
    let fills = 0;
    let style = '';
    const ctx = {
        set fillStyle(v: string) {
            style = v;
        },
        get fillStyle(): string {
            return style;
        },
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        fill() {
            fills += 1;
        },
        fillRect(x: number, y: number, w: number, h: number) {
            rects.push({ x, y, w, h, style });
        },
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, style });
        },
        measureText: () => ({ width: 10 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, rects, fills: () => fills };
}

const xOf = (l: number): number => 100 + l * 10;
const yOf = (price: number): number => 200 - price; // higher price = smaller y

function paint(trades: TradeExecution[], state: TradeMarkersState = defaultTradeMarkersState()) {
    const rec = recordingCtx();
    renderTradeMarkers(rec.ctx, trades, state, deps, xOf, yOf, { fontSize: FONT, fontFamily: 'sans-serif', color: '#ddd' }, 800, 4);
    return rec;
}

describe('trade markers — state merge', () => {
    it('defaults everything on, with the reference palette', () => {
        const s = defaultTradeMarkersState();
        expect(s).toEqual({
            visible: true,
            labels: true,
            qty: true,
            colors: { long: TRADE_LONG_COLOR, short: TRADE_SHORT_COLOR, exit: TRADE_EXIT_COLOR },
        });
    });

    it('merges a partial patch and keeps everything unnamed', () => {
        const out = mergeTradeMarkersState(defaultTradeMarkersState(), { qty: false, colors: { exit: '#ffffff' } });
        expect(out.qty).toBe(false);
        expect(out.visible).toBe(true);
        expect(out.labels).toBe(true);
        expect(out.colors.exit).toBe('#ffffff');
        expect(out.colors.long).toBe(TRADE_LONG_COLOR);
    });

    it('drops malformed fields', () => {
        const base = defaultTradeMarkersState();
        const out = mergeTradeMarkersState(base, { visible: 'yes', qty: 0, colors: { long: 42, short: '  ' } });
        expect(out).toEqual(base);
        expect(mergeTradeMarkersState(base, null)).toEqual(base);
        expect(mergeTradeMarkersState(base, 'x')).toEqual(base);
    });
});

describe('trade markers — autoscale hints', () => {
    it('folds the anchor bar extremes and reserves the stack pixels on the right side', () => {
        const h = tradesPriceHints([exec({})], defaultTradeMarkersState(), deps, 0, 10, FONT)!;
        expect(h.min).toBe(90);
        expect(h.max).toBe(110);
        // unit = arrow 14 + gap 3 + two text lines (label + qty) → 47; below = BAR_GAP + 47
        expect(h.belowPx).toBe(BAR_GAP + ARROW_H + TEXT_GAP + 2 * LINE_H);
        expect(h.abovePx).toBe(0);
    });

    it('a sell reserves above the highs; stacked fills accumulate', () => {
        const one = tradesPriceHints([exec({ side: 'sell' })], defaultTradeMarkersState(), deps, 0, 10, FONT)!;
        expect(one.abovePx).toBeGreaterThan(0);
        expect(one.belowPx).toBe(0);
        const two = tradesPriceHints(
            [exec({ side: 'sell' }), exec({ side: 'sell', kind: 'exit', label: 'X' })],
            defaultTradeMarkersState(),
            deps,
            0,
            10,
            FONT,
        )!;
        const unit = ARROW_H + TEXT_GAP + 2 * LINE_H;
        expect(two.abovePx).toBe(BAR_GAP + 2 * unit + UNIT_GAP);
    });

    it('hiding the text lines shrinks the reserved pixels', () => {
        const state = defaultTradeMarkersState();
        const full = tradesPriceHints([exec({})], state, deps, 0, 10, FONT)!;
        const noLabels = tradesPriceHints([exec({})], { ...state, labels: false }, deps, 0, 10, FONT)!;
        const bare = tradesPriceHints([exec({})], { ...state, labels: false, qty: false }, deps, 0, 10, FONT)!;
        expect(noLabels.belowPx).toBe(full.belowPx - LINE_H);
        expect(bare.belowPx).toBe(BAR_GAP + ARROW_H);
    });

    it('returns null when nothing is in range or off the bar series', () => {
        expect(tradesPriceHints([exec({ time: 30 })], defaultTradeMarkersState(), deps, 0, 10, FONT)).toBeNull();
        expect(tradesPriceHints([exec({ time: 99 })], defaultTradeMarkersState(), deps, 60, 120, FONT)).toBeNull();
        expect(tradesPriceHints([], defaultTradeMarkersState(), deps, 0, 10, FONT)).toBeNull();
    });
});

describe('trade markers — painting', () => {
    it('a buy paints under the bar, reading arrow → label → qty outward', () => {
        const { texts } = paint([exec({})]);
        expect(texts.map((t) => t.text)).toEqual(['Long', '+2']);
        const [label, qty] = texts;
        const yBarBottom = yOf(90); // 110
        expect(label!.y).toBeGreaterThan(yBarBottom + BAR_GAP + ARROW_H); // below the arrow
        expect(qty!.y).toBeGreaterThan(label!.y); // qty outermost
        expect(label!.style).toBe('#ddd'); // neutral text color, never the arrow color
    });

    it('a sell paints over the bar, qty outermost (topmost)', () => {
        const { texts } = paint([exec({ side: 'sell', label: 'Short', qty: 3 })]);
        expect(texts.map((t) => t.text)).toEqual(['Short', '-3']);
        const [label, qty] = texts;
        const yBarTop = yOf(110); // 90
        expect(label!.y).toBeLessThan(yBarTop - BAR_GAP - ARROW_H);
        expect(qty!.y).toBeLessThan(label!.y);
    });

    it('exit fills add the cap bar; entries do not', () => {
        const entry = paint([exec({})]);
        expect(entry.rects).toHaveLength(1); // the arrow stem only
        const exit = paint([exec({ kind: 'exit' })]);
        expect(exit.rects).toHaveLength(2); // stem + cap
        expect(exit.rects.every((r) => r.style === TRADE_EXIT_COLOR)).toBe(true);
    });

    it('colors: long entries, short entries, exits', () => {
        const { rects } = paint([
            exec({}),
            exec({ side: 'sell', time: 1 }),
            exec({ side: 'sell', kind: 'exit', time: 2 }),
        ]);
        expect(rects.map((r) => r.style)).toEqual([TRADE_LONG_COLOR, TRADE_SHORT_COLOR, TRADE_EXIT_COLOR, TRADE_EXIT_COLOR]);
    });

    it('stacked fills on one bar step outward in execution order', () => {
        const { rects } = paint([exec({ label: 'A' }), exec({ label: 'B' })]);
        expect(rects).toHaveLength(2);
        expect(rects[1]!.y).toBeGreaterThan(rects[0]!.y);
    });

    it('respects the label/qty toggles', () => {
        const state = defaultTradeMarkersState();
        expect(paint([exec({})], { ...state, labels: false }).texts.map((t) => t.text)).toEqual(['+2']);
        expect(paint([exec({})], { ...state, qty: false }).texts.map((t) => t.text)).toEqual(['Long']);
        expect(paint([exec({})], { ...state, labels: false, qty: false }).texts).toHaveLength(0);
    });

    it('trims float noise and keeps full precision in the qty line', () => {
        const { texts } = paint([exec({ qty: 0.1 + 0.2, label: undefined })]);
        expect(texts.map((t) => t.text)).toEqual(['+0.3']);
        expect(paint([exec({ qty: 0.109884, label: undefined })]).texts[0]!.text).toBe('+0.109884');
    });

    it('culls stacks far outside the plot and skips fills off the bar series', () => {
        // xOf(200) = 2100 ≫ width+150 → culled by x; time 60 is on-plot but has no bar → skipped.
        const far = paint([exec({ time: 200 })]);
        expect(far.fills()).toBe(0);
        const offSeries = paint([exec({ time: 60 })]);
        expect(offSeries.fills()).toBe(0);
    });
});

describe('expandScaleByPixels', () => {
    it('reserves exactly the asked pixels (linear)', () => {
        const out = expandScaleByPixels({ min: 0, max: 100 }, 100, 10, 10);
        expect(out.min).toBeCloseTo(-12.5);
        expect(out.max).toBeCloseTo(112.5);
        // The original [0,100] now occupies 80 of the 100 px.
        const perPx = (out.max - out.min) / 100;
        expect(100 / perPx).toBeCloseTo(80);
    });

    it('log scales expand in log space', () => {
        const out = expandScaleByPixels({ min: 1, max: 100, log: true }, 100, 0, 50);
        expect(out.max).toBeCloseTo(100);
        expect(out.min).toBeCloseTo(0.01);
        expect(out.log).toBe(true);
    });

    it('degenerate inputs are a no-op', () => {
        const scale = { min: 5, max: 10 };
        expect(expandScaleByPixels(scale, 100, 0, 0)).toBe(scale);
        expect(expandScaleByPixels(scale, 20, 10, 10)).toBe(scale); // margins don't fit
        expect(expandScaleByPixels({ min: 5, max: 5 }, 100, 10, 10)).toEqual({ min: 5, max: 5 });
    });
});

describe('trade markers — inspect + feature', () => {
    const model = (trades?: TradeExecution[]): IndicatorModel => ({
        id: 'i1',
        title: 'Strategy',
        overlay: true,
        paneHint: 'price',
        series: [],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
        ...(trades ? { trades } : {}),
    });

    it('counts trades in the summary and the totals', () => {
        expect(summarizeModel(model([exec({}), exec({ kind: 'exit' })])).trades).toBe(2);
        expect(summarizeModel(model()).trades).toBe(0);
        expect(inspectModels([model([exec({})]), model([exec({}), exec({})])]).totals.trades).toBe(3);
    });

    it('the tradeMarkers feature merges partials and reads back a copy', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('tradeMarkers');
        r.applyFeature('tradeMarkers', { labels: false, colors: { long: '#000001' } });
        const state = r.readFeature('tradeMarkers') as TradeMarkersState;
        expect(state.labels).toBe(false);
        expect(state.visible).toBe(true);
        expect(state.colors.long).toBe('#000001');
        expect(state.colors.exit).toBe(TRADE_EXIT_COLOR);
        // The read-back is a copy — mutating it never leaks into the renderer.
        state.colors.long = '#bad';
        expect((r.readFeature('tradeMarkers') as TradeMarkersState).colors.long).toBe('#000001');
    });

    it('the trades config section persists through getConfig → applyConfig', () => {
        const a = new NativeRenderer();
        a.applyFeature('tradeMarkers', { qty: false, colors: { short: '#010101' } });
        const cfg = a.getConfig();
        expect(cfg.trades).toEqual({
            visible: true,
            labels: true,
            qty: false,
            longColor: TRADE_LONG_COLOR,
            shortColor: '#010101',
            exitColor: TRADE_EXIT_COLOR,
        });
        const b = new NativeRenderer();
        b.applyConfig(cfg);
        expect(b.readFeature('tradeMarkers')).toEqual({
            visible: true,
            labels: true,
            qty: false,
            colors: { long: TRADE_LONG_COLOR, short: '#010101', exit: TRADE_EXIT_COLOR },
        });
    });
});
