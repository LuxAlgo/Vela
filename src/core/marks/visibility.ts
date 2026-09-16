// Group visibility for timeline marks — pure and renderer-agnostic, so both the core
// controller (`chart.marks.isGroupVisible`) and the renderers' display state read the
// same rule. Node-testable.
import type { MarkGroup } from './types';

/** The user's per-group choices, keyed by group id; an absent id follows the group's own declared default. */
export type MarkGroupChoices = Readonly<Record<string, boolean>>;

/** A group's OWN switch: the user's choice when one is stored, else the group's declared default, else visible. */
export function markGroupOwnVisible(choices: MarkGroupChoices, groupId: string, groups: readonly MarkGroup[]): boolean {
    const chosen = choices[groupId];
    if (typeof chosen === 'boolean') return chosen;
    return groups.find((g) => g.id === groupId)?.visible !== false;
}

/**
 * Whether a group's marks paint: its own switch AND every ancestor's (a child under a
 * switched-off parent is hidden whatever its own choice says). Ungrouped marks always
 * paint. A parent that was never defined is ignored; a cycle stops at the first repeat.
 */
export function markGroupVisible(choices: MarkGroupChoices, groupId: string | undefined, groups: readonly MarkGroup[]): boolean {
    if (groupId === undefined) return true;
    const seen = new Set<string>();
    let id: string | undefined = groupId;
    while (id !== undefined && !seen.has(id)) {
        seen.add(id);
        if (!markGroupOwnVisible(choices, id, groups)) return false;
        const parent: string | undefined = groups.find((g) => g.id === id)?.parent;
        id = parent !== undefined && groups.some((g) => g.id === parent) ? parent : undefined;
    }
    return true;
}

/** One Events-tab row: the group and how deep it nests (0 = top level). */
export interface MarkGroupRow {
    group: MarkGroup;
    depth: number;
}

/**
 * The Events tab's row order: each top-level group in the given order, followed by its
 * children (in the given order), recursively. A group naming an unknown parent — or one
 * in a cycle — lists at the top level so it can never disappear from the tab.
 */
export function markGroupRows(groups: readonly MarkGroup[]): MarkGroupRow[] {
    const ids = new Set(groups.map((g) => g.id));
    const out: MarkGroupRow[] = [];
    const placed = new Set<string>();
    const place = (group: MarkGroup, depth: number): void => {
        if (placed.has(group.id)) return;
        placed.add(group.id);
        out.push({ group, depth });
        for (const child of groups) if (child.parent === group.id && child.id !== group.id) place(child, depth + 1);
    };
    for (const g of groups) {
        const parentKnown = g.parent !== undefined && ids.has(g.parent) && g.parent !== g.id;
        if (!parentKnown) place(g, 0);
    }
    for (const g of groups) place(g, 0); // anything left (cycles) surfaces at the top level
    return out;
}
