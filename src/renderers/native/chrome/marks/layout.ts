// The timeline-mark LANE's geometry — pure functions, node-testable: where each mark
// snaps on the bar grid, how marks fold into clusters and stacks, where every glyph
// sits, and which glyph is under a point. The painter and the renderer's hit-tests both
// read the same `MarkLaneLayout`, so what is drawn is exactly what is clickable.
import type { MarkGroup, TimelineMark } from '../../../../core/marks/types';

/** Token size of a single mark, px. */
export const MARK_GLYPH_PX = 16;
/** Token size of a cluster (several marks of one group on one bar) — a little larger, px. */
export const MARK_CLUSTER_PX = 20;
/** Air between a glyph's bottom edge and the time-axis line, px. */
export const MARK_LANE_INSET = 4;
/** In a collapsed stack (several groups on one bar) each deeper group peeks out this far above the one over it, px. */
export const MARK_DECK_STEP = 3;
/** Gap between the fanned-out glyphs of an expanded stack, px. */
export const MARK_FAN_GAP = 4;
/** Forgiveness around a glyph for hover/click, px. */
export const MARK_HIT_PAD = 3;
/** Extra reach above a fanned stack's top glyph before the fan folds — a pointer overshooting the top by a few px keeps it open, px. */
export const MARK_FAN_HOLD = 8;

/** The marks of one visibility group that snapped onto one bar. */
export interface MarkCluster {
    /** `${bar}|${group}` — stable across frames, what an open popup is keyed by. */
    key: string;
    /** The snapped bar index (may lie past the loaded range: the extrapolated grid). */
    bar: number;
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
    /** The stack (bar index) this glyph belongs to, and its depth in it (0 = the top group). */
    stack: number;
    depth: number;
    /** The stack holds several groups and is drawn collapsed (a deck): only its top glyph is interactive. */
    decked: boolean;
}

export interface MarkLaneLayout {
    /** In paint order (a deck's deeper glyphs first, its top glyph last). */
    glyphs: PlacedGlyph[];
    /** Per stack (bar index), depth-ordered. */
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
    /** Bar index → plot x of the bar's center. */
    xOf: (bar: number) => number;
    /** The y of the time-axis line (the plot's data height). */
    axisY: number;
    dataW: number;
    /** The stack (bar index) fanned out by hover/tap, if any. */
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

/** Fold the visible marks into clusters keyed by (snapped bar, group); each cluster's marks run earliest-first, then insertion order. */
export function clusterMarks(marks: readonly TimelineMark[], barTimes: readonly number[], intervalMs: number, hidden: (groupId: string) => boolean): MarkCluster[] {
    const byKey = new Map<string, MarkCluster & { seq: number[] }>();
    marks.forEach((m, seq) => {
        if (m.group !== undefined && hidden(m.group)) return;
        const bar = snapMarkBar(m.time, barTimes, intervalMs);
        if (bar === null) return;
        const key = `${bar}|${m.group ?? ''}`;
        let c = byKey.get(key);
        if (!c) {
            c = { key, bar, group: m.group, marks: [], seq: [] };
            byKey.set(key, c);
        }
        c.marks.push(m);
        c.seq.push(seq);
    });
    const out: MarkCluster[] = [];
    for (const c of byKey.values()) {
        const order = c.marks.map((m, i) => ({ m, seq: c.seq[i]! })).sort((a, b) => a.m.time - b.m.time || a.seq - b.seq);
        out.push({ key: c.key, bar: c.bar, group: c.group, marks: order.map((o) => o.m) });
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
    const clusters = clusterMarks(input.marks, input.barTimes, input.intervalMs, input.hidden);
    const rankOf = groupRank(input.groups, clusters);
    const byBar = new Map<number, MarkCluster[]>();
    for (const c of clusters) {
        const list = byBar.get(c.bar);
        if (list) list.push(c);
        else byBar.set(c.bar, [c]);
    }
    const glyphs: PlacedGlyph[] = [];
    const stacks = new Map<number, PlacedGlyph[]>();
    for (const [bar, list] of byBar) {
        const x = input.xOf(bar);
        if (!Number.isFinite(x) || x < -MARK_CLUSTER_PX || x > input.dataW + MARK_CLUSTER_PX) continue;
        list.sort((a, b) => rankOf(a.group) - rankOf(b.group));
        const multi = list.length > 1;
        const expanded = multi && input.expanded === bar;
        const decked = multi && !expanded;
        const placed: PlacedGlyph[] = [];
        // A deck draws every glyph at the TOP glyph's size so the peeking edges line up.
        const deckSize = list[0]!.marks.length > 1 ? MARK_CLUSTER_PX : MARK_GLYPH_PX;
        let bottom = input.axisY - MARK_LANE_INSET; // bottom edge of the next fanned glyph
        list.forEach((cluster, depth) => {
            const size = decked ? deckSize : cluster.marks.length > 1 ? MARK_CLUSTER_PX : MARK_GLYPH_PX;
            let y: number;
            if (expanded) {
                y = bottom - size / 2;
                bottom -= size + MARK_FAN_GAP;
            } else {
                y = input.axisY - MARK_LANE_INSET - size / 2 - depth * MARK_DECK_STEP;
            }
            placed.push({ cluster, x, y, size, stack: bar, depth, decked });
        });
        // Deeper glyphs paint first so the top group ends up on top of the deck.
        for (let i = placed.length - 1; i >= 0; i--) glyphs.push(placed[i]!);
        stacks.set(bar, placed);
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

/** The stack (bar index) whose fanned or decked glyphs cover a plot point — what keeps a fan open while the pointer climbs it. */
export function markStackAt(layout: MarkLaneLayout, x: number, y: number): number | null {
    for (const [bar, placed] of layout.stacks) {
        for (const g of placed) {
            const r = g.size / 2 + MARK_HIT_PAD;
            if (Math.abs(x - g.x) <= r && Math.abs(y - g.y) <= r) return bar;
        }
        // The gaps between fanned glyphs count too — a pointer climbing the fan must not collapse
        // it — and so does a short reach past the top glyph, so overshooting it by a few pixels
        // does not fold the fan under the pointer.
        if (placed.length > 1 && !placed[0]!.decked) {
            const top = placed[placed.length - 1]!;
            const base = placed[0]!;
            const r = Math.max(top.size, base.size) / 2 + MARK_HIT_PAD;
            if (Math.abs(x - base.x) <= r && y >= top.y - top.size / 2 - MARK_FAN_HOLD && y <= base.y + base.size / 2 + MARK_HIT_PAD) return bar;
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
