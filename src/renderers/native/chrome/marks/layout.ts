// The timeline-mark LANE's geometry — pure functions, node-testable: where each mark
// snaps on the bar grid, how marks fold into clusters and stacks, where every glyph
// sits, and which glyph is under a point. The painter and the renderer's hit-tests both
// read the same `MarkLaneLayout`, so what is drawn is exactly what is clickable.
import type { MarkGroup, TimelineMark } from '../../../../core/marks/types';

/** Token size, px — one size for every glyph; a cluster tells itself apart by its count badge. */
export const MARK_GLYPH_PX = 16;
/** The pixel room one token needs on the lane. Bars closer than this share a SLOT, so
 *  neighboring marks of one group fold into one counted token instead of overlapping. */
export const MARK_SLOT_PX = MARK_GLYPH_PX + 4;
/** Air between a glyph's bottom edge and the time-axis line, px. */
export const MARK_LANE_INSET = 4;
/** In a collapsed stack (several groups in one slot) each deeper group peeks out this far above the one over it, px. */
export const MARK_DECK_STEP = 3;
/** Gap between the fanned-out glyphs of an expanded stack, px. */
export const MARK_FAN_GAP = 4;
/** Forgiveness around a glyph for hover/click, px — half the slot gap, so neighboring slots' hit areas touch but never overlap. */
export const MARK_HIT_PAD = (MARK_SLOT_PX - MARK_GLYPH_PX) / 2;
/** Extra reach above a fanned stack's top glyph before the fan folds — a pointer overshooting the top by a few px keeps it open, px. */
export const MARK_FAN_HOLD = 8;

/** The marks of one visibility group that fell into one lane slot. */
export interface MarkCluster {
    /** `${slot}|${group}` — stable across pans; a zoom re-cuts the slots. What an open popup is keyed by. */
    key: string;
    /** The slot's first bar index (may lie past the loaded range: the extrapolated grid). */
    slot: number;
    /** The bar range the members span, inclusive. */
    from: number;
    to: number;
    /** The (fractional) bar the token centers on — the members' mean bar. */
    anchor: number;
    group: string | undefined;
    /** Earliest time first, then insertion order. */
    marks: TimelineMark[];
}

/** One glyph as laid out for this frame. */
export interface PlacedGlyph {
    cluster: MarkCluster;
    /** Center, plot-space px. */
    x: number;
    y: number;
    size: number;
    /** The stack (slot) this glyph belongs to, and its depth in it (0 = the top group). */
    stack: number;
    depth: number;
    /** The stack holds several groups and is drawn collapsed (a deck): only its top glyph is interactive. */
    decked: boolean;
}

export interface MarkLaneLayout {
    /** In paint order (a deck's deeper glyphs first, its top glyph last). */
    glyphs: PlacedGlyph[];
    /** Per stack (slot), depth-ordered. */
    stacks: Map<number, PlacedGlyph[]>;
}

export interface MarkLaneInput {
    marks: readonly TimelineMark[];
    /** The defined groups, in definition order — the deck order of a multi-group stack. */
    groups: readonly MarkGroup[];
    /** Whether a group's marks are hidden (settings) — never called for ungrouped marks. */
    hidden: (groupId: string) => boolean;
    /** The chart's bar open times, ascending. */
    barTimes: readonly number[];
    intervalMs: number;
    /** Center-to-center pixel pitch between adjacent bars — what sets how many bars a slot spans. */
    pxPerBar: number;
    /** (Fractional) bar index → plot x. */
    xOf: (bar: number) => number;
    /** The y of the time-axis line (the plot's data height). */
    axisY: number;
    dataW: number;
    /** The stack (slot) fanned out by hover/tap, if any. */
    expanded: number | null;
}

/**
 * The bar a mark time belongs to: the bar whose `[open, open + interval)` span contains
 * it; a time in a gap (weekend, closed session) goes to the first bar that follows; a
 * time past the newest bar's span lands on the extrapolated grid (a virtual bar in the
 * right whitespace). `null` before the first loaded bar — nothing to anchor to yet.
 */
export function snapMarkBar(time: number, barTimes: readonly number[], intervalMs: number): number | null {
    const n = barTimes.length;
    if (n === 0 || !(intervalMs > 0) || !Number.isFinite(time)) return null;
    if (time < barTimes[0]!) return null;
    const last = barTimes[n - 1]!;
    if (time >= last + intervalMs) return n - 1 + Math.floor((time - last) / intervalMs);
    // Greatest i with barTimes[i] <= time.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (barTimes[mid]! <= time) lo = mid;
        else hi = mid - 1;
    }
    if (time < barTimes[lo]! + intervalMs) return lo;
    return lo + 1; // in a gap — `time < last + interval` guarantees lo < n - 1
}

/** How many bars one lane slot spans at a bar pitch: 1 while a token fits per bar, more as bars tighten. */
export function slotBars(pxPerBar: number): number {
    return pxPerBar > 0 ? Math.max(1, Math.ceil(MARK_SLOT_PX / pxPerBar)) : 1;
}

/**
 * Fold the visible marks into clusters keyed by (slot, group) — a slot being `barsPerSlot`
 * consecutive bars, cut from bar 0 so the cut is stable while panning. Each cluster's marks
 * run earliest-first, then insertion order.
 */
export function clusterMarks(
    marks: readonly TimelineMark[],
    barTimes: readonly number[],
    intervalMs: number,
    hidden: (groupId: string) => boolean,
    barsPerSlot = 1,
): MarkCluster[] {
    const per = Math.max(1, Math.floor(barsPerSlot));
    const byKey = new Map<string, MarkCluster & { seq: number[]; sumBar: number }>();
    marks.forEach((m, seq) => {
        if (m.group !== undefined && hidden(m.group)) return;
        const bar = snapMarkBar(m.time, barTimes, intervalMs);
        if (bar === null) return;
        const slot = Math.floor(bar / per) * per;
        const key = `${slot}|${m.group ?? ''}`;
        let c = byKey.get(key);
        if (!c) {
            c = { key, slot, from: bar, to: bar, anchor: bar, group: m.group, marks: [], seq: [], sumBar: 0 };
            byKey.set(key, c);
        }
        c.marks.push(m);
        c.seq.push(seq);
        c.sumBar += bar;
        if (bar < c.from) c.from = bar;
        if (bar > c.to) c.to = bar;
    });
    const out: MarkCluster[] = [];
    for (const c of byKey.values()) {
        const order = c.marks.map((m, i) => ({ m, seq: c.seq[i]! })).sort((a, b) => a.m.time - b.m.time || a.seq - b.seq);
        out.push({ key: c.key, slot: c.slot, from: c.from, to: c.to, anchor: c.sumBar / c.marks.length, group: c.group, marks: order.map((o) => o.m) });
    }
    return out;
}

/** Deck order of the groups: defined groups first (definition order), then undefined ones by first appearance, ungrouped marks last. */
function groupRank(groups: readonly MarkGroup[], clusters: readonly MarkCluster[]): (group: string | undefined) => number {
    const rank = new Map<string, number>();
    groups.forEach((g, i) => rank.set(g.id, i));
    for (const c of clusters) {
        if (c.group !== undefined && !rank.has(c.group)) rank.set(c.group, rank.size);
    }
    return (group) => (group === undefined ? Number.MAX_SAFE_INTEGER : (rank.get(group) ?? Number.MAX_SAFE_INTEGER - 1));
}

/** Lay the lane out for one frame. */
export function layoutMarkLane(input: MarkLaneInput): MarkLaneLayout {
    const clusters = clusterMarks(input.marks, input.barTimes, input.intervalMs, input.hidden, slotBars(input.pxPerBar));
    const rankOf = groupRank(input.groups, clusters);
    const bySlot = new Map<number, MarkCluster[]>();
    for (const c of clusters) {
        const list = bySlot.get(c.slot);
        if (list) list.push(c);
        else bySlot.set(c.slot, [c]);
    }
    const glyphs: PlacedGlyph[] = [];
    const stacks = new Map<number, PlacedGlyph[]>();
    const size = MARK_GLYPH_PX;
    for (const [slot, list] of bySlot) {
        // The stack centers on its marks' mean bar, every group weighing in by its count.
        let bars = 0;
        let count = 0;
        for (const c of list) {
            bars += c.anchor * c.marks.length;
            count += c.marks.length;
        }
        const x = input.xOf(bars / count);
        // A token must sit whole inside the data area — one straddling the plot's edge would
        // paint (and answer clicks) over the price-axis gutter.
        if (!Number.isFinite(x) || x < size / 2 || x > input.dataW - size / 2) continue;
        list.sort((a, b) => rankOf(a.group) - rankOf(b.group));
        const multi = list.length > 1;
        const expanded = multi && input.expanded === slot;
        const decked = multi && !expanded;
        const placed: PlacedGlyph[] = [];
        list.forEach((cluster, depth) => {
            const y = expanded
                ? input.axisY - MARK_LANE_INSET - size / 2 - depth * (size + MARK_FAN_GAP)
                : input.axisY - MARK_LANE_INSET - size / 2 - depth * MARK_DECK_STEP;
            placed.push({ cluster, x, y, size, stack: slot, depth, decked });
        });
        // Deeper glyphs paint first so the top group ends up on top of the deck.
        for (let i = placed.length - 1; i >= 0; i--) glyphs.push(placed[i]!);
        stacks.set(slot, placed);
    }
    return { glyphs, stacks };
}

/** The interactive glyph under a plot point, topmost first; a collapsed deck answers with its top glyph only. */
export function markGlyphAt(layout: MarkLaneLayout, x: number, y: number): PlacedGlyph | null {
    for (let i = layout.glyphs.length - 1; i >= 0; i--) {
        const g = layout.glyphs[i]!;
        if (g.decked && g.depth !== 0) continue;
        const r = g.size / 2 + MARK_HIT_PAD;
        if (Math.abs(x - g.x) <= r && Math.abs(y - g.y) <= r) return g;
    }
    return null;
}

/** The stack (slot) whose fanned or decked glyphs cover a plot point — what keeps a fan open while the pointer climbs it. */
export function markStackAt(layout: MarkLaneLayout, x: number, y: number): number | null {
    for (const [slot, placed] of layout.stacks) {
        for (const g of placed) {
            const r = g.size / 2 + MARK_HIT_PAD;
            if (Math.abs(x - g.x) <= r && Math.abs(y - g.y) <= r) return slot;
        }
        // The gaps between fanned glyphs count too — a pointer climbing the fan must not collapse
        // it — and so does a short reach past the top glyph, so overshooting it by a few pixels
        // does not fold the fan under the pointer.
        if (placed.length > 1 && !placed[0]!.decked) {
            const top = placed[placed.length - 1]!;
            const base = placed[0]!;
            const r = Math.max(top.size, base.size) / 2 + MARK_HIT_PAD;
            if (Math.abs(x - base.x) <= r && y >= top.y - top.size / 2 - MARK_FAN_HOLD && y <= base.y + base.size / 2 + MARK_HIT_PAD) return slot;
        }
    }
    return null;
}

/** Hover text for a glyph: the mark's own tooltip (or title) alone; a cluster names its group and size. */
export function clusterTooltip(cluster: MarkCluster, groups: readonly MarkGroup[]): string | null {
    const first = cluster.marks[0];
    if (!first) return null;
    if (cluster.marks.length === 1) return first.tooltip ?? first.title ?? null;
    const label = cluster.group !== undefined ? markGroupLabel(cluster.group, groups) : (first.title ?? first.tooltip ?? 'Marks');
    return `${label} · ${cluster.marks.length}`;
}

/** A group's display label: its definition, else the capitalized id. */
export function markGroupLabel(groupId: string, groups: readonly MarkGroup[]): string {
    const def = groups.find((g) => g.id === groupId);
    if (def) return def.label;
    return groupId.charAt(0).toUpperCase() + groupId.slice(1);
}

/** Every group the chart knows about: the defined ones (definition order), then the ids marks name without a definition (first appearance), each with its display label. */
export function effectiveMarkGroups(marks: readonly TimelineMark[], groups: readonly MarkGroup[]): MarkGroup[] {
    const out: MarkGroup[] = groups.map((g) => ({ ...g }));
    const seen = new Set(out.map((g) => g.id));
    for (const m of marks) {
        if (m.group === undefined || seen.has(m.group)) continue;
        seen.add(m.group);
        out.push({ id: m.group, label: markGroupLabel(m.group, groups) });
    }
    return out;
}
