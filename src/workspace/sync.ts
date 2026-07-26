// The workspace SYNC model — pure data + pure functions (DOM-free, unit-testable).
//
// Links between cells are GROUP-based from day one: `true` is sugar for "every cell in
// one implicit group", and a record maps cell ids to named groups (the colored-group UI
// later is pure presentation over this same model). Propagation itself lives in the
// workspace (it owns the cells); this module answers the one pure question — "which
// cells follow this origin?" — plus the epsilon test that keeps viewport loops quiet.

/** The linkable dimensions. `crosshair` is RESERVED: it needs a renderer capability
 *  that has not shipped yet — setting it warns and is ignored. */
export type SyncKind = 'viewport' | 'symbol' | 'timeframe' | 'crosshair';

/**
 * One link's configuration: `false`/absent = off; `true` = ALL cells linked (one
 * implicit group); a record maps cell id → group name, and only cells sharing a group
 * follow each other (a cell absent from the record is unlinked).
 */
export type SyncSetting = boolean | Readonly<Record<string, string>>;

export interface SyncOptions {
    viewport?: SyncSetting;
    symbol?: SyncSetting;
    timeframe?: SyncSetting;
    crosshair?: SyncSetting;
}

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
