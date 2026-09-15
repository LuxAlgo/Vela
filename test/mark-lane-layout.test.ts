// The timeline-mark lane's geometry (src/renderers/native/chrome/marks/layout): bar
// snapping, clustering, stacking, fan-out, hit-testing — pure, node env.
import { describe, it, expect } from 'vitest';
import {
    snapMarkBar,
    clusterMarks,
    layoutMarkLane,
    markGlyphAt,
    markStackAt,
    clusterTooltip,
    markGroupLabel,
    effectiveMarkGroups,
    foldOverlappingClusters,
    MARK_GLYPH_PX,
    MARK_CLUSTER_PX,
    MARK_LANE_INSET,
    MARK_DECK_STEP,
    MARK_FAN_GAP,
    MARK_FAN_HOLD,
} from '../src/renderers/native/chrome/marks/layout';
import type { TimelineMark } from '../src/core/marks/types';

const H = 3_600_000;
const T0 = Date.UTC(2024, 5, 10);
// Hourly bars with a closed session after bar 4: bars 0–4 are contiguous, bar 5 opens four hours after bar 4.
const times = [0, 1, 2, 3, 4, 8, 9, 10].map((h) => T0 + h * H);
const mark = (id: string, time: number, extra: Partial<TimelineMark> = {}): TimelineMark => ({ id, time, glyph: { color: '#2962ff', letter: id[0]! }, ...extra });

describe('marks · snapMarkBar', () => {
    it('lands inside the bar whose span contains the time', () => {
        expect(snapMarkBar(T0 + 2 * H + 15 * 60_000, times, H)).toBe(2);
        expect(snapMarkBar(T0 + 2 * H, times, H)).toBe(2); // exactly at the open
        expect(snapMarkBar(T0 + 3 * H - 1, times, H)).toBe(2); // last ms of the span
    });

    it('a time in a gap goes to the first bar after it', () => {
        expect(snapMarkBar(T0 + 5 * H, times, H)).toBe(5); // bar 4 closed at 5h; next bar opens at 8h
        expect(snapMarkBar(T0 + 6.5 * H, times, H)).toBe(5);
    });

    it('past the newest bar it projects onto the extrapolated grid', () => {
        expect(snapMarkBar(T0 + 10 * H + 59 * 60_000, times, H)).toBe(7); // still inside the last bar
        expect(snapMarkBar(T0 + 11 * H, times, H)).toBe(8);
        expect(snapMarkBar(T0 + 13.5 * H, times, H)).toBe(10);
    });

    it('has nothing to anchor to before the first bar, without bars, or without a cadence', () => {
        expect(snapMarkBar(T0 - 1, times, H)).toBeNull();
        expect(snapMarkBar(T0, [], H)).toBeNull();
        expect(snapMarkBar(T0, times, 0)).toBeNull();
        expect(snapMarkBar(Number.NaN, times, H)).toBeNull();
    });
});

describe('marks · clusterMarks', () => {
    it('folds same-bar, same-group marks and orders them by time, then insertion', () => {
        const marks = [mark('b', T0 + 2 * H + 30 * 60_000, { group: 'g' }), mark('a', T0 + 2 * H + 5 * 60_000, { group: 'g' }), mark('c', T0 + 2 * H + 30 * 60_000, { group: 'g' })];
        const out = clusterMarks(marks, times, H, () => false);
        expect(out).toHaveLength(1);
        expect(out[0]!.key).toBe('2|g');
        expect(out[0]!.marks.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('a coarser timeframe folds marks that were bars apart on a finer one', () => {
        const fiveMin = 300_000;
        const fine = Array.from({ length: 24 }, (_, i) => T0 + i * fiveMin);
        const marks = [mark('a', T0 + 5 * fiveMin), mark('b', T0 + 9 * fiveMin)]; // 00:25 and 00:45 — two 5-minute bars, one hourly bar
        expect(clusterMarks(marks, fine, fiveMin, () => false)).toHaveLength(2);
        expect(clusterMarks(marks, times, H, () => false)).toHaveLength(1);
    });

    it('keeps groups apart and drops hidden ones', () => {
        const marks = [mark('a', T0 + H, { group: 'x' }), mark('b', T0 + H, { group: 'y' }), mark('c', T0 + H)];
        expect(clusterMarks(marks, times, H, () => false).map((c) => c.key).sort()).toEqual(['1|', '1|x', '1|y']);
        expect(clusterMarks(marks, times, H, (g) => g === 'y').map((c) => c.key).sort()).toEqual(['1|', '1|x']);
    });
});

describe('marks · layoutMarkLane', () => {
    const base = {
        groups: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
        ],
        hidden: () => false,
        barTimes: times,
        intervalMs: H,
        xOf: (bar: number) => 100 + bar * 10,
        axisY: 400,
        dataW: 500,
        expanded: null as number | null,
    };

    it('a lone mark is a 16 px token centered on its bar, its bottom MARK_LANE_INSET above the axis line', () => {
        const l = layoutMarkLane({ ...base, marks: [mark('a', T0 + 3 * H + 10, { group: 'x' })] });
        expect(l.glyphs).toHaveLength(1);
        const g = l.glyphs[0]!;
        expect(g.size).toBe(MARK_GLYPH_PX);
        expect(g.x).toBe(130);
        expect(g.y + g.size / 2).toBe(400 - MARK_LANE_INSET);
        expect(g.decked).toBe(false);
    });

    it('a cluster is the larger token', () => {
        const l = layoutMarkLane({ ...base, marks: [mark('a', T0 + 3 * H, { group: 'x' }), mark('b', T0 + 3 * H + 1, { group: 'x' })] });
        expect(l.glyphs).toHaveLength(1);
        expect(l.glyphs[0]!.size).toBe(MARK_CLUSTER_PX);
        expect(l.glyphs[0]!.cluster.marks.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('several groups on one bar deck: the first-defined group on top, deeper ones peeking up, painted deeper-first', () => {
        const l = layoutMarkLane({ ...base, marks: [mark('b', T0 + 3 * H, { group: 'y' }), mark('a', T0 + 3 * H, { group: 'x' }), mark('c', T0 + 3 * H)] });
        const stack = l.stacks.get(3)!;
        expect(stack.map((g) => g.cluster.group)).toEqual(['x', 'y', undefined]);
        expect(stack.every((g) => g.decked)).toBe(true);
        expect(stack[0]!.y - stack[1]!.y).toBe(MARK_DECK_STEP);
        expect(stack[1]!.y - stack[2]!.y).toBe(MARK_DECK_STEP);
        expect(l.glyphs.map((g) => g.depth)).toEqual([2, 1, 0]);
    });

    it('an expanded stack fans upward with MARK_FAN_GAP between tokens', () => {
        const l = layoutMarkLane({ ...base, expanded: 3, marks: [mark('a', T0 + 3 * H, { group: 'x' }), mark('b', T0 + 3 * H, { group: 'y' }), mark('c', T0 + 3 * H)] });
        const s = l.stacks.get(3)!;
        expect(s.every((g) => !g.decked)).toBe(true);
        expect(s[0]!.y + s[0]!.size / 2).toBe(400 - MARK_LANE_INSET);
        expect(s[0]!.y - s[0]!.size / 2 - (s[1]!.y + s[1]!.size / 2)).toBe(MARK_FAN_GAP);
        expect(s[1]!.y - s[1]!.size / 2 - (s[2]!.y + s[2]!.size / 2)).toBe(MARK_FAN_GAP);
    });

    it('a single-group bar never decks or fans, whatever `expanded` says', () => {
        const l = layoutMarkLane({ ...base, expanded: 3, marks: [mark('a', T0 + 3 * H, { group: 'x' })] });
        expect(l.glyphs[0]!.decked).toBe(false);
        expect(l.glyphs[0]!.y + l.glyphs[0]!.size / 2).toBe(400 - MARK_LANE_INSET);
    });

    it('skips stacks off the plot', () => {
        const l = layoutMarkLane({ ...base, xOf: () => -100, marks: [mark('a', T0 + 3 * H)] });
        expect(l.glyphs).toHaveLength(0);
        expect(layoutMarkLane({ ...base, xOf: () => 800, marks: [mark('a', T0 + 3 * H)] }).glyphs).toHaveLength(0);
    });
});

describe('marks · hit-testing', () => {
    const base = {
        groups: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
        ],
        hidden: () => false,
        barTimes: times,
        intervalMs: H,
        xOf: (bar: number) => 100 + bar * 10,
        axisY: 400,
        dataW: 500,
    };
    const marks = [mark('a', T0 + 3 * H, { group: 'x' }), mark('b', T0 + 3 * H, { group: 'y' })];

    it('markGlyphAt answers the topmost glyph and ignores a deck’s buried cards', () => {
        const l = layoutMarkLane({ ...base, expanded: null, marks });
        const top = l.stacks.get(3)![0]!;
        const buried = l.stacks.get(3)![1]!;
        expect(markGlyphAt(l, top.x, top.y)?.cluster.group).toBe('x');
        // The buried card's own center is covered by the top card; a point on its peeking
        // edge is NOT interactive either — the deck opens as a whole (hover/tap), not by card.
        expect(markGlyphAt(l, buried.x, buried.y - buried.size / 2 - 1)).toBeNull();
        expect(markGlyphAt(l, 300, 300)).toBeNull();
    });

    it('a fanned stack exposes every glyph, and markStackAt keeps the fan open across its gaps', () => {
        const l = layoutMarkLane({ ...base, expanded: 3, marks });
        const [bottom, top] = l.stacks.get(3)! as [ReturnType<typeof markGlyphAt> & object, ReturnType<typeof markGlyphAt> & object];
        expect(markGlyphAt(l, top.x, top.y)?.cluster.group).toBe('y');
        expect(markGlyphAt(l, bottom.x, bottom.y)?.cluster.group).toBe('x');
        const gapY = (bottom.y - bottom.size / 2 + (top.y + top.size / 2)) / 2;
        expect(markStackAt(l, bottom.x, gapY)).toBe(3);
        // A short overshoot past the top glyph keeps the fan; further up it folds.
        expect(markStackAt(l, bottom.x, top.y - top.size / 2 - MARK_FAN_HOLD)).toBe(3);
        expect(markStackAt(l, bottom.x, top.y - top.size / 2 - MARK_FAN_HOLD - 1)).toBeNull();
    });
});

describe('marks · labels', () => {
    const groups = [{ id: 'dividends', label: 'Dividends' }];

    it('a lone mark shows its tooltip, else its title; a cluster names its group and size', () => {
        const single = { key: '1|dividends', bar: 1, group: 'dividends', marks: [mark('a', T0, { title: 'Dividend', tooltip: 'Div · 0.01' })] };
        expect(clusterTooltip(single, groups)).toBe('Div · 0.01');
        expect(clusterTooltip({ ...single, marks: [mark('a', T0, { title: 'Dividend' })] }, groups)).toBe('Dividend');
        const cluster = { key: '1|dividends', bar: 1, group: 'dividends', marks: [mark('a', T0), mark('b', T0)] };
        expect(clusterTooltip(cluster, groups)).toBe('Dividends · 2');
        expect(clusterTooltip({ ...cluster, group: 'splits', key: '1|splits' }, groups)).toBe('Splits · 2');
    });

    it('an undefined group falls back to its capitalized id; effectiveMarkGroups lists defined groups first', () => {
        expect(markGroupLabel('splits', groups)).toBe('Splits');
        expect(markGroupLabel('dividends', groups)).toBe('Dividends');
        const marks = [mark('a', T0, { group: 'splits' }), mark('b', T0, { group: 'dividends' }), mark('c', T0)];
        expect(effectiveMarkGroups(marks, groups)).toEqual([
            { id: 'dividends', label: 'Dividends' },
            { id: 'splits', label: 'Splits' },
        ]);
    });
});

describe('marks · glyphs that would overlap fold into one cluster', () => {
    // A dense feed on a fine timeframe: one same-group mark on each of eight consecutive bars.
    const M = 60_000;
    const minuteBars = Array.from({ length: 8 }, (_, i) => T0 + i * M);
    const dense = minuteBars.map((t, i) => mark(`n${i}`, t, { group: 'news' }));
    const lane = (pxPerBar: number, marks = dense, extra: Partial<Parameters<typeof layoutMarkLane>[0]> = {}) =>
        layoutMarkLane({
            marks,
            groups: [{ id: 'news', label: 'News' }],
            hidden: () => false,
            barTimes: minuteBars,
            intervalMs: M,
            xOf: (bar) => 100 + bar * pxPerBar,
            axisY: 400,
            dataW: 2000,
            expanded: null,
            ...extra,
        });

    it('zoomed out, adjacent same-group marks fold into clusters instead of a band of overlapping glyphs', () => {
        const l = lane(6); // six pixels per bar — sixteen-pixel glyphs would overlap
        // 8 bars × 6 px = 48 px of lane: clusters a glyph-width apart, each holding the bars under it.
        expect(l.glyphs.map((g) => g.cluster.marks.map((m) => m.id))).toEqual([
            ['n0', 'n1', 'n2', 'n3'],
            ['n4', 'n5', 'n6', 'n7'],
        ]);
        expect(l.glyphs.every((g) => g.size === MARK_CLUSTER_PX)).toBe(true);
    });

    it('a dense lane becomes a row of clusters that never overlap — not one giant glyph at the left edge', () => {
        // 200 hourly stories on a 200-bar chart at nine pixels per bar (a 1 h chart on a wide screen).
        const bars = Array.from({ length: 200 }, (_, i) => T0 + i * H);
        const marks = bars.map((t, i) => mark(`s${i}`, t, { group: 'news' }));
        const l = layoutMarkLane({ marks, groups: [], hidden: () => false, barTimes: bars, intervalMs: H, xOf: (bar) => 10 + bar * 9, axisY: 400, dataW: 2000, expanded: null });
        expect(l.glyphs.length).toBeGreaterThan(50);
        expect(l.glyphs.length).toBeLessThan(200);
        const xs = l.glyphs.map((g) => g.x).sort((a, b) => a - b);
        for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(MARK_CLUSTER_PX);
        expect(l.glyphs.reduce((n, g) => n + g.cluster.marks.length, 0)).toBe(200); // every story is still reachable
    });

    it('zoomed in, the same marks stand apart again, one glyph per bar', () => {
        expect(lane(MARK_CLUSTER_PX).glyphs).toHaveLength(8);
        expect(lane(40).glyphs).toHaveLength(8);
    });

    it('a merged cluster sits on its earliest bar and keeps that key, so an open popup can follow it', () => {
        const l = lane(6);
        const g = l.glyphs[0]!;
        expect(g.cluster.bar).toBe(0);
        expect(g.cluster.key).toBe('0|news');
        expect(g.x).toBe(100);
        expect(g.stack).toBe(0);
    });

    it('a wide gap in the marks ends a cluster: two distant runs are two clusters', () => {
        const bars = Array.from({ length: 44 }, (_, i) => T0 + i * M);
        const marks = [0, 1, 2, 3, 40, 41, 42, 43].map((i) => mark(`m${i}`, bars[i]!, { group: 'news' }));
        const l = layoutMarkLane({ marks, groups: [], hidden: () => false, barTimes: bars, intervalMs: M, xOf: (bar) => 100 + bar * 4, axisY: 400, dataW: 2000, expanded: null });
        expect(l.glyphs.map((g) => g.cluster.marks.map((m) => m.id))).toEqual([
            ['m0', 'm1', 'm2', 'm3'],
            ['m40', 'm41', 'm42', 'm43'],
        ]);
        expect(l.glyphs.map((g) => g.cluster.key)).toEqual(['0|news', '40|news']);
    });

    it('marks of different groups never fold together, however close', () => {
        const mixed = minuteBars.map((t, i) => mark(`x${i}`, t, { group: i % 2 ? 'earnings' : 'news' }));
        const l = lane(6, mixed, { groups: [{ id: 'news', label: 'News' }, { id: 'earnings', label: 'Earnings' }] });
        const byGroup = new Map<string | undefined, string[]>();
        for (const g of l.glyphs) byGroup.set(g.cluster.group, [...(byGroup.get(g.cluster.group) ?? []), ...g.cluster.marks.map((m) => m.id)]);
        expect(byGroup.get('news')).toEqual(['x0', 'x2', 'x4', 'x6']);
        expect(byGroup.get('earnings')).toEqual(['x1', 'x3', 'x5', 'x7']);
        for (const g of l.glyphs) expect(new Set(g.cluster.marks.map((m) => m.group)).size).toBe(1);
    });

    it('the folded glyph is one click target that names every story under it, and its tooltip carries the count', () => {
        const l = lane(6);
        const g = l.glyphs[0]!;
        expect(markGlyphAt(l, g.x, g.y)?.cluster.marks.map((m) => m.id)).toEqual(['n0', 'n1', 'n2', 'n3']);
        expect(clusterTooltip(g.cluster, [{ id: 'news', label: 'News' }])).toBe('News · 4');
    });

    it('foldOverlappingClusters is a pure step over per-bar clusters: marks within a cluster glyph of its anchor join it, the first to clear it starts the next', () => {
        const clusters = clusterMarks(dense, minuteBars, M, () => false);
        expect(clusters).toHaveLength(8);
        expect(foldOverlappingClusters(clusters, (bar) => bar * 5).map((c) => c.marks.length)).toEqual([4, 4]); // 0,5,10,15 | 20,25,30,35
        expect(foldOverlappingClusters(clusters, (bar) => bar * MARK_CLUSTER_PX)).toHaveLength(8); // exactly a glyph apart: clear
        expect(foldOverlappingClusters(clusters, (bar) => bar * (MARK_CLUSTER_PX - 1)).map((c) => c.marks.length)).toEqual([2, 2, 2, 2]); // one pixel short: pairs
    });
});
