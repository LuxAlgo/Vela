// Workspace persistence — the storage seam and the workspace's default adapter. The
// state DOCUMENT itself (types + validating codec) lives in `src/state/document.ts`,
// shared verbatim with the widget: one format for both shells, the widget being the
// single-cell case. Re-exported here so `vela/workspace` keeps its public surface.
import type { WidgetStorage } from '../widget/persist';

export { encodeState, decodeState, sanitizeState } from '../state/document';
export type { WorkspaceState, CellState, ChartState } from '../state/document';

/**
 * The pluggable storage backend the workspace persists through — the SAME contract as
 * the widget's (`get`/`set`, each synchronous OR promise-returning, so localStorage-like
 * and REST/IndexedDB-like backends both fit). The default is {@link memoryStorageAdapter}
 * — session-lived only; plug your own for durability.
 */
export type WorkspaceStorage = WidgetStorage;

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
