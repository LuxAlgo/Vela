/**
 * Price-scale chips that must not cover each other: the last-price chip and the indicator
 * value tags sharing one scale column. Each chip wants to sit centered on its own price;
 * where chips would overlap they are pushed apart as little as possible, keeping their
 * price order. A `fixed` chip (the last-price chip) never moves; the others step away from it.
 */
export interface AxisTagSlot {
    /** Where the chip would sit if nothing else were on the scale. */
    top: number;
    height: number;
    /** Never moved — every other chip makes room around it. */
    fixed?: boolean;
}

interface Cluster {
    /** Slot indices, top to bottom. */
    items: number[];
    top: number;
    height: number;
}

/**
 * The resolved top of each slot, in input order. Free chips stay inside `[minTop, maxBottom]`
 * when they fit; a fixed chip stays at its own `top` wherever that is.
 */
export function spreadAxisTags(slots: readonly AxisTagSlot[], minTop: number, maxBottom: number): number[] {
    const order = slots
        .map((_, i) => i)
        // Price order; on a tie the fixed chip goes first so the free one steps below it.
        .sort((a, b) => slots[a]!.top - slots[b]!.top || Number(slots[b]!.fixed === true) - Number(slots[a]!.fixed === true) || a - b);
    let clusters: Cluster[] = order.map((i) => ({ items: [i], top: slots[i]!.top, height: slots[i]!.height }));

    const place = (c: Cluster): void => {
        // Offset of each item from the cluster's top when stacked edge to edge.
        let offset = 0;
        let fixedTop: number | null = null;
        let sum = 0;
        for (const i of c.items) {
            const s = slots[i]!;
            if (s.fixed && fixedTop === null) fixedTop = s.top - offset;
            sum += s.top - offset;
            offset += s.height;
        }
        c.height = offset;
        if (fixedTop !== null) {
            c.top = fixedTop;
            return;
        }
        // Least total displacement for a free stack: its mean wanted top.
        const top = sum / c.items.length;
        const room = maxBottom - minTop;
        c.top = c.height > room ? minTop : Math.min(Math.max(top, minTop), maxBottom - c.height);
    };

    clusters.forEach(place);
    // Merge neighbors that overlap until none do. Each merge removes a cluster, so this ends.
    for (;;) {
        let merged = false;
        const next: Cluster[] = [];
        for (const c of clusters) {
            const prev = next[next.length - 1];
            if (prev && prev.top + prev.height > c.top + 1e-6) {
                prev.items.push(...c.items);
                place(prev);
                merged = true;
            } else {
                next.push(c);
            }
        }
        clusters = next;
        if (!merged) break;
    }

    const out = new Array<number>(slots.length);
    for (const c of clusters) {
        let y = c.top;
        for (const i of c.items) {
            out[i] = y;
            y += slots[i]!.height;
        }
    }
    return out;
}
