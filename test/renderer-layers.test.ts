// The SDK renderer-layer seam (src/renderers/native/layers.ts): registry semantics and the
// generic native-data channel routing on the renderer (unmounted — mounted painting is
// exercised in the browser playground; the channel/scene plumbing is the unit-testable part).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { registerRendererLayer, unregisterRendererLayer, rendererLayers, foldBaseModulation, type RendererLayerArgs, type RendererLayerInstance } from '../src/renderers/native/layers';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';

afterEach(() => {
    unregisterRendererLayer('demo');
    unregisterChartType('demo');
});

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

describe('price-series visibility for SDK renderer layers', () => {
    it('blanks the active custom chart-type layer while overlay and indicator layers keep painting', () => {
        registerChartType({ id: 'demo', basePainting: 'none' });
        const renderer = new NativeRenderer();
        const r = renderer as unknown as Record<string, any>;
        const scene = r.scene as SceneGraph;
        scene.ensurePane('price', 'price', 0, 3);
        renderer.applyFeature('priceStyle', 'demo');

        const chartTypeRender = vi.fn();
        const overlayRender = vi.fn();
        const indicatorRender = vi.fn();
        const clearChartType = vi.fn();
        const canvas = (clear = vi.fn()) => ({
            width: 10,
            height: 10,
            getContext: () => ({ clearRect: clear }),
        });
        r.extLayers = [
            { def: { id: 'demo', repaintOnCursor: true }, instance: { render: chartTypeRender }, canvas: canvas(clearChartType) },
            { def: { id: 'overlay', repaintOnCursor: true }, instance: { render: overlayRender }, canvas: canvas() },
            { def: { id: 'study-layer', repaintOnCursor: true }, instance: { render: indicatorRender }, canvas: canvas() },
        ];
        scene.indicators.set('study', {
            id: 'study',
            title: 'Study',
            series: [],
            paneId: 'price',
            native: { type: 'study-layer' },
        } as never);
        r.syncLayerCanvasOrder = () => undefined;
        r.stampScaleInvert = () => undefined;
        r.backend = { modelAlpha: 1, candleBodyAlpha: 1, candleStructureAlpha: 1, candleBodyScale: 1, render: vi.fn() };
        r.volumeRenderer = { render: vi.fn() };
        r.vpvrRenderer = { render: vi.fn() };
        r.animator = { start: vi.fn() };
        r.indicatorSlices = { prepare: () => new Map() };
        r.dataCanvas = {};
        r.backdropRenderer = { render: vi.fn() };
        r.chrome = { render: vi.fn() };
        r.axisSurface = () => ({});

        r.paintData();
        expect(chartTypeRender).toHaveBeenCalledOnce();
        expect(overlayRender).toHaveBeenCalledOnce();
        expect(indicatorRender).toHaveBeenCalledOnce();

        renderer.applyFeature('candleVisible', false);
        r.paintData();
        expect(chartTypeRender).toHaveBeenCalledOnce();
        expect(clearChartType).toHaveBeenCalledOnce();
        expect(overlayRender).toHaveBeenCalledTimes(2);
        expect(indicatorRender).toHaveBeenCalledTimes(2);

        r.repaintCursorLayers();
        expect(chartTypeRender).toHaveBeenCalledOnce();
        expect(overlayRender).toHaveBeenCalledTimes(3);
        expect(indicatorRender).toHaveBeenCalledTimes(3);
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
