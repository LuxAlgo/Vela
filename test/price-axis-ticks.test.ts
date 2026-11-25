// Host price-axis ticks (`priceAxis.ticks` / the `priceAxisTicks` renderer feature): one tick
// source per chart feeds BOTH the horizontal gridlines (backdrop) and the axis labels (chrome),
// so a host ladder moves them together.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PriceAxisTickSource } from '../src/renderers/native/chrome/priceAxisTicks';
import { paneAxisTicks } from '../src/renderers/native/chrome/ticks';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { BackdropRenderer } from '../src/renderers/native/backdrop/BackdropRenderer';
import { SceneGraph, type PaneNode } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { cellChartDefaults } from '../src/workspace/ChartCell';
import { Vela } from '../src/index';
import { DARK_THEME } from '../src/core/theme';
import { resolveAnimations, type PriceAxisTick, type PriceAxisTickContext, type PriceAxisTicksFn, type RendererDisplayOptions } from '../src/core/options';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

afterEach(() => vi.restoreAllMocks());

const W = 500; // data width (the price-axis column starts here)
const H = 400; // data height

function coords(): CoordinateSystem {
    const c = new CoordinateSystem();
    c.setSize(W, H, 1);
    c.setBars(Array.from({ length: 60 }, (_, i) => 1_700_000_000_000 + i * 3_600_000));
    return c;
}

/** A scene with a price pane (100–200 over the top 300px) and a study pane below it. */
function scene(): { scene: SceneGraph; price: PaneNode; study: PaneNode } {
    const s = new SceneGraph();
    const price = s.ensurePane('price', 'price', 0, 3);
    price.bounds = { top: 0, height: 300 };
    price.scale = { min: 100, max: 200 };
    const study = s.ensurePane('study-1', 'study', 1, 1);
    study.bounds = { top: 300, height: 100 };
    study.scale = { min: 0, max: 100 };
    return { scene: s, price, study };
}

/** A 2d context that records horizontal stroke segments and every fillText with its font/alpha. */
function recorder() {
    const segments: Array<{ from: [number, number]; to: [number, number] }> = [];
    const texts: Array<{ text: string; x: number; y: number; font: string; alpha: number }> = [];
    let at: [number, number] = [0, 0];
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
        save() {},
        restore() {},
        rect() {},
        clip() {},
        translate() {},
        setLineDash() {},
        fillRect() {},
        moveTo(x: number, y: number) {
            at = [x, y];
        },
        lineTo(x: number, y: number) {
            segments.push({ from: at, to: [x, y] });
        },
        stroke() {},
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, font: ctx.font, alpha: ctx.globalAlpha });
        },
        measureText: (t: string) => ({ width: t.length * 6 }),
    };
    const canvas = { width: W + 70, height: H + 22, getContext: () => ctx } as unknown as HTMLCanvasElement;
    return { canvas, segments, texts };
}

/** Paint one data frame (backdrop + chrome) through a shared tick source. */
function paintFrame(source: PriceAxisTickSource, s: SceneGraph, c = coords()) {
    const back = recorder();
    const front = recorder();
    const backdrop = new BackdropRenderer(source);
    const chrome = new ChromeRenderer(source);
    backdrop.mount(back.canvas);
    chrome.mount(front.canvas);
    backdrop.render(s, c, DARK_THEME, 1);
    chrome.render(s, c, DARK_THEME);
    // Horizontal gridlines span the data width; price labels sit in the master column.
    const gridYs = back.segments.filter((g) => g.from[1] === g.to[1] && g.from[0] === 0 && g.to[0] === W).map((g) => g.from[1]);
    const labels = front.texts.filter((t) => t.x === W + 6);
    return { gridYs, labels };
}

const at = (prices: number[], tag = 'L'): PriceAxisTick[] => prices.map((price) => ({ price, label: `${tag}${price}` }));

describe('PriceAxisTickSource', () => {
    it('without a function it yields the built-in ladder', () => {
        const { scene: s, price } = scene();
        s.priceMintick = 0.5;
        const src = new PriceAxisTickSource();
        expect(src.hook).toBeNull();
        expect(src.ticksFor(s, price, coords())).toEqual(paneAxisTicks(price.scale, 300, undefined, 0.5));
    });

    it("the host's ticks replace the defaults; null and undefined keep them", () => {
        const { scene: s, price } = scene();
        const src = new PriceAxisTickSource();
        src.setHook(() => at([120, 150]));
        expect(src.ticksFor(s, price, coords())).toEqual(at([120, 150]));
        src.setHook(() => null);
        expect(src.ticksFor(s, price, coords())).toEqual(paneAxisTicks(price.scale, 300));
        src.setHook(() => undefined);
        expect(src.ticksFor(s, price, coords())).toEqual(paneAxisTicks(price.scale, 300));
        src.setHook(() => []);
        expect(src.ticksFor(s, price, coords())).toEqual([]); // an empty ladder is a real answer
    });

    it('drops invalid entries and keeps major only when it is a boolean', () => {
        const { scene: s, price } = scene();
        const src = new PriceAxisTickSource();
        src.setHook(
            () =>
                [
                    { price: 110, label: 'ok', major: true },
                    { price: Number.NaN, label: 'nan' },
                    { price: Infinity, label: 'inf' },
                    { price: '130', label: 'string price' },
                    { price: 140, label: 140 },
                    null,
                    'junk',
                    { price: 150, label: 'muted', major: false },
                    { price: 160, label: 'odd major', major: 'yes' },
                ] as unknown as PriceAxisTick[],
        );
        expect(src.ticksFor(s, price, coords())).toEqual([
            { price: 110, label: 'ok', major: true },
            { price: 150, label: 'muted', major: false },
            { price: 160, label: 'odd major' },
        ]);
    });

    it('a throwing (or non-array) function falls back to the defaults and warns once per chart', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { scene: s, price, study } = scene();
        const src = new PriceAxisTickSource();
        src.setHook(() => {
            throw new Error('host bug');
        });
        expect(src.ticksFor(s, price, coords())).toEqual(paneAxisTicks(price.scale, 300));
        expect(src.ticksFor(s, study, coords())).toEqual(paneAxisTicks(study.scale, 100));
        src.setHook((() => ({ price: 1, label: 'x' })) as unknown as PriceAxisTicksFn);
        expect(src.ticksFor(s, price, coords())).toEqual(paneAxisTicks(price.scale, 300));
        expect(warn).toHaveBeenCalledTimes(1);
        // Another chart warns on its own.
        const other = new PriceAxisTickSource();
        other.setHook(() => {
            throw new Error('host bug');
        });
        other.ticksFor(s, price, coords());
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('hands the host the pane, its range, size, mode, baseline, tick size, font size and the defaults', () => {
        const { scene: s, price, study } = scene();
        s.priceMintick = 0.01;
        const seen: PriceAxisTickContext[] = [];
        const src = new PriceAxisTickSource();
        src.setHook((ctx) => void seen.push(ctx));

        src.ticksFor(s, price, coords());
        expect(seen[0]).toMatchObject({ pane: { id: 'price', kind: 'price' }, min: 100, max: 200, log: false, height: 300, mode: 'price', mintick: 0.01, fontSize: 11 });
        expect(seen[0]!.baseline).toBeUndefined();
        expect(seen[0]!.defaults).toEqual(paneAxisTicks(price.scale, 300, undefined, 0.01));

        s.scaleMode = 'percent';
        price.percentBaseline = 125;
        src.ticksFor(s, price, coords());
        expect(seen[1]).toMatchObject({ mode: 'percent', baseline: 125, min: 100, max: 200 });
        expect(seen[1]!.defaults[0]!.label).toMatch(/%$/);

        s.scaleMode = 'indexed';
        src.ticksFor(s, price, coords());
        expect(seen[2]).toMatchObject({ mode: 'indexed', baseline: 125 });

        // A study pane follows its own mode, not the price pane's.
        src.ticksFor(s, study, coords());
        expect(seen[3]).toMatchObject({ pane: { id: 'study-1', kind: 'study' }, mode: 'price', height: 100, min: 0, max: 100 });
        expect(seen[3]!.baseline).toBeUndefined();
    });

    it("priceToY is the renderer's own mapping, pane-relative — linear, log and inverted", () => {
        const { scene: s, study } = scene();
        const c = coords();
        let ctx: PriceAxisTickContext | null = null;
        const src = new PriceAxisTickSource();
        src.setHook((x) => void (ctx = x));
        for (const scale of [{ min: 0, max: 100 }, { min: 10, max: 1000, log: true }, { min: 0, max: 100, invert: true }, { min: 10, max: 1000, log: true, invert: true }]) {
            study.scale = scale;
            src.ticksFor(s, study, c);
            for (const p of [10, 25, 50, 99]) {
                expect(ctx!.priceToY(p)).toBeCloseTo(c.priceToY(p, scale, study.bounds) - study.bounds.top, 9);
            }
            expect(ctx!.log).toBe(!!scale.log);
        }
    });

    it('an unscaled pane (axisFormat none) gets no ticks and is never asked about', () => {
        const { scene: s, study } = scene();
        study.axisFormat = 'none';
        const fn = vi.fn(() => at([50]));
        const src = new PriceAxisTickSource();
        src.setHook(fn);
        expect(src.ticksFor(s, study, coords())).toEqual([]);
        expect(fn).not.toHaveBeenCalled();
    });

    it('calls the host once per pane until the range, size or mode changes; setting it again recomputes', () => {
        const { scene: s, price } = scene();
        const fn = vi.fn(() => at([150]));
        const src = new PriceAxisTickSource();
        src.setHook(fn);
        const c = coords();
        src.ticksFor(s, price, c);
        src.ticksFor(s, price, c);
        expect(fn).toHaveBeenCalledTimes(1);
        price.scale = { min: 100, max: 210 };
        src.ticksFor(s, price, c);
        expect(fn).toHaveBeenCalledTimes(2);
        price.bounds = { top: 0, height: 280 };
        src.ticksFor(s, price, c);
        expect(fn).toHaveBeenCalledTimes(3);
        s.priceMintick = 0.1;
        src.ticksFor(s, price, c);
        expect(fn).toHaveBeenCalledTimes(4);
        src.setHook(fn); // the same function: the host asks for a refresh
        src.ticksFor(s, price, c);
        expect(fn).toHaveBeenCalledTimes(5);
    });
});

describe('gridlines and price labels share one tick source', () => {
    it('host ticks replace both the gridlines and the labels, at the same prices, with one host call per frame', () => {
        const { scene: s } = scene();
        const c = coords();
        const fn = vi.fn((ctx: PriceAxisTickContext) => (ctx.pane.kind === 'price' ? at([120, 150, 180], 'P') : at([25, 75], 'S')));
        const src = new PriceAxisTickSource();
        src.setHook(fn);
        const { gridYs, labels } = paintFrame(src, s, c);
        const price = s.panes.get('price')!;
        const study = s.panes.get('study-1')!;
        const expectY = (p: number, pane: PaneNode) => c.priceToY(p, pane.scale, pane.bounds);
        expect(labels.map((l) => l.text)).toEqual(['P120', 'P150', 'P180', 'S25', 'S75']);
        expect(labels.map((l) => l.y)).toEqual([...[120, 150, 180].map((p) => expectY(p, price)), ...[25, 75].map((p) => expectY(p, study))]);
        expect(gridYs).toEqual(labels.map((l) => Math.round(l.y) + 0.5));
        expect(fn).toHaveBeenCalledTimes(2); // one per pane — the backdrop and the chrome shared it

        // A chrome-only repaint (the countdown's second pulse) asks the host nothing new.
        const chrome = new ChromeRenderer(src);
        chrome.mount(recorder().canvas);
        chrome.render(s, c, DARK_THEME);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('without a function both layers keep the built-in ladder', () => {
        const { scene: s, price, study } = scene();
        study.axisFormat = 'none'; // keep the frame to the price pane
        const c = coords();
        const { gridYs, labels } = paintFrame(new PriceAxisTickSource(), s, c);
        const builtIn = paneAxisTicks(price.scale, 300);
        const ys = builtIn.map((t) => c.priceToY(t.price, price.scale, price.bounds));
        expect(builtIn.length).toBeGreaterThan(2);
        expect(gridYs).toEqual(ys.map((y) => Math.round(y) + 0.5).filter((y) => y >= 0 && y <= 300));
        expect(labels.map((l) => l.text)).toEqual(builtIn.filter((_, i) => ys[i]! >= 6 && ys[i]! <= 296).map((t) => t.label));
        expect(labels.every((l) => l.font === `11px ${DARK_THEME.fontFamily}` && l.alpha === 1)).toBe(true);
    });

    it('major: true draws semibold, false draws muted, omitted draws the regular label', () => {
        const { scene: s, study } = scene();
        study.axisFormat = 'none'; // keep the frame to the price pane's labels
        const src = new PriceAxisTickSource();
        src.setHook(() => [
            { price: 120, label: 'major', major: true },
            { price: 150, label: 'plain' },
            { price: 180, label: 'minor', major: false },
        ]);
        const { labels } = paintFrame(src, s);
        const regular = `11px ${DARK_THEME.fontFamily}`;
        expect(labels.map((l) => [l.text, l.font, l.alpha])).toEqual([
            ['major', `600 ${regular}`, 1],
            ['plain', regular, 1],
            ['minor', regular, 0.5],
        ]);
    });

    it('labels too close to the pane edges stay clipped; their gridlines still draw', () => {
        const { scene: s, study } = scene();
        study.axisFormat = 'none';
        const src = new PriceAxisTickSource();
        src.setHook(() => at([199.5, 150, 100.5])); // y ≈ 1.5 and 298.5 on a 300px pane
        const { gridYs, labels } = paintFrame(src, s);
        expect(labels.map((l) => l.text)).toEqual(['L150']);
        expect(gridYs).toHaveLength(3);
    });
});

describe('the priceAxisTicks feature and the priceAxis option', () => {
    const display = (priceAxisTicks?: PriceAxisTicksFn | null): RendererDisplayOptions => ({
        currentPriceLine: true,
        logScale: false,
        nativeBackend: 'auto',
        ...resolveAnimations(undefined),
        glow: 0,
        upColor: '#0f0',
        downColor: '#f00',
        priceStyle: 'candles',
        priceAxisTicks,
    });

    it('is a declared runtime feature that reads back, clears with null, and never reaches the config', () => {
        const r = new NativeRenderer();
        const fn: PriceAxisTicksFn = () => null;
        expect(r.features).toContain('priceAxisTicks');
        expect(r.readFeature('priceAxisTicks')).toBeNull();
        const before = JSON.stringify(r.getConfig());
        r.applyFeature('priceAxisTicks', fn);
        expect(r.readFeature('priceAxisTicks')).toBe(fn);
        expect(JSON.stringify(r.getConfig())).toBe(before);
        r.applyFeature('priceAxisTicks', null);
        expect(r.readFeature('priceAxisTicks')).toBeNull();
        r.applyFeature('priceAxisTicks', 'not a function');
        expect(r.readFeature('priceAxisTicks')).toBeNull();
    });

    it('the native renderer is seeded from the display options', () => {
        const fn: PriceAxisTicksFn = () => null;
        expect(new NativeRenderer(display(fn)).readFeature('priceAxisTicks')).toBe(fn);
        expect(new NativeRenderer(display()).readFeature('priceAxisTicks')).toBeNull();
    });

    it('VelaOptions.priceAxis.ticks reaches the renderer at construction', () => {
        const fn: PriceAxisTicksFn = () => null;
        const seen: Array<RendererDisplayOptions | undefined> = [];
        const fake = {
            name: 'fake',
            features: [] as readonly string[],
            capabilities: {
                panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
                barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
            },
            applyFeature() {},
            readFeature: () => undefined,
            mount() {}, setTheme() {}, resize() {}, destroy() {},
            setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
            mountIndicator: (m: { id: string }) => ({ id: m.id }),
            updateIndicator() {}, removeIndicator() {}, setIndicatorInputs() {},
            onInputChange: () => () => {}, onRemoveIndicator: () => () => {},
            onCrosshairMove: () => () => {}, onClick: () => () => {},
            getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
        } as unknown as IChartRenderer;
        function Recording(opts?: RendererDisplayOptions) {
            seen.push(opts);
            return fake;
        }
        const renderer = Recording as unknown as new (opts?: RendererDisplayOptions) => IChartRenderer;
        new Vela({} as unknown as HTMLElement, { priceAxis: { ticks: fn }, renderer }, { engines: [] });
        new Vela({} as unknown as HTMLElement, { renderer }, { engines: [] });
        expect(seen[0]!.priceAxisTicks).toBe(fn);
        expect(seen[1]!.priceAxisTicks).toBeNull();
    });

    it("a workspace forwards priceAxis to every cell's chart", () => {
        const fn: PriceAxisTicksFn = () => null;
        expect(cellChartDefaults({ priceAxis: { ticks: fn } }).priceAxis?.ticks).toBe(fn);
    });
});
