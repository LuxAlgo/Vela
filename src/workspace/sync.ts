// The workspace SYNC model — pure data + pure functions (DOM-free, unit-testable).
//
// Links between cells are GROUP-based from day one: `true` is sugar for "every cell in
// one implicit group", and a record maps cell ids to named groups (the colored-group UI
// later is pure presentation over this same model). Propagation itself lives in the
// workspace (it owns the cells); this module answers the one pure question — "which
// cells follow this origin?" — plus the epsilon test that keeps viewport loops quiet.

// The link TYPES live in the shared state document (`src/state/document.ts`) — sync
// settings are part of the persisted format. Re-exported here unchanged.
import type { SyncSetting } from '../state/document';
import { CANDLE_OVERRIDE_KEYS } from '../renderers/native/core/chartConfig';

export type { SyncKind, SyncSetting, SyncOptions } from '../state/document';
export { SYNC_KINDS } from '../state/document';

/** The cells that follow `originId` under `setting` — PURE (never includes the origin). */
export function syncTargets(originId: string, setting: SyncSetting | undefined, cellIds: readonly string[]): string[] {
    if (setting == null || setting === false) return [];
    if (setting === true) return cellIds.filter((id) => id !== originId);
    const group = setting[originId];
    if (group == null) return []; // the origin is unlinked — nothing follows it
    return cellIds.filter((id) => id !== originId && setting[id] === group);
}

/** Whether two visible ranges agree within `epsMs` on both edges — the short-circuit
 *  that stops viewport echo (a followers' re-emission never re-propagates). */
export function rangesWithin(a: { from: number; to: number }, b: { from: number; to: number }, epsMs: number): boolean {
    return Math.abs(a.from - b.from) <= epsMs && Math.abs(a.to - b.to) <= epsMs;
}

/** The renderer-config blocks the STYLE link mirrors whole — every look the settings
 *  dialog edits: the Symbol tab's per-style cosmetics (`candles` … `baseline`) and
 *  animation switches, the Canvas tab (`layout` = background/text, `panes` =
 *  separators, `grid`, `margins`), the Scales-and-lines tab (`priceScale`,
 *  `crosshair`), and the session shading colors. Two blocks travel in part (see
 *  {@link styleConfigPatch}); the rest stays per cell: the draw-order keys name each
 *  cell's own indicators, timeline marks and trade markers are what the host feeds
 *  that cell's market, and `timeScale` is already workspace-global. */
export const STYLE_SYNC_CONFIG_KEYS = [
    'layout',
    'panes',
    'grid',
    'margins',
    'priceScale',
    'crosshair',
    'animations',
    'candles',
    'bars',
    'line',
    'area',
    'baseline',
    'sessions',
] as const;

/**
 * The patch that brings `follower` to `origin`'s style-link slice — PURE (null when
 * the two already agree, or when either document is shapeless). Whole blocks travel
 * as the origin resolved them. `series` contributes only its bar spacing: the chart
 * type stays per cell (a candles cell and a line cell keep their own type) and the
 * baseline price belongs to the cell's market. A plugin chart type contributes only
 * the candle cosmetics it stores in its bag — its own settings mix looks with
 * market-bound computation (sessions, row size) — and a candle key the origin
 * inherits travels as `null`, so the follower inherits it too.
 */
export function styleConfigPatch(origin: unknown, follower: unknown): Record<string, unknown> | null {
    const from = asRecord(origin);
    const to = asRecord(follower);
    if (!from || !to) return null;
    const patch: Record<string, unknown> = {};
    for (const key of STYLE_SYNC_CONFIG_KEYS) {
        const block = asRecord(from[key]);
        if (block && JSON.stringify(block) !== JSON.stringify(to[key])) patch[key] = block;
    }
    const spacing = asRecord(from.series)?.spacing;
    if (typeof spacing === 'number' && spacing !== asRecord(to.series)?.spacing) patch.series = { spacing };
    const fromTypes = asRecord(from.chartTypes) ?? {};
    const toTypes = asRecord(to.chartTypes) ?? {};
    const types: Record<string, Record<string, unknown>> = {};
    for (const typeId of new Set([...Object.keys(fromTypes), ...Object.keys(toTypes)])) {
        const src = asRecord(fromTypes[typeId]) ?? {};
        const dst = asRecord(toTypes[typeId]) ?? {};
        for (const key of CANDLE_OVERRIDE_KEYS) {
            const value = src[key] ?? null;
            if (value !== (dst[key] ?? null)) (types[typeId] ??= {})[key] = value;
        }
    }
    if (Object.keys(types).length > 0) patch.chartTypes = types;
    return Object.keys(patch).length > 0 ? patch : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
    return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
