// Grouped listings (futures roots) — the pure vocabulary: what a GROUP row is, which
// member a group pick loads (single `default`, else FIRST listed), and how the picker
// folds members under their group row without ever reshuffling on infinite scroll.
import { describe, it, expect } from 'vitest';
import type { SymbolDescriptor } from '../src/core/ports/DataProvider';
import { isGroupRow, groupMembers, defaultMemberOf } from '../src/data/symbol-groups';
import { foldGroups } from '../src/widget/symbol-picker';

const CME: SymbolDescriptor[] = [
    { ticker: 'ES', type: 'root', group: 'ES', prefix: 'CME', description: 'E-mini S&P 500' },
    { ticker: 'ES1!', type: 'futures', group: 'ES', prefix: 'CME', default: true },
    { ticker: 'ES2!', type: 'futures', group: 'ES', prefix: 'CME' },
    { ticker: 'NQ', type: 'root', group: 'NQ', prefix: 'CME', description: 'E-mini Nasdaq-100' },
    { ticker: 'NQ1!', type: 'futures', group: 'NQ', prefix: 'CME' }, // deliberately NO default
    { ticker: 'NQ2!', type: 'futures', group: 'NQ', prefix: 'CME' },
];

describe('group vocabulary', () => {
    it('a GROUP row repeats its group in ticker; members and ungrouped rows are not', () => {
        expect(isGroupRow(CME[0]!)).toBe(true);
        expect(isGroupRow(CME[1]!)).toBe(false);
        expect(isGroupRow({ ticker: 'AAPL' })).toBe(false);
    });

    it('members come back in POOL order, scoped to the group', () => {
        expect(groupMembers(CME, CME[0]!).map((m) => m.ticker)).toEqual(['ES1!', 'ES2!']);
    });

    it('the single `default` member is what a group pick loads', () => {
        expect(defaultMemberOf(CME, CME[0]!)?.ticker).toBe('ES1!');
    });

    it('zero defaults → the FIRST listed member (providers order deliberately)', () => {
        expect(defaultMemberOf(CME, CME[3]!)?.ticker).toBe('NQ1!');
    });

    it('MANY defaults → still the first LISTED member, not the first default', () => {
        const pool: SymbolDescriptor[] = [
            { ticker: 'GC', type: 'root', group: 'GC', prefix: 'COMEX' },
            { ticker: 'GC2!', type: 'futures', group: 'GC', prefix: 'COMEX', default: true },
            { ticker: 'GC1!', type: 'futures', group: 'GC', prefix: 'COMEX', default: true },
        ];
        expect(defaultMemberOf(pool, pool[0]!)?.ticker).toBe('GC2!');
    });

    it('the group identity is VENUE-scoped — a same-named root elsewhere never leaks in', () => {
        const pool: SymbolDescriptor[] = [
            ...CME,
            { ticker: 'ES9!', type: 'futures', group: 'ES', prefix: 'OTHER', default: true },
        ];
        expect(groupMembers(pool, CME[0]!).map((m) => m.ticker)).toEqual(['ES1!', 'ES2!']);
    });

    it('a memberless group resolves to nothing (callers keep the root and fail plainly)', () => {
        const lone: SymbolDescriptor = { ticker: 'XX', group: 'XX', prefix: 'CME' };
        expect(defaultMemberOf([lone], lone)).toBeNull();
    });
});

describe('foldGroups', () => {
    it('drops members standing BELOW their group row — the group stands for them', () => {
        expect(foldGroups(CME).map((s) => s.ticker)).toEqual(['ES', 'NQ']);
    });

    it('keeps a member that matched WITHOUT its group row — it matched more specifically', () => {
        expect(foldGroups([CME[2]!, CME[4]!]).map((s) => s.ticker)).toEqual(['ES2!', 'NQ1!']);
    });

    it('is order-respecting: a member ABOVE its group row keeps its own row', () => {
        // A ranking hook may hoist a member; folding must never depend on rows below —
        // that is what keeps infinite-scroll growth append-only.
        expect(foldGroups([CME[1]!, CME[0]!, CME[2]!]).map((s) => s.ticker)).toEqual(['ES1!', 'ES']);
    });

    it('folds per VENUE — a same-named root on another venue keeps its members', () => {
        const other: SymbolDescriptor = { ticker: 'ES1!', type: 'futures', group: 'ES', prefix: 'OTHER' };
        expect(foldGroups([CME[0]!, other]).map((s) => `${s.prefix}:${s.ticker}`)).toEqual(['CME:ES', 'OTHER:ES1!']);
    });

    it('leaves ungrouped rows alone', () => {
        const plain: SymbolDescriptor[] = [{ ticker: 'BTCUSDT', type: 'crypto' }, { ticker: 'AAPL', type: 'stock', prefix: 'NASDAQ' }];
        expect(foldGroups(plain)).toEqual(plain);
    });
});
