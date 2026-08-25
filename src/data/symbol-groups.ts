// Symbol GROUPS (futures roots): the pure vocabulary shared by every consumer that
// folds or resolves grouped listings — the picker (fold members under the group row,
// expand on demand) and the registry (translate a picked/typed group to the member it
// loads). DOM-free on purpose, like `symbol-base`.
import type { SymbolDescriptor } from '../core/ports/DataProvider';

/** A GROUP's own row repeats the group in `ticker` — the port's documented invariant
 *  (`SymbolDescriptor.group`); members carry the same `group` with their own ticker. */
export function isGroupRow(d: Pick<SymbolDescriptor, 'ticker' | 'group'>): boolean {
    return d.group != null && d.ticker === d.group;
}

/** The venue-scoped identity of a row's group — two venues may both list an `ES` root. */
export function groupKeyOf(d: Pick<SymbolDescriptor, 'group' | 'prefix' | 'provider'>): string {
    return `${(d.prefix ?? d.provider ?? '').toLowerCase()}:${(d.group ?? '').toUpperCase()}`;
}

/** The group's MEMBER rows (its loadable symbols), in the pool's own order — providers
 *  emit members deliberately ordered, and the zero-or-many-defaults fallback leans on it. */
export function groupMembers(pool: readonly SymbolDescriptor[], groupRow: SymbolDescriptor): SymbolDescriptor[] {
    const key = groupKeyOf(groupRow);
    return pool.filter((s) => s.group != null && !isGroupRow(s) && groupKeyOf(s) === key);
}

/** The member a GROUP pick loads: the single `default`, else — none or several marked —
 *  the FIRST listed member (the agreed client-side rule). Null only for a memberless group. */
export function defaultMemberOf(pool: readonly SymbolDescriptor[], groupRow: SymbolDescriptor): SymbolDescriptor | null {
    const members = groupMembers(pool, groupRow);
    const defaults = members.filter((m) => m.default);
    return (defaults.length === 1 ? defaults[0]! : members[0]) ?? null;
}
