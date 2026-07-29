// The object tree's layout rules (src/widget/object-tree-model.ts) — pane grouping, the
// unified front-first stack (drawings + indicators + candles in one z-ordered column), pane
// naming, per-pane drawing ownership and group folding. Pure functions over plain objects,
// so this runs in the node env.
import { describe, it, expect } from 'vitest';
import {
    assignToGroup,
    buildTree,
    canGroup,
    drawingLabel,
    drawingMeta,
    drawingUnits,
    groupOf,
    groupState,
    groupTokenIndex,
    nextGroupName,
    paneDrawings,
    paneLabel,
    paneRows,
    paneTokens,
    placeTokens,
    pruneGroups,
    removeFromGroups,
    sameToken,
    stackWrites,
    tokenIndexOfSlot,
    tokensEqual,
    treeIsEmpty,
    zStackBounds,
    PRICE_PANE_LABEL,
    type DrawGroup,
    type StackToken,
    type TreePane,
    type TreeSnapshot,
} from '../src/widget/object-tree-model';
import type { PaneInfo } from '../src/core/options';
import type { SerializedDrawing } from '../src/core/drawings/Drawing';

function pane(id: string, kind: 'price' | 'study', order: number, indicators: Array<{ id: string; title?: string; ownScale?: boolean }> = []): PaneInfo {
    return {
        id,
        kind,
        order,
        collapsed: false,
        maximized: false,
        indicators: indicators.map((i) => ({ id: i.id, title: i.title ?? i.id, ownScale: i.ownScale === true })),
    };
}

function draw(id: string, paneId: string, zIndex: number, extra: Partial<SerializedDrawing> = {}): SerializedDrawing {
    return {
        id,
        type: 'trendline',
        paneId,
        anchors: [],
        style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' },
        locked: false,
        visible: true,
        zIndex,
        createdAt: 0,
        ...extra,
    } as SerializedDrawing;
}

function snap(over: Partial<TreeSnapshot> = {}): TreeSnapshot {
    return {
        panes: [pane('price', 'price', 0)],
        indicatorVisible: () => true,
        handleTitle: () => undefined,
        stackable: true,
        interleave: true,
        zOrder: [],
        candleZ: 0,
        priceLabel: 'BTCUSDT',
        priceVisible: true,
        drawings: [],
        groups: [],
        ...over,
    };
}

/** A pane's stack flattened to readable names: drawings by id, indicators by id, the candles
 *  as 'price' — one name per z key, front-most first. */
function names(p: TreePane): string[] {
    return paneTokens(p).map((t) => (t.kind === 'price' ? 'price' : t.id));
}

const price: StackToken = { kind: 'price' };
const ind = (id: string): StackToken => ({ kind: 'indicator', id });
const dw = (id: string): StackToken => ({ kind: 'drawing', id });
const tokenNames = (tokens: readonly StackToken[]): string[] => tokens.map((t) => (t.kind === 'price' ? 'price' : t.id));

describe('buildTree — the unified stack', () => {
    it('orders the candles among the overlays by z, front-most first', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }, { id: 'b' }]);
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: -1 }, { id: 'b', z: 5 }], candleZ: 0 }));
        // b (z 5) is in front of the candles (z 0), which are in front of a (z -1).
        expect(names(tree[0]!)).toEqual(['b', 'price', 'a']);
    });

    it('interleaves drawings into the column by their z — under the candles, between overlays', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }, { id: 'b' }]);
        const drawings = [draw('deep', 'price', -9), draw('mid', 'price', -1), draw('top', 'price', 7)];
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: -2 }, { id: 'b', z: 3 }], candleZ: 0, drawings }));
        expect(names(tree[0]!)).toEqual(['top', 'b', 'price', 'mid', 'a', 'deep']);
    });

    it('a drawing tying a series z paints under it — the series row leads', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }]);
        const drawings = [draw('tied', 'price', 0)];
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: 4 }], candleZ: 0, drawings }));
        expect(names(tree[0]!)).toEqual(['a', 'price', 'tied']);
    });

    it('without a shared draw-order space the drawings lead — they always paint over', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }]);
        const drawings = [draw('low', 'price', -9)]; // would sit at the back if interleaved
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: 1 }], drawings, interleave: false }));
        expect(names(tree[0]!)).toEqual(['low', 'a', 'price']);
    });

    it('without editable stacking the candles lead and overlays follow in pane order', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }, { id: 'b' }]);
        const tree = buildTree(snap({ panes: [p], stackable: false, interleave: false }));
        expect(names(tree[0]!)).toEqual(['price', 'a', 'b']);
    });

    it('study panes stack too: drawings interleave with the pane\'s indicators', () => {
        const panes = [pane('price', 'price', 0), pane('p1', 'study', 1, [{ id: 'rsi', title: 'RSI 14' }])];
        const drawings = [draw('over', 'p1', 5), draw('under', 'p1', -5)];
        const tree = buildTree(snap({ panes, zOrder: [{ id: 'rsi', z: 0 }], drawings }));
        expect(tree[1]!.label).toBe('RSI 14');
        expect(names(tree[1]!)).toEqual(['over', 'rsi', 'under']);
    });

    it('carries visibility and the own-scale flag onto indicator rows, titled from the pane model', () => {
        const p = pane('price', 'price', 0, [{ id: 'a', title: 'SMA 20', ownScale: true }]);
        const tree = buildTree(snap({ panes: [p], indicatorVisible: (id) => id !== 'a', handleTitle: () => 'Indicator' }));
        const a = paneRows(tree[0]!).find((r) => r.kind === 'indicator');
        expect(a).toMatchObject({ label: 'SMA 20', visible: false, ownScale: true });
    });

    it('falls back to the handle title, then the id, when the pane model has no title', () => {
        const p = pane('price', 'price', 0, [{ id: 'a', title: '' }, { id: 'b', title: '' }]);
        const tree = buildTree(snap({ panes: [p], handleTitle: (id) => (id === 'a' ? 'My RSI' : undefined) }));
        const labels = paneRows(tree[0]!).flatMap((r) => (r.kind === 'indicator' ? [r.label] : []));
        expect(labels).toEqual(expect.arrayContaining(['My RSI', 'b']));
    });

    it('a group surfaces at its front-most member\'s slot, members contiguous under it', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }]);
        const drawings = [draw('m1', 'price', -5), draw('m2', 'price', 5), draw('loose', 'price', 9)];
        const groups: DrawGroup[] = [{ id: 'g1', name: 'G', ids: ['m1', 'm2'] }];
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: 0 }], drawings, groups }));
        // The bundle sits where m2 (front-most member, z 5) sits, carrying m1 with it.
        expect(names(tree[0]!)).toEqual(['loose', 'm2', 'm1', 'a', 'price']);
        expect(tree[0]!.items[1]).toMatchObject({ kind: 'unit', unit: { kind: 'group' } });
    });

    it('is empty only when nothing but the candles is on the chart', () => {
        expect(treeIsEmpty(buildTree(snap()))).toBe(true);
        expect(treeIsEmpty(buildTree(snap({ panes: [pane('price', 'price', 0, [{ id: 'sma' }])] })))).toBe(false);
        expect(treeIsEmpty(buildTree(snap({ drawings: [draw('d1', 'price', 1)] })))).toBe(false);
    });
});

describe('tokens', () => {
    it('flattens a pane to one token per z key, a group contributing one per member', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }]);
        const drawings = [draw('m1', 'price', 4), draw('m2', 'price', 5)];
        const groups: DrawGroup[] = [{ id: 'g1', name: 'G', ids: ['m1', 'm2'] }];
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: 1 }], drawings, groups }));
        expect(tokenNames(paneTokens(tree[0]!))).toEqual(['m2', 'm1', 'a', 'price']);
        // Rendered items: [group, a, price] — slot 1 (after the group) is token index 2.
        expect(tokenIndexOfSlot(tree[0]!, 0)).toBe(0);
        expect(tokenIndexOfSlot(tree[0]!, 1)).toBe(2);
        expect(tokenIndexOfSlot(tree[0]!, 3)).toBe(4);
    });

    it('sameToken matches by kind and id', () => {
        expect(sameToken(price, { kind: 'price' })).toBe(true);
        expect(sameToken(ind('a'), ind('a'))).toBe(true);
        expect(sameToken(ind('a'), dw('a'))).toBe(false);
        expect(sameToken(ind('a'), price)).toBe(false);
    });

    it('a drop inside a group lands at the member it points at, clamped past the last', () => {
        const p = pane('price', 'price', 0, [{ id: 'a' }]);
        const drawings = [draw('m1', 'price', 4), draw('m2', 'price', 5)];
        const groups: DrawGroup[] = [{ id: 'g1', name: 'G', ids: ['m1', 'm2'] }];
        const tree = buildTree(snap({ panes: [p], zOrder: [{ id: 'a', z: 1 }], drawings, groups }));
        // Tokens: m2, m1, a, price — the group's run starts at 0.
        expect(groupTokenIndex(tree[0]!, 'g1', 0)).toBe(0);
        expect(groupTokenIndex(tree[0]!, 'g1', 1)).toBe(1);
        expect(groupTokenIndex(tree[0]!, 'g1', 9)).toBe(2); // past the last member → after the run
        expect(groupTokenIndex(tree[0]!, 'gone', 0)).toBe(4); // unknown group → end of the stack
    });
});

describe('placeTokens', () => {
    // Front-first: d1, a, price, d2.
    const stack: StackToken[] = [dw('d1'), ind('a'), price, dw('d2')];

    it('moves a token up to the index the pointer picked', () => {
        expect(tokenNames(placeTokens(stack, [dw('d2')], 0))).toEqual(['d2', 'd1', 'a', 'price']);
        expect(tokenNames(placeTokens(stack, [dw('d2')], 2))).toEqual(['d1', 'a', 'd2', 'price']);
    });

    it('moves a token down, accounting for the gap it leaves behind', () => {
        // Index 4 is "after d2" as rendered; with d1 lifted out, that is the end of the list.
        expect(tokenNames(placeTokens(stack, [dw('d1')], 4))).toEqual(['a', 'price', 'd2', 'd1']);
        expect(tokenNames(placeTokens(stack, [dw('d1')], 3))).toEqual(['a', 'price', 'd1', 'd2']);
    });

    it('dropping a token back onto its own edges is a no-op', () => {
        expect(tokenNames(placeTokens(stack, [price], 2))).toEqual(['d1', 'a', 'price', 'd2']);
        expect(tokenNames(placeTokens(stack, [price], 3))).toEqual(['d1', 'a', 'price', 'd2']);
    });

    it('a group\'s run moves as one contiguous block', () => {
        const s: StackToken[] = [dw('m1'), dw('m2'), ind('a'), price];
        expect(tokenNames(placeTokens(s, [dw('m1'), dw('m2')], 4))).toEqual(['a', 'price', 'm1', 'm2']);
        expect(tokenNames(placeTokens(s, [dw('m1'), dw('m2')], 3))).toEqual(['a', 'm1', 'm2', 'price']);
    });

    it('inserts tokens that were not in the stack — a drawing arriving from another pane', () => {
        expect(tokenNames(placeTokens(stack, [dw('new')], 3))).toEqual(['d1', 'a', 'price', 'new', 'd2']);
    });

    it('clamps an index beyond either end', () => {
        expect(tokenNames(placeTokens(stack, [dw('d2')], 99))).toEqual(['d1', 'a', 'price', 'd2']);
        expect(tokenNames(placeTokens(stack, [dw('d1')], -5))).toEqual(['d1', 'a', 'price', 'd2']);
    });

    it('tokensEqual spots the unchanged stack a no-op guard needs', () => {
        expect(tokensEqual(stack, placeTokens(stack, [price], 3))).toBe(true);
        expect(tokensEqual(stack, placeTokens(stack, [price], 0))).toBe(false);
    });
});

describe('stackWrites', () => {
    it('turns a front-first stack into descending z keys, routed per kind', () => {
        const placed: StackToken[] = [dw('top'), ind('a'), price, dw('deep')];
        expect(stackWrites(placed)).toEqual({
            candleZ: 2,
            series: [{ id: 'a', z: 3 }],
            drawings: [
                { id: 'top', z: 4 },
                { id: 'deep', z: 1 },
            ],
        });
    });

    it('a study pane has no candles to write', () => {
        expect(stackWrites([dw('d'), ind('rsi')])).toEqual({ candleZ: null, series: [{ id: 'rsi', z: 1 }], drawings: [{ id: 'd', z: 2 }] });
    });
});

describe('zStackBounds', () => {
    it('spans the overlays and the candles, always including zero', () => {
        expect(zStackBounds([{ id: 'a', z: 3 }, { id: 'b', z: -2 }], 1)).toEqual({ top: 3, bottom: -2 });
        expect(zStackBounds([], 0)).toEqual({ top: 0, bottom: 0 });
        // The candles alone can define an extreme.
        expect(zStackBounds([{ id: 'a', z: 1 }], 9)).toEqual({ top: 9, bottom: 0 });
        expect(zStackBounds([{ id: 'a', z: 1 }], -9)).toEqual({ top: 1, bottom: -9 });
    });

    it('folds in drawing z keys when they share the space', () => {
        expect(zStackBounds([{ id: 'a', z: 3 }], 0, [7, -4])).toEqual({ top: 7, bottom: -4 });
    });
});

describe('paneLabel', () => {
    it('names the price pane the main chart', () => {
        expect(paneLabel(pane('price', 'price', 0), () => undefined)).toBe(PRICE_PANE_LABEL);
    });

    it('a study pane borrows the title of the indicator owning its scale', () => {
        const p = pane('p1', 'study', 1, [{ id: 'own', title: 'Volume', ownScale: true }, { id: 'master', title: 'RSI 14' }]);
        expect(paneLabel(p, () => undefined)).toBe('RSI 14');
    });

    it('falls back to the handle title, then to the slot number when the pane is empty', () => {
        expect(paneLabel(pane('p1', 'study', 1, [{ id: 'x', title: '' }]), () => 'MACD')).toBe('MACD');
        expect(paneLabel(pane('p2', 'study', 2), () => undefined)).toBe('Pane 3');
    });
});

describe('paneDrawings', () => {
    const ids = new Set(['price', 'p1']);

    it('lists a pane\'s own drawings front-most first', () => {
        const all = [draw('d1', 'p1', 1), draw('d2', 'p1', 2), draw('d3', 'price', 3)];
        expect(paneDrawings(all, 'p1', ids).map((d) => d.id)).toEqual(['d2', 'd1']);
    });

    it('folds orphans — drawings on a pane that no longer exists — into the price pane', () => {
        const all = [draw('d1', 'price', 1), draw('orphan', 'gone', 2)];
        expect(paneDrawings(all, 'price', ids).map((d) => d.id)).toEqual(['orphan', 'd1']);
        expect(paneDrawings(all, 'p1', ids)).toEqual([]);
    });
});

describe('drawingUnits', () => {
    it('a lone drawing is its own unit', () => {
        const units = drawingUnits([draw('d1', 'price', 1)], []);
        expect(units).toEqual([{ kind: 'draw', drawing: expect.objectContaining({ id: 'd1' }) }]);
    });

    it('a group surfaces once, at its front-most member\'s slot, holding every member', () => {
        const front = [draw('d3', 'price', 3), draw('d2', 'price', 2), draw('d1', 'price', 1)];
        const groups: DrawGroup[] = [{ id: 'g1', name: 'Group 1', ids: ['d1', 'd3'] }];
        const units = drawingUnits(front, groups);
        expect(units).toHaveLength(2);
        expect(units[0]).toMatchObject({ kind: 'group' });
        expect(units[0]!.kind === 'group' && units[0]!.members.map((m) => m.id)).toEqual(['d3', 'd1']);
        expect(units[1]).toMatchObject({ kind: 'draw', drawing: expect.objectContaining({ id: 'd2' }) });
    });

    it('groupOf finds a drawing\'s bundle, or nothing', () => {
        const groups: DrawGroup[] = [{ id: 'g1', name: 'G', ids: ['d1'] }];
        expect(groupOf(groups, 'd1')?.id).toBe('g1');
        expect(groupOf(groups, 'd2')).toBeNull();
    });
});

describe('group state and membership', () => {
    const g = (id: string, name: string, ids: string[]): DrawGroup => ({ id, name, ids });

    it('a group reads as hidden or locked only when every member is', () => {
        const shown = draw('d1', 'price', 1);
        const hidden = draw('d2', 'price', 2, { visible: false });
        const locked = draw('d3', 'price', 3, { locked: true });
        expect(groupState([hidden, hidden])).toEqual({ allHidden: true, allLocked: false });
        expect(groupState([hidden, shown])).toEqual({ allHidden: false, allLocked: false });
        expect(groupState([locked, locked])).toEqual({ allHidden: false, allLocked: true });
        expect(groupState([locked, shown])).toEqual({ allHidden: false, allLocked: false });
        // An empty bundle is neither — there is nothing to report on.
        expect(groupState([])).toEqual({ allHidden: false, allLocked: false });
    });

    it('only an ungrouped, non-empty selection can form a new group', () => {
        const groups = [g('g1', 'Group 1', ['d1'])];
        expect(canGroup([], groups)).toBe(false);
        expect(canGroup(['d2', 'd3'], groups)).toBe(true);
        expect(canGroup(['d1', 'd2'], groups)).toBe(false);
    });

    it('names a new group after the lowest number still free', () => {
        expect(nextGroupName([])).toBe('Group 1');
        expect(nextGroupName([g('a', 'Group 1', ['d1'])])).toBe('Group 2');
        // A hole left by a deleted group gets reused rather than skipped.
        expect(nextGroupName([g('a', 'Group 2', ['d1']), g('b', 'Group 3', ['d2'])])).toBe('Group 1');
        // Renamed groups don't block the numbering.
        expect(nextGroupName([g('a', 'Fibs', ['d1'])])).toBe('Group 1');
    });

    it('pruning drops dead members, and the groups left empty by them', () => {
        const groups = [g('g1', 'Group 1', ['d1', 'gone']), g('g2', 'Group 2', ['dead'])];
        const live = new Set(['d1']);
        expect(pruneGroups(groups, live)).toEqual([{ id: 'g1', name: 'Group 1', ids: ['d1'] }]);
    });

    it('removing a drawing from its group leaves the others alone, and empties disappear', () => {
        const groups = [g('g1', 'Group 1', ['d1', 'd2']), g('g2', 'Group 2', ['d3'])];
        expect(removeFromGroups(groups, ['d1'])).toEqual([
            { id: 'g1', name: 'Group 1', ids: ['d2'] },
            { id: 'g2', name: 'Group 2', ids: ['d3'] },
        ]);
        expect(removeFromGroups(groups, ['d3'])).toEqual([{ id: 'g1', name: 'Group 1', ids: ['d1', 'd2'] }]);
    });

    it('joining a group is exclusive — the drawing leaves the one it was in', () => {
        const groups = [g('g1', 'Group 1', ['d1', 'd2']), g('g2', 'Group 2', ['d3'])];
        expect(assignToGroup(groups, 'g2', ['d1'])).toEqual([
            { id: 'g1', name: 'Group 1', ids: ['d2'] },
            { id: 'g2', name: 'Group 2', ids: ['d3', 'd1'] },
        ]);
        // Moving the last member out dissolves the group it left.
        expect(assignToGroup([g('g1', 'Group 1', ['d1']), g('g2', 'Group 2', ['d2'])], 'g2', ['d1'])).toEqual([
            { id: 'g2', name: 'Group 2', ids: ['d2', 'd1'] },
        ]);
        // Re-adding a member it already has is not a duplicate.
        expect(assignToGroup(groups, 'g1', ['d1'])).toEqual([
            { id: 'g1', name: 'Group 1', ids: ['d2', 'd1'] },
            { id: 'g2', name: 'Group 2', ids: ['d3'] },
        ]);
    });
});

describe('drawing names', () => {
    it('uses the type registry label, appending the drawing\'s own text', () => {
        expect(drawingMeta('trendline').label).toBe('Trend Line');
        expect(drawingLabel(draw('d1', 'price', 1))).toBe('Trend Line');
        expect(drawingLabel(draw('d2', 'price', 1, { text: { value: 'target', size: 'normal', hAlign: 'center', vAlign: 'center' } } as Partial<SerializedDrawing>))).toBe('Trend Line — target');
    });

    it('an unregistered type still reads as a name, title-cased', () => {
        expect(drawingMeta('mystery').label).toBe('Mystery');
        expect(drawingMeta('mystery').icon).toBeNull();
    });
});
