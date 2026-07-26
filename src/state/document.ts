// The ONE serializable shell-state document, shared by BOTH shells: `vela/workspace`
// persists a multi-cell document; `vela/widget` persists the SAME document with a
// single `c1` cell (`layout: '1'`). One format means one mental model, one codec, and
// state that moves freely between shells (a saved widget chart drops into a workspace
// slot as-is). This module is NEUTRAL — it imports from neither shell; both re-export
// it (`vela/widget` and `vela/workspace` expose the same names).
//
// Design intent: the state SURFACE is the product (`getState()` / `applyState()` /
// the `state:changed` notification); persistence is just an adapter driven through
// the storage seam. Nothing here touches the URL — hosts wanting shareable links
// compose them from `getState()` themselves.

/** The linkable dimensions. `crosshair` mirrors the pointer time onto same-group
 *  cells as GHOST crosshairs (renderers without the optional `setExternalCrosshair`
 *  seam simply never display one). */
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

/** Splitter track weights along each grid axis. */
export interface TrackSizes {
    cols?: number[];
    rows?: number[];
}

/** Per-chart (per-cell) state: the market, the display prefs, the content documents,
 *  and the indicator ledger. The widget's whole chart state is ONE of these. */
export interface CellState {
    symbol?: string;
    provider?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
    /** Symbol watermark visibility — a per-chart display pref. */
    watermark?: boolean;
    /** The renderer's cosmetic config document (`renderer.getConfig()`). */
    rendererConfig?: unknown;
    /** The user-drawings document (`drawings.toJSON()`). */
    drawings?: unknown;
    /** The indicator ledger: manifest entries by name + present native types. */
    indicators?: { manifest: string[]; natives: string[] };
}

/** The versioned shell-state document — everything `applyState` restores. */
export interface WorkspaceState {
    version: 1;
    /** The layout id — always `'1'` for a widget. Restoring an id that is not
     *  registered keeps the current layout — register custom layouts
     *  (`registerLayout`) before applying a saved state. */
    layout: string;
    /** Splitter track weights, per layout id (workspace only). */
    trackSizes?: Record<string, TrackSizes>;
    activeCellId?: string;
    /** Sync links (workspace only). */
    sync?: SyncOptions;
    /** Shared display timezone. */
    timezone?: string;
    /** Favorite drawing-tool types — a SHARED preference (one star set per shell). */
    favorites?: string[];
    /** Per-slot state — a single `c1` entry for the widget. */
    cells: Record<string, CellState>;
}

/** Serialize a state document (the inverse of {@link decodeState}). */
export function encodeState(state: WorkspaceState): string {
    return JSON.stringify(state);
}

/** Parse + sanitize a persisted payload. Null on anything unusable (wrong version,
 *  not JSON, not an object) — malformed FIELDS are dropped, never thrown on. */
export function decodeState(raw: string): WorkspaceState | null {
    try {
        return sanitizeState(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Validate an untrusted state document field by field (the `applyState` gate). Unknown
 * or malformed fields are dropped; nested renderer-config / drawings documents pass
 * through OPAQUELY — their own consumers (`applyConfig`, `fromJSON`) validate them.
 */
export function sanitizeState(doc: unknown): WorkspaceState | null {
    if (doc == null || typeof doc !== 'object') return null;
    const d = doc as Record<string, unknown>;
    if (d.version !== 1 || typeof d.layout !== 'string') return null;
    const out: WorkspaceState = { version: 1, layout: d.layout, cells: {} };

    if (d.cells != null && typeof d.cells === 'object') {
        for (const [id, raw] of Object.entries(d.cells as Record<string, unknown>)) {
            const cell = sanitizeCell(raw);
            if (cell) out.cells[id] = cell;
        }
    }
    if (typeof d.activeCellId === 'string') out.activeCellId = d.activeCellId;
    if (typeof d.timezone === 'string' && d.timezone) out.timezone = d.timezone;
    if (Array.isArray(d.favorites)) {
        const favs = d.favorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.favorites = favs;
    }
    const sync = sanitizeSync(d.sync);
    if (sync) out.sync = sync;
    const tracks = sanitizeTrackSizes(d.trackSizes);
    if (tracks) out.trackSizes = tracks;
    return out;
}

function sanitizeCell(raw: unknown): CellState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const out: CellState = {};
    if (typeof c.symbol === 'string') out.symbol = c.symbol;
    if (typeof c.provider === 'string') out.provider = c.provider;
    if (typeof c.timeframe === 'string') out.timeframe = c.timeframe;
    if (typeof c.priceStyle === 'string') out.priceStyle = c.priceStyle;
    if (typeof c.bars === 'number' && Number.isFinite(c.bars) && c.bars > 0) out.bars = c.bars;
    if (typeof c.watermark === 'boolean') out.watermark = c.watermark;
    if (c.rendererConfig != null && typeof c.rendererConfig === 'object') out.rendererConfig = c.rendererConfig;
    if (c.drawings != null && typeof c.drawings === 'object') out.drawings = c.drawings;
    const ind = c.indicators as Record<string, unknown> | undefined;
    if (ind != null && typeof ind === 'object') {
        const manifest = Array.isArray(ind.manifest) ? ind.manifest.filter((n): n is string => typeof n === 'string') : [];
        const natives = Array.isArray(ind.natives) ? ind.natives.filter((n): n is string => typeof n === 'string') : [];
        out.indicators = { manifest, natives };
    }
    return out;
}

function sanitizeSync(raw: unknown): SyncOptions | null {
    if (raw == null || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const out: SyncOptions = {};
    for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair'] as const) {
        const v = s[kind];
        if (v === true) out[kind] = true;
        else if (v != null && typeof v === 'object') {
            const groups: Record<string, string> = {};
            for (const [id, g] of Object.entries(v as Record<string, unknown>)) if (typeof g === 'string') groups[id] = g;
            if (Object.keys(groups).length > 0) out[kind] = groups as SyncSetting;
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizeTrackSizes(raw: unknown): Record<string, TrackSizes> | null {
    if (raw == null || typeof raw !== 'object') return null;
    const out: Record<string, TrackSizes> = {};
    for (const [layoutId, ts] of Object.entries(raw as Record<string, unknown>)) {
        if (ts == null || typeof ts !== 'object') continue;
        const t = ts as Record<string, unknown>;
        const entry: TrackSizes = {};
        for (const axis of ['cols', 'rows'] as const) {
            const arr = t[axis];
            if (Array.isArray(arr) && arr.length > 0 && arr.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)) {
                entry[axis] = arr as number[];
            }
        }
        if (entry.cols || entry.rows) out[layoutId] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
}
