import type { SeriesKind } from './series';

/** Things that need a stable id within an indicator instance. */
export type IdentifiableKind = SeriesKind | 'fill' | 'background' | 'hline' | 'line' | 'box' | 'label' | 'polyline' | 'linefill' | 'table';

/**
 * Content-addressed id for a plotted element, stable across re-runs of
 * identical source.
 *
 * Deliberately NOT PineTS's `_callsiteId`: that is a transpile-order counter
 * that renumbers whenever the source is edited (insert a `plot()` near the top
 * and every downstream callsite shifts), so keying persistent state on it would
 * silently rebind to the wrong element. The ordinal disambiguates multiple
 * plots that share a title within one indicator.
 */
export function stableSeriesId(parts: {
    instanceId: string;
    kind: IdentifiableKind;
    title: string;
    ordinal: number;
}): string {
    const normTitle = parts.title.trim().toLowerCase().replace(/\s+/g, '-');
    return `${parts.instanceId}:${parts.kind}:${normTitle}#${parts.ordinal}`;
}
