// Stacking of the SDK renderer-layer canvases against the data canvas. Model series all
// composite inside the ONE data canvas (SceneGraph sorts them by z), so a layer canvas can
// only slot below or above that whole canvas — this module decides which side and in what
// order, from the z key of the indicator that OWNS the layer (the mounted native indicator
// whose type equals the layer id — the id doubles as the data channel, so the pairing is
// already the SDK's contract). Unowned layers (chart-type channels) keep their declared
// placement. Pure and unit-tested; the renderer applies the result to the DOM pile and the
// screenshot compositor.

/** One mounted layer's stacking inputs. */
export interface LayerStackEntry {
    /** The layer id (= its data channel). */
    id: string;
    /** The definition's declared placement (default 'above-data'). */
    placement: 'below-data' | 'above-data';
    /** z key of the owning indicator, or null when no mounted indicator owns this layer. */
    ownerZ: number | null;
}

/**
 * Split the mounted layers around the data canvas, each side back-to-front. An owned
 * layer sits by its owner's z against `candleZ` (below the data canvas when z < candleZ,
 * else above — matching how a model series at that z would paint against the candles).
 * Unowned 'below-data' layers stay at the very back; unowned 'above-data' layers sit
 * directly over the data canvas, under any owned layer raised above it. Ties keep
 * registration order (the sort is stable). "The very back" is still above the grid:
 * the backdrop canvas (highlights + gridlines) sits below every layer this orders.
 */
export function stackLayers(entries: readonly LayerStackEntry[], candleZ: number): { below: string[]; above: string[] } {
    const keyed = entries.map((e) => ({
        id: e.id,
        key: e.ownerZ ?? (e.placement === 'below-data' ? -Infinity : candleZ),
    }));
    keyed.sort((a, b) => a.key - b.key);
    const below: string[] = [];
    const above: string[] = [];
    for (const k of keyed) (k.key < candleZ ? below : above).push(k.id);
    return { below, above };
}
