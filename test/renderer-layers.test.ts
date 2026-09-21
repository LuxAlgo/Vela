// The SDK renderer-layer seam (src/renderers/native/layers.ts): registry semantics and the
// generic native-data channel routing on the renderer (unmounted — mounted painting is
// exercised in the browser playground; the channel/scene plumbing is the unit-testable part).
import { describe, it, expect, afterEach } from 'vitest';
import { registerRendererLayer, unregisterRendererLayer, rendererLayers, foldBaseModulation, type RendererLayerArgs, type RendererLayerInstance } from '../src/renderers/native/layers';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';

afterEach(() => unregisterRendererLayer('demo'));

describe('renderer-layer registry', () => {
    it('register / replace-by-id / unregister / list', () => {
        const create = () => ({ mount() {}, render() {} });
        registerRendererLayer({ id: 'demo', create });
        expect(rendererLayers().some((d) => d.id === 'demo')).toBe(true);
        registerRendererLayer({ id: 'demo', placement: 'below-data', create });
        expect(rendererLayers().find((d) => d.id === 'demo')?.placement).toBe('below-data'); // last wins
        unregisterRendererLayer('demo');
        expect(rendererLayers().some((d) => d.id === 'demo')).toBe(false);
    });

    it('carries the cursor-repaint opt-in on the definition', () => {
        registerRendererLayer({ id: 'demo', repaintOnCursor: true, create: () => ({ mount() {}, render() {} }) });
        expect(rendererLayers().find((d) => d.id === 'demo')?.repaintOnCursor).toBe(true);
    });

    it('accepts a base-painting-modulating, cursor-reading instance (contract shape)', () => {
        // Compile-time + shape check for the modulation seam: a layer may read args.cursor
        // and return partial modulation values. The renderer consults EVERY mounted layer
        // that implements modulateBase (not only the active price style) and folds them
        // with foldBaseModulation; clamping + backend application stay on the paint path.
        const instance: RendererLayerInstance = {
            mount() {},
            render(args: RendererLayerArgs) {
                void args.cursor; // { x, y } | null — hover hit-testing input
            },
            modulateBase(args: RendererLayerArgs) {
                return args.priceStyle === 'demo' ? { candleBodyScale: 0.07, gridAlpha: 0 } : null;
            },
        };
        registerRendererLayer({ id: 'demo', create: () => instance });
        const mod = rendererLayers().find((d) => d.id === 'demo')!.create().modulateBase?.({ priceStyle: 'demo' } as RendererLayerArgs);
        expect(mod).toEqual({ candleBodyScale: 0.07, gridAlpha: 0 });
    });
});

describe('foldBaseModulation', () => {
    it('null is no opinion; the first speaker wins the field, later speakers keep the stronger (smaller) value', () => {
        expect(foldBaseModulation(null, null)).toBeNull();
        expect(foldBaseModulation(null, { candleBodyScale: 0.07 })).toEqual({ candleBodyScale: 0.07 });
        expect(foldBaseModulation({ candleBodyScale: 0.07, candleBodyAlpha: 1 }, { candleBodyScale: 0.5, gridAlpha: 0 })).toEqual({
            candleBodyScale: 0.07,
            candleBodyAlpha: 1,
            gridAlpha: 0,
        });
        // A later null does not wipe the running request (overlay idle, chart type still speaking).
        expect(foldBaseModulation({ candleBodyScale: 0.07 }, null)).toEqual({ candleBodyScale: 0.07 });
    });
});

describe('generic native-data channels', () => {
    it('unknown channel ids land in scene.nativeData; -pending routes to scene.nativePending', () => {
        const r = new NativeRenderer();
        const scene = (r as unknown as { scene: SceneGraph }).scene;
        r.setNativeData('demo', { rows: [1, 2, 3] });
        expect(scene.nativeData.get('demo')).toEqual({ rows: [1, 2, 3] });
        r.setNativeData('demo-pending', [[10, 20]]);
        expect(scene.nativePending.get('demo')).toEqual([[10, 20]]);
        r.setNativeData('demo-pending', undefined);
        expect(scene.nativePending.get('demo')).toEqual([]); // cleared, never undefined
    });

    it('the volume and vpvr channels keep their dedicated scene fields (not the generic map)', () => {
        const r = new NativeRenderer();
        const scene = (r as unknown as { scene: SceneGraph }).scene;
        r.setNativeData('volume', { upColor: 'x' });
        expect(scene.volumeLayer).toEqual({ upColor: 'x' });
        expect(scene.nativeData.has('volume')).toBe(false);
    });
});

describe('hidden candles: the chart type\'s layer goes with them, indicator layers stay', () => {
    // "Hide chart" hides the price series — for an SDK chart type that is its layer (the
    // base entry named by the active price style), blanked by the data frame and skipped
    // by the cursor repaint. An indicator painting through a layer (the same type mounted
    // as an overlay native, or any other layer) is independent content and keeps painting.
    type Probe = { extLayers: unknown[]; scene: SceneGraph; layerHiddenWithCandles(l: unknown): boolean; priceLayersAnchoredToBars(models: unknown[]): boolean };
    const layer = (id: string, owner: string | null = null) => ({ def: { id, create: () => ({ mount() {}, render() {} }) }, instance: { mount() {}, render() {} }, canvas: {}, channel: owner ? `${id}#${owner}` : id, owner });
    const model = (id: string, native: string | undefined, series: unknown[] = []) => ({ id, title: id, paneId: 'price', series, ...(native ? { native: { type: native } } : {}) });

    it('hides only the active chart type\'s base layer, and only while the candles are hidden', () => {
        const r = new NativeRenderer() as unknown as Probe;
        const chartType = layer('demo');
        const overlayInstance = layer('demo', 'native-2'); // the same layer class mounted for an overlay indicator
        const other = layer('other');
        r.scene.priceStyle = 'demo';
        r.scene.candlesHidden = false;
        expect(r.layerHiddenWithCandles(chartType)).toBe(false);
        r.scene.candlesHidden = true;
        expect(r.layerHiddenWithCandles(chartType)).toBe(true);
        expect(r.layerHiddenWithCandles(overlayInstance)).toBe(false);
        expect(r.layerHiddenWithCandles(other)).toBe(false);
        r.scene.priceStyle = 'candles'; // the type's layer is not the chart anymore — it is an indicator's now
        expect(r.layerHiddenWithCandles(chartType)).toBe(false);
    });

    // The autoscale asks this before dropping the candles from the price pane's scale: an
    // overlay layer native paints at bar prices with no series of its own, so without the
    // bars the scale would collapse to {0,1} and it would paint off-screen.
    it('keeps the bars in the price scale for an overlay layer native only', () => {
        const r = new NativeRenderer() as unknown as Probe;
        expect(r.priceLayersAnchoredToBars([])).toBe(false);
        r.extLayers = [layer('demo'), layer('demo', 'native-2')];
        r.scene.priceStyle = 'candles';
        expect(r.priceLayersAnchoredToBars([model('pine', undefined, [{ kind: 'line' }])])).toBe(false);
        expect(r.priceLayersAnchoredToBars([model('vol', 'volume')])).toBe(false); // bespoke layer, not an SDK layer
        expect(r.priceLayersAnchoredToBars([model('native-2', 'demo')])).toBe(true);
        expect(r.priceLayersAnchoredToBars([model('native-9', 'other')])).toBe(false); // no layer registered for that type
        r.scene.priceStyle = 'demo'; // the active chart type's own layer is blanked with the candles — no reason to keep the bars
        expect(r.priceLayersAnchoredToBars([])).toBe(false);
    });

    // With the candles hidden and NOTHING else measurable on the price pane, the bars keep
    // driving the scale (the axis stays on the price range instead of the {0,1} placeholder).
    // Any content that computePaneScale would measure takes the scale over as before.
    it('reports measurable master content the way the autoscale sees it', () => {
        type P = { paneHasMeasurableContent(models: unknown[], dr: unknown): boolean };
        const r = new NativeRenderer() as unknown as P;
        const m = (o: { series?: unknown[]; priceLines?: unknown[]; native?: string }) => ({ id: 'x', title: 'x', paneId: 'price', series: o.series ?? [], priceLines: o.priceLines ?? [], ...(o.native ? { native: { type: o.native } } : {}) });
        expect(r.paneHasMeasurableContent([], null)).toBe(false);
        expect(r.paneHasMeasurableContent([m({ native: 'volume' })], null)).toBe(false); // series-less native
        expect(r.paneHasMeasurableContent([m({ series: [{ kind: 'line', overlay: true }] })], null)).toBe(false); // force_overlay scales via the drawings range instead
        expect(r.paneHasMeasurableContent([m({ series: [{ kind: 'line' }] })], null)).toBe(true);
        expect(r.paneHasMeasurableContent([m({ priceLines: [{ price: 1 }] })], null)).toBe(true);
        expect(r.paneHasMeasurableContent([], { min: 1, max: 2 })).toBe(true);
    });
});

describe('chart-type SDK settings (config bag + channel + notification)', () => {
    it('applyConfig persists chartTypes values, pushes the -settings channel, and notifies', () => {
        const r = new NativeRenderer();
        const scene = (r as unknown as { scene: SceneGraph }).scene;
        const notified: Array<[string, unknown]> = [];
        r.onChartTypeSettingsChange((id, values) => notified.push([id, values]));

        r.applyConfig({ chartTypes: { demo: { levels: 20, on: true } } });
        expect((r.getConfig() as { chartTypes: Record<string, unknown> }).chartTypes.demo).toEqual({ levels: 20, on: true });
        expect(scene.nativeData.get('demo-settings')).toEqual({ levels: 20, on: true });
        expect(notified).toEqual([['demo', { levels: 20, on: true }]]);

        // Partial update merges per type; unchanged types do not re-notify.
        r.applyConfig({ chartTypes: { demo: { levels: 30 } } });
        expect(scene.nativeData.get('demo-settings')).toEqual({ levels: 30, on: true });
        expect(notified).toHaveLength(2);
        r.applyConfig({ layout: { fontSize: 12 } }); // untouched bag → no notification
        expect(notified).toHaveLength(2);
    });
});
