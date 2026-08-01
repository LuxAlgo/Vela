// The SHELL options — the one option vocabulary both batteries-included shells share.
// `VelaWidgetOptions` = chart options (`VelaOptions`) + this + `urlState`;
// `VelaWorkspaceOptions` = the same minus `height`, plus the grid options — and at the
// workspace, every chart option given top-level becomes the DEFAULT of each cell.
// Every name below means the SAME thing in both shells; per-shell multiplicity
// (one chart vs N cells) is noted per field, never a semantic fork.
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { IndicatorManifest, IndicatorLoader } from './indicators';
import type { VelaStorage } from './persist';

/** What a shell (widget or workspace) accepts BEYOND the chart options themselves. */
export interface VelaShellOptions {
    /** Provider factories, keyed by provider name. The shell owns the call cycle: the
     *  widget re-instantiates on each chart rebuild; the workspace instantiates once
     *  onto its single shared feed. */
    providers?: Record<string, () => DataProvider>;
    /** Scripting-engine factories, keyed by language — ONE instance per chart (the
     *  widget's chart, each workspace cell), so a worker engine gets its own thread and
     *  dies with its chart. Return a shared instance from the factory to opt into one
     *  engine for everything. Merged OVER the app-level `registerDefaultEngine`
     *  registry — an instance factory wins for its language. */
    engines?: Record<string, () => ScriptingEngine>;
    /** Indicator manifest: inline, a URL returning it, or an ASYNC LOADER function
     *  (`() => Promise<manifest>` — filesystem reads, authenticated APIs, dynamic
     *  imports). Resolved ONCE; entries with `enabled: true` auto-add to every FRESH
     *  chart (restored cells re-add their own recorded set instead). */
    indicators?: string | IndicatorManifest | IndicatorLoader;
    /** Topbar timeframe presets (chart timeframe values). */
    timeframes?: string[];
    /** Display timezone (IANA; default 'Etc/UTC') — one zone for the whole shell. */
    timezone?: string;
    /** Chrome toggles (all default true). */
    statusline?: boolean;
    watermark?: boolean;
    bottombar?: boolean;
    /** Focus the chart when the shell mounts so keyboard shortcuts work from the first
     *  keystroke — no initial click needed. Default false: an embedded shell must never
     *  steal the page's focus from the host's own controls. */
    autofocus?: boolean;
    /** Bring the shell back AS YOU LEFT IT: persist the full state document
     *  (`getState()`) and restore it at construction. `true` uses the shell's default
     *  key ('vela-widget' / 'vela-workspace'); a string is the storage key. */
    persist?: boolean | string;
    /** Storage backend for `persist` — defaults to localStorage in BOTH shells. Inject
     *  any {@link VelaStorage} (sync or async) for custom backends (REST, IndexedDB, …)
     *  or the exported in-memory adapter for session-lived state. */
    storage?: VelaStorage;
}
