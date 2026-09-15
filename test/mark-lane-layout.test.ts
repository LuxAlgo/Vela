// The timeline-mark lane's geometry (src/renderers/native/chrome/marks/layout): bar
// snapping, clustering (per bar, and per pixel slot as bars tighten), stacking, fan-out,
// hit-testing — pure, node env.
import { describe, it, expect } from 'vitest';
import {
    snapMarkBar,
    slotBars,
    clusterMarks,
    layoutMarkLane,
    markGlyphAt,
    markStackAt,
    clusterTooltip,
    markGroupLabel,
    effectiveMarkGroups,
    MARK_GLYPH_PX,
    MARK_SLOT_PX,
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
const none = (): boolean => false;

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

describe('marks · slotBars', () => {
    it('is one bar while a token fits per bar, and grows as bars tighten', () => {
        expect(slotBars(40)).toBe(1);
        expect(slotBars(MARK_SLOT_PX)).toBe(1);
        expect(slotBars(MARK_SLOT_PX - 1)).toBe(2);
        expect(slotBars(5)).toBe(Math.ceil(MARK_SLOT_PX / 5));
        expect(slotBars(0)).toBe(1);
    });
});

describe('marks · clusterMarks', () => {
    it('folds same-bar, same-group marks and orders them by time, then insertion', () => {
        const marks = [mark('b', T0 + 2 * H + 30 * 60_000, { group: 'g' }), mark('a', T0 + 2 * H + 5 * 60_000, { group: 'g' }), mark('c', T0 + 2 * H + 30 * 60_000, { group: 'g' })];
        const out = clusterMarks(marks, times, H, none);
        expect(out).toHaveLength(1);
        expect(out[0]!.key).toBe('2|g');
        expect(out[0]!.slot).toBe(2);
        expect(out[0]!.anchor).toBe(2);
        expect(out[0]!.marks.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('a coarser timeframe folds marks that were bars apart on a finer one', () => {
        const fiveMin = 300_000;
        const fine = Array.from({ length: 24 }, (_, i) => T0 + i * fiveMin);
        const marks = [mark('a', T0 + 5 * fiveMin), mark('b', T0 + 9 * fiveMin)]; // 00:25 and 00:45 — two 5-minute bars, one hourly bar
        expect(clusterMarks(marks, fine, fiveMin, none)).toHaveLength(2);
        expect(clusterMarks(marks, times, H, none)).toHaveLength(1);
    });

    it('keeps groups apart and drops hidden ones', () => {
        const marks = [mark('a', T0 + H, { group: 'x' }), mark('b', T0 + H, { group: 'y' }), mark('c', T0 + H)];
        expect(clusterMarks(marks, times, H, none).map((c) => c.key).sort()).toEqual(['1|', '1|x', '1|y']);
        expect(clusterMarks(marks, times, H, (g) => g === 'y').map((c) => c.key).sort()).toEqual(['1|', '1|x']);
    });

    it('with several bars per slot, neighboring bars of one group fold into one counted cluster anchored on their mean bar', () => {
        const marks = [0, 1, 2, 3, 4, 7].map((h) => mark(`m${h}`, times[h]!, { group: 'g' }));
        const out = clusterMarks(marks, times, H, none, 4);
        expect(out.map((c) => c.key)).toEqual(['0|g', '4|g']);
        expect(out[0]!.marks.map((m) => m.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
        expect(out[0]!.from).toBe(0);
        expect(out[0]!.to).toBe(3);
        expect(out[0]!.anchor).toBe(1.5);
        expect(out[1]!.marks.map((m) => m.id)).toEqual(['m4', 'm7']);
        expect(out[1]!.anchor).toBe(5.5);
        // Slots are cut from bar 0, so the cut does not move with the view.
        expect(clusterMarks(marks, times, H, none, 3).map((c) => c.key)).toEqual(['0|g', '3|g', '6|g']);
    });
});

describe('marks · layoutMarkLane', () => {
    const base = {
        groups: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
        ],
        hidden: none,
        barTimes: times,
        intervalMs: H,
        pxPerBar: 40, // a token fits per bar ⇒ one bar per slot
        xOf: (bar: number) => 100 + bar * 40,
        axisY: 400,
        dataW: 800,
        expanded: null as number | null,
    };

    it('a lone mark is a 16 px token centered on its bar, its bottom MARK_LANE_INSET above the axis line', () => {
        const l = layoutMarkLane({ ...base, marks: [mark('a', T0 + 3 * H + 10, { group: 'x' })] });
        expect(l.glyphs).toHaveLength(1);
        const g = l.glyphs[0]!;
        expect(g.size).toBe(MARK_GLYPH_PX);
        expect(g.x).toBe(220);
        expect(g.y + g.size / 2).toBe(400 - MARK_LANE_INSET);
        expect(g.decked).toBe(false);
    });

    it('a cluster is one token of the same size listing every mark (the badge tells it apart)', () => {
        const l = layoutMarkLane({ ...base, marks: [mark('a', T0 + 3 * H, { group: 'x' }), mark('b', T0 + 3 * H + 1, { group: 'x' })] });
        expect(l.glyphs).toHaveLength(1);
        expect(l.glyphs[0]!.size).toBe(MARK_GLYPH_PX);
        expect(l.glyphs[0]!.cluster.marks.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('as bars tighten, a slot spans several bars: a dense group reads as a few counted tokens, never a band', () => {
        const dense = Array.from({ length: 8 }, (_, i) => mark(`d${i}`, times[i]!, { group: 'x' }));
        const l = layoutMarkLane({ ...base, pxPerBar: 5, xOf: (bar) => 100 + bar * 5, marks: dense }); // 4 bars per slot
        expect(l.glyphs).toHaveLength(2);
        expect(l.glyphs.map((g) => g.cluster.marks.length)).toEqual([4, 4]);
        expect(l.glyphs[0]!.x).toBe(100 + 1.5 * 5); // the members' mean bar
        expect(l.glyphs[1]!.x).toBe(100 + 5.5 * 5);
        expect(l.glyphs[1]!.x - l.glyphs[0]!.x).toBeGreaterThanOrEqual(MARK_SLOT_PX);
        // Zooming in (a wider pitch) splits them back into one token per bar.
        expect(layoutMarkLane({ ...base, marks: dense }).glyphs).toHaveLength(8);
    });

    it('several groups in one slot deck: the first-defined group on top, deeper ones peeking up, painted deeper-first', () => {
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

    it('a single-group slot never decks or fans, whatever `expanded` says', () => {
        const l = layoutMarkLane({ ...base, expanded: 3, marks: [mark('a', T0 + 3 * H, { group: 'x' })] });
        expect(l.glyphs[0]!.decked).toBe(false);
        expect(l.glyphs[0]!.y + l.glyphs[0]!.size / 2).toBe(400 - MARK_LANE_INSET);
    });

    it('skips stacks off the plot, and any token that would straddle the plot edge into the axis gutter', () => {
        const one = [mark('a', T0 + 3 * H)];
        expect(layoutMarkLane({ ...base, xOf: () => -100, marks: one }).glyphs).toHaveLength(0);
        expect(layoutMarkLane({ ...base, xOf: () => 900, marks: one }).glyphs).toHaveLength(0);
        expect(layoutMarkLane({ ...base, xOf: () => 800 - MARK_GLYPH_PX / 2 + 1, marks: one }).glyphs).toHaveLength(0); // right edge: half a token past
        expect(layoutMarkLane({ ...base, xOf: () => 800 - MARK_GLYPH_PX / 2, marks: one }).glyphs).toHaveLength(1); // exactly whole
        expect(layoutMarkLane({ ...base, xOf: () => MARK_GLYPH_PX / 2 - 1, marks: one }).glyphs).toHaveLength(0); // left edge
    });
});

describe('marks · hit-testing', () => {
    const base = {
        groups: [
            { id: 'x', label: 'X' },
            { id: 'y', label: 'Y' },
        ],
        hidden: none,
        barTimes: times,
        intervalMs: H,
        pxPerBar: 40,
        xOf: (bar: number) => 100 + bar * 40,
        axisY: 400,
        dataW: 800,
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
    const cluster = (over: Partial<ReturnType<typeof clusterMarks>[number]>) => ({ key: '1|dividends', slot: 1, from: 1, to: 1, anchor: 1, group: 'dividends', marks: [] as TimelineMark[], ...over });

    it('a lone mark shows its tooltip, else its title; a cluster names its group and size', () => {
        expect(clusterTooltip(cluster({ marks: [mark('a', T0, { title: 'Dividend', tooltip: 'Div · 0.01' })] }), groups)).toBe('Div · 0.01');
        expect(clusterTooltip(cluster({ marks: [mark('a', T0, { title: 'Dividend' })] }), groups)).toBe('Dividend');
        expect(clusterTooltip(cluster({ marks: [mark('a', T0), mark('b', T0)] }), groups)).toBe('Dividends · 2');
        expect(clusterTooltip(cluster({ key: '1|splits', group: 'splits', marks: [mark('a', T0), mark('b', T0)] }), groups)).toBe('Splits · 2');
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
