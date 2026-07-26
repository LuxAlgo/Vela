// Widget state persistence — pluggable storage. localStorage by default; hosts inject
// any `WidgetStorage` (sync like localStorage, or async like a REST/IndexedDB backend).
// Reads may return promises: the widget applies sync values at construction and
// late-applies async ones when they resolve.
//
// The persisted FORMAT is the unified state document (`src/state/document.ts`) — the
// same one the workspace uses, with a single `c1` cell. `PersistedState` below is the
// LEGACY pre-unified prefs shape, kept for one-time migration of old keys.
import type { WorkspaceState, CellState } from '../state/document';

/** The storage contract. Methods may be synchronous or return promises. */
export interface WidgetStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}

/** The default adapter — window.localStorage, silent on quota/privacy failures. */
export function localStorageAdapter(): WidgetStorage {
    return {
        get(key) {
            try {
                return localStorage.getItem(key);
            } catch {
                return null;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch {
                /* best-effort */
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch {
                /* best-effort */
            }
        },
    };
}

export interface PersistedState {
    symbol?: string;
    timeframe?: string;
    priceStyle?: string;
    timezone?: string;
    bars?: string;
    watermark?: string;
    /** Comma-joined favorite drawing-tool types. */
    favorites?: string;
}

const KEYS: readonly (keyof PersistedState)[] = ['symbol', 'timeframe', 'priceStyle', 'timezone', 'bars', 'watermark', 'favorites'];

/** Parse a LEGACY prefs payload (never throws — junk yields `{}`). */
export function parsePersisted(raw: string | null): PersistedState {
    if (!raw) return {};
    try {
        const doc = JSON.parse(raw) as Record<string, unknown>;
        const out: PersistedState = {};
        for (const k of KEYS) if (typeof doc[k] === 'string') out[k] = doc[k];
        return out;
    } catch {
        return {};
    }
}
const parseState = parsePersisted;

/** Load the persisted state — synchronous result for sync storages, else a promise. */
export function loadPersisted(storage: WidgetStorage, storageKey: string): PersistedState | Promise<PersistedState> {
    const raw = storage.get(storageKey);
    if (raw instanceof Promise) return raw.then(parseState).catch(() => ({}));
    return parseState(raw);
}

/** Save (fire-and-forget — async adapter failures are the adapter's concern). */
export function savePersisted(storage: WidgetStorage, storageKey: string, state: PersistedState): void {
    try {
        void storage.set(storageKey, JSON.stringify(state));
    } catch {
        /* best-effort */
    }
}

/**
 * LEGACY migration — convert the widget's pre-unified three-key layout (prefs under
 * the main key, renderer config under `<key>:config`, drawings under `<key>:drawings`)
 * into ONE unified state document (the same format the workspace persists, with a
 * single `c1` cell). Null when the payload holds no usable state. Pure — the caller
 * reads the keys, then rewrites the main key and drops the legacy sub-keys.
 */
export function legacyWidgetState(prefs: PersistedState, rawConfig: string | null, rawDrawings: string | null): WorkspaceState | null {
    const cell: CellState = {};
    if (prefs.symbol) cell.symbol = prefs.symbol;
    if (prefs.timeframe) cell.timeframe = prefs.timeframe;
    if (prefs.priceStyle) cell.priceStyle = prefs.priceStyle;
    const bars = Number(prefs.bars);
    if (Number.isFinite(bars) && bars > 0) cell.bars = bars;
    if (prefs.watermark !== undefined) cell.watermark = prefs.watermark === '1';
    try {
        if (rawConfig) cell.rendererConfig = JSON.parse(rawConfig) as unknown;
    } catch {
        /* a corrupt legacy document is dropped, never fatal */
    }
    try {
        if (rawDrawings) cell.drawings = JSON.parse(rawDrawings) as unknown;
    } catch {
        /* ditto */
    }
    const favorites = prefs.favorites ? prefs.favorites.split(',').filter(Boolean) : [];
    if (Object.keys(cell).length === 0 && favorites.length === 0 && !prefs.timezone) return null;
    const doc: WorkspaceState = { version: 1, layout: '1', activeCellId: 'c1', cells: { c1: cell } };
    if (prefs.timezone) doc.timezone = prefs.timezone;
    if (favorites.length > 0) doc.favorites = favorites;
    return doc;
}
