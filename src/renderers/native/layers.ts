// The public RENDERER-LAYER registry — the native renderer's extension seam for custom
// canvas layers (the counterpart of the chart-type registry on the data side). A layer owns
// ONE transparent canvas stacked into the chart's layer pile and is repainted from the shared
// paint cycle with the chart's bars, its own native-data channel, and the pane geometry.
//
// Register at IMPORT TIME (before charts are constructed): a renderer instantiates the
// registered layers when it mounts. The layer's `id` doubles as its data channel — the core
// pushes `setNativeData(id, …)` payloads (e.g. from a chart type's SeriesDataEngine via
// `host.pushData`) and `setNativeData(`${id}-pending`, …)` loading ranges; both arrive in the
// layer's render args every frame.
import type { OHLCV } from '../../core/model/ohlcv';
import type { VelaTheme } from '../../core/options';
import type { CoordinateSystem, PriceScale, PaneBounds } from './core/CoordinateSystem';

/** Everything a layer needs to paint one frame. */
export interface RendererLayerArgs {
    /** The chart's CURRENT view bars (post bar-transform). */
    bars: readonly OHLCV[];
    /** The layer's channel payload (last `setNativeData(id, …)` push; undefined before the first). */
    data: unknown;
    /** The type's SDK settings values (`<id>-settings` channel; {} before any edit). */
    settings: Record<string, unknown>;
    /** Time ranges still loading (`<id>-pending` channel) — skeleton/reveal UIs. */
    pending: ReadonlyArray<readonly [number, number]>;
    coords: CoordinateSystem;
    /** The price pane's scale + bounds. */
    scale: PriceScale;
    bounds: PaneBounds;
    theme: VelaTheme;
    /** The active price style — layers tied to a chart type gate their visibility on it. */
    priceStyle: string;
    /** Frame clock (ms) for pulses/fades; monotonic within a session. */
    nowMs: number;
}

/** One live layer instance (per mounted renderer). */
export interface RendererLayerInstance {
    /** The renderer created (and owns) this transparent canvas — keep the reference, paint into it. */
    mount(canvas: HTMLCanvasElement): void;
    /** Paint one frame. Always clear/redraw your own canvas — the renderer never clears it for you. */
    render(args: RendererLayerArgs): void;
    /** Return true while the layer needs CONTINUOUS frames (a pulse/fade) — keeps the animator alive. */
    animating?(): boolean;
    /** The renderer unmounted — release everything (the canvas itself is removed by the renderer). */
    destroy?(): void;
}

/** One registered layer kind. */
export interface RendererLayerDefinition {
    /** The layer id — also its native-data channel (`setNativeData(id, …)` / `id + '-pending'`). */
    id: string;
    /** Stacking: `'below-data'` = behind the candles (reveal-under styles); `'above-data'` =
     *  over the candles, under the chrome/axes. Default `'above-data'`. */
    placement?: 'below-data' | 'above-data';
    /** Instance factory — called once per mounted renderer. */
    create(): RendererLayerInstance;
}

const registry = new Map<string, RendererLayerDefinition>();

/** Register (or replace) a renderer layer. Renderers mounted AFTER registration pick it up. */
export function registerRendererLayer(def: RendererLayerDefinition): void {
    registry.set(def.id, def);
}

export function unregisterRendererLayer(id: string): void {
    registry.delete(id);
}

/** Every registered layer definition (registration order). */
export function rendererLayers(): RendererLayerDefinition[] {
    return [...registry.values()];
}
