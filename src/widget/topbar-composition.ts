// Topbar COMPOSITION — the host's declarative control of which topbar entries render,
// and in what order. The option DESCRIBES what is there (an allowlist per side), never
// what isn't: a side left undeclared keeps the shell's default composition, so the
// plug-and-play behavior survives untouched for hosts that never reach for this.
//
// Entries are IDS in one shared vocabulary: the built-in controls below, the `'actions'`
// flow slot (where unlisted contributed actions land, per their declared `align`), and
// any CONTRIBUTED action id (`registerWidgetAction`'s `id`) — naming one PINS that
// action at the list position, overriding its declared `align`/`order`. An explicit
// list is the side's complete contract: ids not listed do not render there, and hiding
// a built-in removes its other entry points too (mobile counterpart, keyboard chord —
// `mod+alt+S` for `'screenshot'`). Ctrl+Z / Ctrl+Y are NOT tied to `'undo-redo'`:
// hiding the buttons keeps the editing chords.
//
// The trade-off is deliberate and documented: an explicit list FREEZES that side — a
// built-in a future release adds will not appear for a host that curates. `hidden`-less
// hosts keep getting new chrome by default.

/** The host-facing option: visible entries per side, in render order. An undeclared
 *  side falls back to its default list. */
export interface TopbarComposition {
    left?: readonly string[];
    right?: readonly string[];
}

/** The built-in entry vocabulary (everything else in a list is a contributed-action id).
 *  `'layout'` renders only on multi-chart shells and `'indicators'` only while an
 *  indicator surface exists — the built-in picker (the deprecated `indicatorPicker:
 *  false` still removes it) or a slot OVERRIDE replacing it — so listing them is
 *  necessary but not sufficient. */
export const TOPBAR_BUILTIN_IDS = ['symbol', 'timeframes', 'style', 'layout', 'indicators', 'actions', 'undo-redo', 'alerts', 'panels', 'screenshot'] as const;

/** The default left side — the current shell composition, verbatim. */
export const TOPBAR_DEFAULT_LEFT: readonly string[] = ['symbol', 'timeframes', 'style', 'layout', 'indicators', 'actions', 'undo-redo'];

/** The default right side (the `margin-left: auto` cluster). */
export const TOPBAR_DEFAULT_RIGHT: readonly string[] = ['actions', 'alerts', 'panels', 'screenshot'];

/** A composition with both sides resolved (defaults applied, duplicates dropped). */
export interface ResolvedTopbarComposition {
    left: string[];
    right: string[];
}

/** Resolve the host option: absent side ⇒ its default list; a duplicated id keeps its
 *  FIRST occurrence (left before right) so an entry never renders twice. `'actions'`
 *  is the exception — it is a flow SLOT each side legitimately owns (the defaults
 *  carry one on both), so it dedupes per side only. */
export function resolveTopbarComposition(opt?: TopbarComposition): ResolvedTopbarComposition {
    const seen = new Set<string>();
    const take = (list: readonly string[]): string[] => {
        const out: string[] = [];
        const local = new Set<string>();
        for (const id of list) {
            if (!id || local.has(id) || (id !== 'actions' && seen.has(id))) continue;
            local.add(id);
            seen.add(id);
            out.push(id);
        }
        return out;
    };
    return { left: take(opt?.left ?? TOPBAR_DEFAULT_LEFT), right: take(opt?.right ?? TOPBAR_DEFAULT_RIGHT) };
}

/** Whether an entry id is visible anywhere in the resolved composition. */
export function topbarHas(comp: ResolvedTopbarComposition, id: string): boolean {
    return comp.left.includes(id) || comp.right.includes(id);
}

/** The non-built-in entries — contributed-action ids PINNED to a list position. */
export function pinnedTopbarActionIds(comp: ResolvedTopbarComposition): string[] {
    const builtin = new Set<string>(TOPBAR_BUILTIN_IDS);
    return [...comp.left, ...comp.right].filter((id) => !builtin.has(id));
}
