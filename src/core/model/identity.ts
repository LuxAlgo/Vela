import type { SeriesKind } from './series';

/** Things that need a stable id within an indicator instance. */
export type IdentifiableKind = SeriesKind | 'fill' | 'background' | 'hline' | 'line' | 'box' | 'label' | 'polyline' | 'linefill' | 'table';

/**
 * Content-addressed id for a plotted element, stable across re-runs of
 * identical source.
 *
 * Deliberately NOT an engine's own callsite counter: those renumber whenever the
 * source is edited (insert a plot near the top and every downstream callsite
 * shifts), so keying persistent state on one would silently rebind to the wrong
 * element. The ordinal disambiguates multiple plots that share a title within one
 * indicator. Every engine MUST mint its series ids through this — it is the
 * identity contract value patches are keyed by.
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
