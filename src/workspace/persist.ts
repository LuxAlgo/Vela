// Workspace STATE + persistence — the document, its validating codec, and the storage
// seam. Design intent: the state SURFACE is the product (`ws.getState()` /
// `ws.applyState()` / the `state:changed` notification); persistence is just an
// adapter the workspace drives through {@link WorkspaceStorage}. Nothing here touches
// the URL — hosts wanting shareable links compose them from `getState()` themselves.
import type { WidgetStorage } from '../widget/persist';
import type { SyncOptions, SyncSetting } from './sync';
import type { TrackSizes } from './layouts';
import type { PooledCellState } from './ChartCell';

/**
 * The pluggable storage backend the workspace persists through — the SAME contract as
 * the widget's (`get`/`set`, each synchronous OR promise-returning, so localStorage-like
 * and REST/IndexedDB-like backends both fit). The default is {@link memoryStorageAdapter}
 * — session-lived only; plug your own for durability.
 */
export type WorkspaceStorage = WidgetStorage;

/** The versioned, serializable workspace document — everything `applyState` restores. */
export interface WorkspaceState {
    version: 1;
    /** The layout id. Restoring an id that is not registered keeps the current layout —
     *  register custom layouts (`registerLayout`) before applying a saved state. */
    layout: string;
    /** Splitter track weights, per layout id. */
    trackSizes?: Record<string, TrackSizes>;
    activeCellId?: string;
    sync?: SyncOptions;
    timezone?: string;
    /** Per-slot state (live AND dormant slots): market seed, renderer config document,
     *  user-drawings document, and the indicator ledger. */
    cells: Record<string, PooledCellState>;
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
    const sync = sanitizeSync(d.sync);
    if (sync) out.sync = sync;
    const tracks = sanitizeTrackSizes(d.trackSizes);
    if (tracks) out.trackSizes = tracks;
    return out;
}

function sanitizeCell(raw: unknown): PooledCellState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const out: PooledCellState = {};
    if (typeof c.symbol === 'string') out.symbol = c.symbol;
    if (typeof c.provider === 'string') out.provider = c.provider;
    if (typeof c.timeframe === 'string') out.timeframe = c.timeframe;
    if (typeof c.priceStyle === 'string') out.priceStyle = c.priceStyle;
    if (typeof c.bars === 'number' && Number.isFinite(c.bars) && c.bars > 0) out.bars = c.bars;
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
    for (const kind of ['viewport', 'symbol', 'timeframe'] as const) {
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

/** The page-session store behind the DEFAULT adapter: module-level, so a destroyed and
 *  re-created workspace (SPA navigation) restores — a reload starts fresh by design. */
const memoryStore = new Map<string, string>();

/** The default {@link WorkspaceStorage}: in-memory, session-lived. Durable persistence
 *  (localStorage, REST, IndexedDB…) is the host's choice via the `storage` option. */
export function memoryStorageAdapter(): WorkspaceStorage {
    return {
        get: (key) => memoryStore.get(key) ?? null,
        set: (key, value) => {
            memoryStore.set(key, value);
        },
        remove: (key) => {
            memoryStore.delete(key);
        },
    };
}
