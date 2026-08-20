// The SHELL options — the one option vocabulary both batteries-included shells share.
// `VelaWidgetOptions` (deprecated wrapper) = chart options (`VelaOptions`) + this;
// `VelaWorkspaceOptions` = the same minus `height`, plus the grid options — and at the
// workspace, every chart option given top-level becomes the DEFAULT of each cell.
// Every name below means the SAME thing in both shells; per-shell multiplicity
// (one chart vs N cells) is noted per field, never a semantic fork.
import type { DataProvider } from '../core/ports/DataProvider';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import type { IndicatorManifest, IndicatorLoader } from './indicators';
import type { VelaStorage } from './persist';
import type { TopbarComposition } from './topbar-composition';

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
    /** Declarative topbar composition: `{ left, right }` lists of the VISIBLE entries,
     *  in render order — built-in ids (`'symbol'`, `'timeframes'`, `'style'`,
     *  `'layout'`, `'indicators'`, `'actions'`, `'undo-redo'`, `'alerts'`, `'panels'`,
     *  `'screenshot'`) and/or contributed-action ids (naming one PINS it there,
     *  overriding its `align`/`order`; `'actions'` is where the unlisted ones flow).
     *  An undeclared side keeps its default. An explicit list is that side's complete
     *  contract — it also FREEZES it: chrome a future release adds will not appear.
     *  Hiding a built-in removes its mobile entry and keyboard chord too (`mod+alt+S`
     *  for `'screenshot'`); Ctrl+Z / Ctrl+Y stay — they belong to editing, not to the
     *  `'undo-redo'` buttons. */
    topbar?: TopbarComposition;
    /** The built-in indicator picker's entry points — the topbar button, the mobile-bar
     *  item, and the `/` shortcut. `false` removes them. The `indicators` manifest
     *  still resolves and auto-adds.
     *  @deprecated Removed in 0.7.0. To HIDE the built-in surface, omit `'indicators'`
     *  from `topbar.left` (same effect: no button, no mobile stop, no `/`, no dialog).
     *  To REPLACE it, a plugin registers its action under the id `'indicators'`
     *  (`registerWidgetAction`) — the override takes the slot's whole surface and
     *  needs no shell option at all. */
    indicatorPicker?: boolean;
    /** Chrome size class. `'auto'` (default) follows the CONTAINER width plus a
     *  coarse-pointer heuristic; `'mobile'` / `'desktop'` pin it. Mobile swaps the
     *  topbar + desktop bottombar for one touch-first bottom bar, presents pickers
     *  fullscreen and menus as bottom drawers, and enables the touch chart gestures. */
    layoutMode?: 'auto' | 'mobile' | 'desktop';
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
