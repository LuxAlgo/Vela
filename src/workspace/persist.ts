// Workspace persistence — the storage seam and the workspace's default adapter. The
// state DOCUMENT itself (types + validating codec) lives in `src/state/document.ts`,
// shared verbatim with the widget: one format for both shells, the widget being the
// single-cell case. Re-exported here so `vela/workspace` keeps its public surface.
import type { VelaStorage } from '../widget/persist';

export { encodeState, decodeState, sanitizeState } from '../state/document';
export type { WorkspaceState, CellState, ChartState, PanelsState } from '../state/document';

/** @deprecated Use {@link VelaStorage} — one storage contract for both shells
 *  (`get`/`set`, each synchronous OR promise-returning, so localStorage-like and
 *  REST/IndexedDB-like backends both fit). */
export type WorkspaceStorage = VelaStorage;

/** The page-session store behind the memory adapter: module-level, so a destroyed and
 *  re-created workspace (SPA navigation) restores — a reload starts fresh by design. */
const memoryStore = new Map<string, string>();

/** An in-memory, session-lived {@link VelaStorage} — the OPT-IN alternative to the
 *  localStorage default when persisted state must not outlive the page session. */
export function memoryStorageAdapter(): VelaStorage {
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
