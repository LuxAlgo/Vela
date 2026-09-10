// Display state of the `marks` renderer feature — the timeline-mark lane's master
// toggle plus per-group visibility. Pure (no DOM, no renderer types): the settings
// dialog, the config reducer and the lane painter all read it, and it is node-testable.
import type { MarkGroup } from '../../core/marks/types';

export interface MarksDisplayState {
    /** Master visibility of the lane. */
    visible: boolean;
    /** Per-group visibility keyed by group id. An absent id follows the group's own declared default. */
    groups: Record<string, boolean>;
}

export function defaultMarksState(): MarksDisplayState {
    return { visible: true, groups: {} };
}

/**
 * Validated merge of an untrusted partial onto a state: a bare boolean toggles the
 * lane; an object patches `visible` and/or `groups`. Groups merge ADDITIVELY — a patch
 * names only the ids it carries and the rest keep their values, so a persisted choice
 * for a group the host has not (yet) registered survives verbatim. Malformed values drop.
 */
export function mergeMarksState(base: MarksDisplayState, patch: unknown): MarksDisplayState {
    if (typeof patch === 'boolean') return { visible: patch, groups: { ...base.groups } };
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const g = (p.groups && typeof p.groups === 'object' ? p.groups : {}) as Record<string, unknown>;
    const groups: Record<string, boolean> = { ...base.groups };
    for (const [id, v] of Object.entries(g)) if (typeof v === 'boolean') groups[id] = v;
    return { visible: typeof p.visible === 'boolean' ? p.visible : base.visible, groups };
}

/** Whether a group's marks paint: the user's choice when one is stored, else the group's declared default, else visible. Ungrouped marks always paint. */
export function markGroupVisible(state: MarksDisplayState, groupId: string | undefined, groups: readonly MarkGroup[]): boolean {
    if (groupId === undefined) return true;
    const chosen = state.groups[groupId];
    if (typeof chosen === 'boolean') return chosen;
    return groups.find((g) => g.id === groupId)?.visible !== false;
}
