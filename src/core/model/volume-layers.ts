/**
 * Config payloads the built-in volume native indicators push to the renderer's bespoke
 * layers via `setNativeData` (see the port). Both indicators draw with their OWN local
 * scale (never through the indicator model), so their units can't disturb the price
 * autoscale; the payloads carry only cosmetics/shape — the layers read the chart's bars
 * directly each frame.
 */

/** `setNativeData('volume', …)`: bottom-anchored per-bar volume columns on the price pane. */
export interface VolumeLayerData {
    upColor: string;
    downColor: string;
    /** Pane-height fraction (0..1) the tallest VISIBLE bar occupies (the layer's own scale). */
    heightFrac: number;
}

/** `setNativeData('vpvr', …)`: right-anchored visible-range volume-by-price profile. */
export interface VpvrLayerData {
    /** Number of price rows the visible range is bucketed into. */
    rows: number;
    /** Pane-width fraction (0..1) of the largest row (the profile's horizontal scale). */
    widthFrac: number;
    upColor: string;
    downColor: string;
    /** Outline the point-of-control (highest-volume) row. */
    showPoc: boolean;
    /** Volume fraction (0..1) the highlighted value area covers (rows outside it draw dimmer). */
    valueAreaFrac: number;
}
