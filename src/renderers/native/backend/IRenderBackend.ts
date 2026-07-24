import type { VelaTheme } from '../../../core/options';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph } from '../core/SceneGraph';

/**
 * The single seam between the renderer and a drawing backend. The backend
 * consumes the retained scene + the shared coordinate system and rasterizes the
 * data layer (series, fills, bgcolor, hline, drawing geometry) plus its axes/
 * grid onto the data canvas. Two implementations sit behind it: `Canvas2dBackend`
 * (primary) and, later, `WebGL2Backend` (hand-rolled, selected when available).
 *
 * The crosshair is NOT the backend's concern — it's a renderer-owned overlay
 * layer (`CrosshairRenderer`) on its own canvas, repainted on the Scheduler's
 * cheap `Cursor` tier without touching the data layer.
 */
export interface IRenderBackend {
    readonly kind: 'canvas2d' | 'webgl2';
    /** Opacity multiplier for indicator models (series/fills/bgcolor/hline); candles,
     *  grid and axes stay opaque. The renderer drives it to fade indicators in after the intro. */
    modelAlpha: number;
    /** Opacity of the candle BODY fill (and non-candle price series). `1` normally; the
     *  renderer fades it toward transparent as a reveal-under layer opens on zoom-in. */
    candleBodyAlpha: number;
    /** Opacity of the candle STRUCTURE (wicks + body border). `1` normally; fades only
     *  partway on zoom-in so the candle keeps a visible skeleton over the revealed layer. */
    candleStructureAlpha: number;
    /** Opacity of the price/time gridlines. `1` normally; fades to `0` as a reveal-under
     *  reveals so the grid doesn't show through the translucent candle bodies (a "grid" look). */
    gridAlpha: number;
    /** Multiplier on the candle BODY width. `1` normally; the renderer shrinks it as a
     *  side-positioned reveal layer opens, freeing the inter-candle gap for it. */
    candleBodyScale: number;
    /** Bind to the (already DOM-sized) data canvas. */
    mount(canvas: HTMLCanvasElement): void;
    /** Paint the data layer for the current frame. */
    render(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme): void;
    destroy(): void;
}
