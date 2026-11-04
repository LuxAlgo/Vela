// Sidebar COMPOSITION — the host's declarative layout of the right-edge toolbar, the way the
// topbar composition lays out the topbar. Two lists of ids, top to bottom: the upper
// section (from the top edge down) and the lower section (anchored to the bottom edge).
//
// Entries are IDS in one shared vocabulary: a side panel's id (the shell's own `objects`
// and `dataWindow`, or a `registerSidePanel` id), a sidebar action's id
// (`registerWidgetAction({ target: 'sidebar' })`), the flow slots `'panels'` and
// `'actions'` (everything of that kind not placed explicitly, in order), and `'|'`, which
// starts a new group (a hairline between groups). Unknown ids are skipped, so a list can
// name a panel that registers later.

/** The host-facing option: entries per section, top to bottom. An undeclared section
 *  keeps its default. */
export interface SidebarComposition {
    top?: readonly string[];
    bottom?: readonly string[];
}

export const SIDEBAR_PANELS_SLOT = 'panels';
export const SIDEBAR_ACTIONS_SLOT = 'actions';
export const SIDEBAR_SEPARATOR = '|';

/** Default upper section: every side panel the host did not place, in dock order. */
export const SIDEBAR_DEFAULT_TOP: readonly string[] = [SIDEBAR_PANELS_SLOT];
/** Default lower section: the shell's inspection panels, then the sidebar actions. */
export const SIDEBAR_DEFAULT_BOTTOM: readonly string[] = ['objects', 'dataWindow', SIDEBAR_SEPARATOR, SIDEBAR_ACTIONS_SLOT];

export interface SidebarSource {
    id: string;
    kind: 'panel' | 'action';
    order: number;
}

export interface SidebarLayout<T extends SidebarSource> {
    /** Groups top to bottom; each group is a run of entries. */
    top: T[][];
    bottom: T[][];
}

/**
 * Lay `sources` out into the sidebar. An id placed explicitly is used once (its first
 * placement wins, so a slot never repeats it); a flow slot takes, in `order`, whatever of
 * its kind is left; empty groups collapse.
 */
export function composeSidebar<T extends SidebarSource>(sources: readonly T[], comp: SidebarComposition = {}): SidebarLayout<T> {
    const top = comp.top ?? SIDEBAR_DEFAULT_TOP;
    const bottom = comp.bottom ?? SIDEBAR_DEFAULT_BOTTOM;
    const byId = new Map(sources.map((s) => [s.id, s]));
    const placed = new Set([...top, ...bottom].filter((id) => byId.has(id)));
    const used = new Set<string>();
    const flow = (kind: SidebarSource['kind']): T[] =>
        sources.filter((s) => s.kind === kind && !placed.has(s.id) && !used.has(s.id)).sort((a, b) => a.order - b.order);
    const lay = (ids: readonly string[]): T[][] => {
        const groups: T[][] = [[]];
        for (const id of ids) {
            if (id === SIDEBAR_SEPARATOR) {
                groups.push([]);
                continue;
            }
            let run: T[];
            if (id === SIDEBAR_PANELS_SLOT) run = flow('panel');
            else if (id === SIDEBAR_ACTIONS_SLOT) run = flow('action');
            else {
                const s = byId.get(id);
                run = s && !used.has(id) ? [s] : [];
            }
            for (const s of run) used.add(s.id);
            groups[groups.length - 1]!.push(...run);
        }
        return groups.filter((g) => g.length > 0);
    };
    return { top: lay(top), bottom: lay(bottom) };
}
