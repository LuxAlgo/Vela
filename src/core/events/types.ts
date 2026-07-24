import type { EngineAlert, EngineWarning } from '../ports/ScriptingEngine';
import type { OHLCV } from '../model/ohlcv';

/** Chart-level events emitted on `chart.on(...)`. */
export interface VelaEventMap extends Record<string, unknown> {
    ready: undefined;
    'indicator:added': { id: string };
    'indicator:removed': { id: string };
    'indicator:error': { id: string; error: Error };
    /** An indicator was moved/merged to another pane (`chart.panes` / legend / object tree). */
    'indicator:moved': { id: string; paneId: string };
    /** An indicator was shown/hidden (legend eye, `handle.setVisible`, or object tree). */
    'indicator:visibility': { id: string; visible: boolean };
    /** A pane's layout changed: order, collapse/maximize, creation or removal. */
    'pane:changed': undefined;
    /** A study pane was reordered one slot (`dir`) — carries enough to invert for undo/redo. */
    'pane:moved': { paneId: string; dir: 'up' | 'down' };
    /** A user drawing was created (interactively or via `chart.drawings.add`). */
    'drawing:created': { id: string };
    /** A user drawing's anchors/style/text changed. */
    'drawing:edited': { id: string };
    /** Selection changed (`id` is null when nothing is selected). */
    'drawing:selected': { id: string | null };
    /** A user drawing was removed. */
    'drawing:removed': { id: string };
    /** The user requested a drawing's settings popup. */
    'drawing:settings': { id: string };
    /** An indicator's execution context advanced (run finished, or throttled during
     *  streaming) — re-pull `handle.context()` if you consume it. */
    'context:changed': { id: string };
    /** A live tick: the forming bar was updated or a new bar appended. */
    bar: OHLCV;
    /** A deep-history backfill chunk landed (`loaded` of `target` bars are on the chart). */
    'history:progress': { loaded: number; target: number };
    /**
     * The history load finished: `'depth'` = the requested bar count is loaded, `'genesis'` =
     * the source has nothing older (full available history), `'aborted'` = a fetch failed or
     * the data was non-monotonic — the chart keeps what loaded. Fires exactly once, including
     * for small/offline charts (immediately after their single load).
     */
    'history:complete': { reason: 'depth' | 'genesis' | 'aborted'; oldestTime: number; barsLoaded: number };
    alert: EngineAlert;
    warning: EngineWarning;
}
