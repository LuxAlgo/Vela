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

/** The renderer-config keys the STYLE link mirrors: the Canvas tab (`layout` =
 *  background/text, `panes` = separators, `grid`) and the Scales-and-lines tab
 *  (`priceScale`, `crosshair`). Deliberately NOT the whole document: series/style
 *  blocks stay per cell (a candles cell and a line cell keep their own looks), and
 *  `timeScale` stays out because the display timezone is already workspace-global. */
export const STYLE_SYNC_CONFIG_KEYS = ['layout', 'panes', 'grid', 'priceScale', 'crosshair'] as const;

/** The style-link slice of a renderer config document — PURE (null when the
 *  document is shapeless or carries none of the mirrored keys). */
export function styleConfigSlice(config: unknown): Record<string, unknown> | null {
    if (config == null || typeof config !== 'object') return null;
    const doc = config as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of STYLE_SYNC_CONFIG_KEYS) {
        if (doc[key] != null && typeof doc[key] === 'object') out[key] = doc[key];
    }
    return Object.keys(out).length > 0 ? out : null;
}
