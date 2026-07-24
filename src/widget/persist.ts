// Widget state persistence — pluggable storage. localStorage by default; hosts inject
// any `WidgetStorage` (sync like localStorage, or async like a REST/IndexedDB backend).
// Reads may return promises: the widget applies sync values at construction and
// late-applies async ones when they resolve.

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
}

const KEYS: readonly (keyof PersistedState)[] = ['symbol', 'timeframe', 'priceStyle', 'timezone', 'bars', 'watermark'];

function parseState(raw: string | null): PersistedState {
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
