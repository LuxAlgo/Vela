import type { EngineAlert, EngineWarning } from '../ports/ScriptingEngine';
import type { ScriptRun } from '../script-run';
import type { OHLCV } from '../model/ohlcv';
import type { DrawingTypeKey } from '../drawings/Drawing';
import type { SnapMode } from '../drawings/geometry';
import type { DrawingMode } from '../drawings/port';

/** Chart-level events emitted on `chart.on(...)`. */
export interface VelaEventMap extends Record<string, unknown> {
    ready: undefined;
    /**
     * The chart's market switched IN PLACE via `setMarket` — symbol, provider, timeframe,
     * or offline data changed (a depth-only reload does not fire). Fires after the new
     * market's history is painted and every consumer restarted. `prev` carries the
     * previous identity so hosts can re-key per-symbol state (e.g. swap user-drawing
     * documents between symbols).
     */
    'market:changed': { symbol: string; timeframe: string; prev: { symbol: string; timeframe: string } };
    /**
     * A bar load began with nothing painted: the FIRST load (fires during construction —
     * subscribers attached later see only its `load:end`), or an identity switch
     * (symbol/provider/timeframe), which blanks the old series in the same breath. Fires
     * before the first fetch — plugins, extensions and custom indicators hide or reset
     * their own visuals here. Exactly one `load:end` follows. A depth-only reload
     * (`bars`) keeps the chart painted and fires neither.
     */
    'load:start': { symbol: string; timeframe: string; firstLoad: boolean };
    /**
     * The load ended: its first bars painted (`bars` > 0 — on deep histories the quick
     * preview, before the full depth), or it ended with none (`bars` = 0 — a failed
     * fetch, an empty market, or a parked symbol nothing serves). Counterpart of
     * `load:start`; plugins restore or rebuild their visuals here.
     */
    'load:end': { symbol: string; timeframe: string; bars: number };
    'indicator:added': { id: string };
    'indicator:removed': { id: string };
    'indicator:error': { id: string; error: Error };
    /** No registered provider can serve the chart symbol — the load is PARKED, not failed:
     *  it resumes by itself if a capable provider registers later. */
    'data:unresolved': { symbol: string; providers: string[] };
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
    /** The favorite-tool set changed (star toggles or a bulk restore). */
    'drawing:favorites': { favorites: string[] };
    /** The armed drawing tool changed — toolbar click, one-shot tool finishing (back to
     *  the pointer, `null`), or a programmatic `drawings.setTool`. */
    'drawing:tool': { type: DrawingTypeKey | null };
    /** The magnet snap mode changed (in-chart toolbar or `drawings.setSnapMode`). */
    'drawing:snap': { mode: SnapMode };
    /** Stay-in-drawing-mode changed (in-chart toolbar or `drawings.setStayMode`) — when
     *  on, finishing a drawing leaves the tool armed. */
    'drawing:stay': { on: boolean };
    /** The renderer-local mode changed: measure ruler, eraser, or none — including the
     *  mutual-exclusion exits (arming a tool leaves measure/eraser). */
    'drawing:mode': { mode: DrawingMode };
    /** A user drawing was removed. */
    'drawing:removed': { id: string };
    /** The user requested a drawing's settings popup. */
    'drawing:settings': { id: string };
    /**
     * A SCRIPT computed — the first run over the history, a live tick, a new bar, an input
     * edit, a viewport move, a market switch. The payload carries the run itself (title,
     * cause, the plots/variables/broker state at the computed bar), so a listener reads it
     * directly instead of resolving a handle and pulling a snapshot. Throttled to ~1/s per
     * indicator while streaming, and only emitted for engines that expose an execution
     * context. Native (core-computed) indicators never fire it — they run no script.
     */
    'script:run': ScriptRun;
    /** An indicator's execution context advanced (run finished, or throttled during
     *  streaming) — re-pull `handle.context()` if you consume it. Prefer `script:run`,
     *  which delivers the data rather than a signal to go fetch it. */
    'context:changed': { id: string };
    /** A live tick: the forming bar was updated or a new bar appended. */
    bar: OHLCV;
    /**
     * The visible time range moved (pan/zoom/fit — fires per applied change, NOT
     * debounced; the engine re-run debounce is separate). Payload = `{from, to}` in
     * epoch-ms. The seam viewport-sync links between charts build on.
     */
    'viewport:changed': { from: number; to: number };
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
