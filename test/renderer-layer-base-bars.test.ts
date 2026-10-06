// `RendererLayerInstance.baseBars`: a price-pane layer may hand the base price series a
// stand-in for this frame's bars (partially grown candles while a style switch animates).
// Display only — the backend paints the stand-in, while the chrome (current-price label,
// axes) and every reader keep the real bars, which are back in place once the frame ends.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { usableBaseBars, type RendererLayerArgs, type RendererLayerInstance } from '../src/renderers/native/layers';
import { resolveAnimations } from '../src/core/options';
import type { SceneGraph, PaneNode } from '../src/renderers/native/core/SceneGraph';
import type { OHLCV } from '../src/core/model/ohlcv';

const bars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: 1_000 * (i + 1), open: 100 + i, high: 110 + i, low: 90 + i, close: 105 + i, volume: 1 }));
const flat = (src: readonly OHLCV[]): OHLCV[] => src.map((b) => ({ ...b, open: b.close, high: b.close, low: b.close }));

/* eslint-disable @typescript-eslint/no-explicit-any -- the paint path is private by design; the test drives it */
function makeRenderer() {
    const r = new NativeRenderer({
        currentPriceLine: true, logScale: false, nativeBackend: 'canvas2d', ...resolveAnimations(undefined),
        glow: 0, upColor: '#0f0', downColor: '#f00', priceStyle: 'candles',
    });
    const anyR = r as any;
    anyR.scheduler = { invalidate: () => {} }; // mount-owned; stubbed for the unmounted path
    anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    anyR.dataCanvas = { width: 0, height: 0 }; // unsized: the Pine-drawing slices prepare nothing
    r.setBars(bars(5));
    const scene = anyR.scene as SceneGraph;
    if (!scene.panes.has('price')) r.ensurePane({ id: 'price', kind: 'price' } as never);
    const backendSaw: OHLCV[][] = [];
    const chromeSaw: OHLCV[][] = [];
    anyR.backend = { render: (s: SceneGraph) => backendSaw.push(s.bars) };
    anyR.chrome = { render: (s: SceneGraph) => chromeSaw.push(s.bars), markGlyphByKey: () => null };
    const real = anyR.bars as OHLCV[];
    return { r, anyR, scene, real, backendSaw, chromeSaw };
}

function layer(id: string, instance: Partial<RendererLayerInstance>) {
    const full: RendererLayerInstance = { mount() {}, render() {}, ...instance };
    return { def: { id, create: () => full }, instance: full, canvas: { width: 0, height: 0 }, channel: id, owner: null };
}

describe('usableBaseBars', () => {
    it('accepts a stand-in that matches the bars one to one, and nothing else', () => {
        const real = bars(3);
        const sub = flat(real);
        expect(usableBaseBars(real, sub)).toBe(sub);
        expect(usableBaseBars(real, null)).toBeNull();
        expect(usableBaseBars(real, undefined)).toBeNull();
        expect(usableBaseBars(real, real)).toBeNull(); // the bars themselves: nothing to swap
        expect(usableBaseBars(real, sub.slice(1))).toBeNull(); // length
        expect(usableBaseBars(real, sub.map((b, i) => (i === 1 ? { ...b, time: b.time + 1 } : b)))).toBeNull(); // a bar time
        expect(usableBaseBars(real, [...sub].reverse())).toBeNull(); // order
    });
});

describe('NativeRenderer paint with a baseBars layer', () => {
    it('the backend paints the stand-in; the chrome and the renderer keep the real bars', () => {
        const { anyR, scene, real, backendSaw, chromeSaw } = makeRenderer();
        let seen: readonly OHLCV[] | null = null;
        const sub = flat(real);
        anyR.extLayers = [layer('flat', { baseBars: (args: RendererLayerArgs) => ((seen = args.bars), sub) })];

        anyR.paintData();

        expect(seen).toBe(real); // the layer is asked against the real bars
        expect(backendSaw).toEqual([sub]);
        expect(backendSaw[0]).toBe(sub);
        expect(chromeSaw[0]).toBe(real);
        expect(scene.bars).toBe(real); // restored after the frame
        expect(anyR.bars).toBe(real);
    });

    it('ignores a stand-in whose length or bar times do not match', () => {
        const { anyR, real, backendSaw } = makeRenderer();
        anyR.extLayers = [layer('short', { baseBars: () => flat(real).slice(1) })];
        anyR.paintData();
        anyR.extLayers = [layer('shifted', { baseBars: () => flat(real).map((b) => ({ ...b, time: b.time + 1 })) })];
        anyR.paintData();
        expect(backendSaw).toEqual([real, real]);
        expect(backendSaw.every((b) => b === real)).toBe(true);
    });

    it('the first usable answer wins in registration order; later layers are not asked', () => {
        const { anyR, real, backendSaw } = makeRenderer();
        const a = flat(real);
        const b = flat(real);
        let askedLast = 0;
        anyR.extLayers = [
            layer('none', { baseBars: () => null }),
            layer('broken', { baseBars: () => a.slice(2) }),
            layer('first', { baseBars: () => a }),
            layer('second', { baseBars: () => ((askedLast += 1), b) }),
        ];
        anyR.paintData();
        expect(backendSaw[0]).toBe(a);
        expect(askedLast).toBe(0);
    });

    it('a layer off the price pane gets no say', () => {
        const { anyR, real, backendSaw } = makeRenderer();
        const study = { id: 'study', kind: 'study', collapsed: false, scale: { min: 0, max: 1 }, scaleTarget: { min: 0, max: 1 }, bounds: { top: 0, height: 10 } } as unknown as PaneNode;
        const off = layer('elsewhere', { baseBars: () => flat(real) });
        anyR.extLayers = [off];
        const layerPane = anyR.layerPane.bind(anyR);
        anyR.layerPane = (l: unknown) => (l === off ? study : layerPane(l));
        anyR.paintData();
        expect(backendSaw[0]).toBe(real);
    });

    it('a layer reporting animating() keeps the animator ticking, and lets it settle once it stops', () => {
        // `Animator.start()` is a no-op inside a tick, so the request has to ride the tick's
        // own result — else a stand-in that grows over time would freeze after one frame.
        const { anyR, real } = makeRenderer();
        anyR.coords.setSize(800, 200, 1);
        anyR.computeScales = () => {};
        anyR.easeScales = () => false;
        anyR.easeLiveBar = () => false;
        anyR.crosshairLayer = { render: () => {} };
        anyR.externalCrossPx = () => null;
        anyR.updateLegendValues = () => {};
        anyR.emitViewportChange = () => {};
        let growing = true;
        let asked = 0;
        anyR.extLayers = [layer('grow', { animating: () => growing, baseBars: () => ((asked += 1), growing ? flat(real) : null) })];

        expect(anyR.animTick(16)).toBe(true);
        expect(anyR.animTick(16)).toBe(true);
        expect(asked).toBe(2);
        growing = false;
        expect(anyR.animTick(16)).toBe(false);
    });

    it('wins over the live-bar glide for the frame, which the chrome still shows and which is undone after', () => {
        const { anyR, real, backendSaw, chromeSaw } = makeRenderer();
        const last = real[real.length - 1]!;
        anyR.liveEaseTime = last.time;
        anyR.liveEaseHigh = last.high - 1;
        anyR.liveEaseLow = last.low;
        anyR.liveEaseClose = last.close - 1;
        const sub = flat(real);
        anyR.extLayers = [layer('flat', { baseBars: () => sub })];
        let chromeLastClose = NaN;
        anyR.chrome.render = (s: SceneGraph) => {
            chromeSaw.push(s.bars);
            chromeLastClose = s.bars[s.bars.length - 1]!.close;
        };

        anyR.paintData();

        expect(backendSaw[0]).toBe(sub);
        expect(chromeLastClose).toBe(last.close - 1); // the gliding forming bar, as before
        expect(real[real.length - 1]).toBe(last); // the true forming bar is back
    });
});
