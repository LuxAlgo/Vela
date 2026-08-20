// Shell state persistence — pluggable storage. localStorage by default; hosts inject
// any `VelaStorage` (sync like localStorage, or async like a REST/IndexedDB backend).
// The persisted FORMAT is the unified state document (`src/state/document.ts`) — one
// codec for every shell.

/** The storage contract BOTH shells persist through (the widget wrapper and the
 *  workspace — one name, one shape). Methods may be synchronous or return promises. */
export interface VelaStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}

/** @deprecated Use {@link VelaStorage} — same contract, shell-neutral name. */
export type WidgetStorage = VelaStorage;

/**
 * The default adapter — window.localStorage, silent on quota/privacy failures.
 *
 * `storageKey` pins the PHYSICAL localStorage entry: every read/write lands on that
 * one name, whatever logical key the shell passes — the way to choose where the state
 * lives without touching the `persist` option (one shell instance per adapter then;
 * two shells sharing a pinned adapter would overwrite each other). Omitted, the
 * shell's own key is used as-is (the historical behavior).
 */
export function localStorageAdapter(storageKey?: string): WidgetStorage {
    return {
        get(key) {
            try {
                return localStorage.getItem(storageKey ?? key);
            } catch {
                return null;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(storageKey ?? key, value);
            } catch {
                /* best-effort */
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(storageKey ?? key);
            } catch {
                /* best-effort */
            }
        },
    };
}
