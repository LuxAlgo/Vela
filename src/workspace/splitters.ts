// Workspace SPLITTERS — draggable dividers between grid tracks. The math is pure
// (unit-testable); the `SplitterLayer` owns the DOM strips and reads geometry from the
// container each layout pass (the same recompute-per-frame philosophy as the chart).

/** Smallest share of the total weight one track may shrink to (10%). */
const MIN_TRACK_FRAC = 0.1;

/** Even weights for `n` tracks (the double-click reset). */
export function evenTracks(n: number): number[] {
    return Array.from({ length: n }, () => 1);
}

/**
 * Resize the boundary between tracks `index` and `index+1` by a pixel delta — PURE.
 * The two neighbors trade weight (their sum, and every other track, is preserved);
 * both are clamped so neither drops under {@link MIN_TRACK_FRAC} of the total.
 * `sizePx` is the container's content size along the axis (gaps excluded).
 */
export function resizeTracks(weights: readonly number[], index: number, deltaPx: number, sizePx: number): number[] {
    const out = [...weights];
    const a = out[index];
    const b = out[index + 1];
    if (a === undefined || b === undefined || sizePx <= 0) return out;
    const total = out.reduce((s, w) => s + w, 0);
    const min = total * MIN_TRACK_FRAC;
    let deltaFr = (deltaPx / sizePx) * total;
    deltaFr = Math.max(deltaFr, min - a); // a never below min
    deltaFr = Math.min(deltaFr, b - min); // b never below min
    out[index] = a + deltaFr;
    out[index + 1] = b - deltaFr;
    return out;
}

/**
 * Pixel centers of the INTERNAL track boundaries (`n-1` entries) — where the divider
 * strips sit. PURE: cumulative weights over the gap-corrected content size.
 */
export function trackOffsets(weights: readonly number[], sizePx: number, gapPx: number): number[] {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return [];
    const content = sizePx - gapPx * (weights.length - 1);
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < weights.length - 1; i += 1) {
        acc += (weights[i]! / total) * content;
        out.push(acc + gapPx * i + gapPx / 2); // center of the gap after track i
    }
    return out;
}

/**
 * The stretches of one internal boundary that are REAL seams — PURE. `grid[r][c]` is
 * the slot occupying that track (see `occupancyGrid`); a spanning cell makes the two
 * neighboring tracks equal, and no strip may cover that stretch (it would sit on top
 * of a chart, not between two). Returns inclusive track ranges along the boundary's
 * own direction: rows for a `cols` boundary, columns for a `rows` one.
 */
export function seamSegments(grid: readonly (readonly string[])[], axis: 'cols' | 'rows', index: number): Array<[number, number]> {
    const count = axis === 'cols' ? grid.length : (grid[0]?.length ?? 0);
    const isSeam = (k: number): boolean =>
        axis === 'cols' ? grid[k]?.[index] !== grid[k]?.[index + 1] : grid[index]?.[k] !== grid[index + 1]?.[k];
    const out: Array<[number, number]> = [];
    for (let k = 0; k < count; k += 1) {
        if (!isSeam(k)) continue;
        const last = out[out.length - 1];
        if (last && last[1] === k - 1) last[1] = k;
        else out.push([k, k]);
    }
    return out;
}

/**
 * The pixel extent of tracks `from`…`to` (inclusive) along one axis — PURE. Interior
 * ends extend halfway into the adjacent gap so strips meet cleanly at crossings;
 * container ends run flush to the edge.
 */
export function segmentSpanPx(weights: readonly number[], sizePx: number, gapPx: number, from: number, to: number): { start: number; end: number } {
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return { start: 0, end: 0 };
    const content = sizePx - gapPx * (weights.length - 1);
    const startOf = (k: number): number => weights.slice(0, k).reduce((s, w) => s + (w / total) * content, 0) + gapPx * k;
    const start = from === 0 ? 0 : startOf(from) - gapPx / 2;
    const end = to === weights.length - 1 ? sizePx : startOf(to + 1) - gapPx / 2;
    return { start, end };
}

/** What the layer needs from the workspace. */
export interface SplitterDeps {
    /** Current track weights per axis. */
    tracks(): { cols: number[]; rows: number[] };
    /** Slot occupancy by `[row][col]` track — where the strips find their real seams. */
    grid(): string[][];
    /** Commit new weights for one axis (the workspace re-applies the grid template). */
    apply(axis: 'cols' | 'rows', weights: number[]): void;
    /** Reset one axis to an even split (double-click). */
    reset(axis: 'cols' | 'rows'): void;
    /** The grid gap in px (strips center on the gaps). */
    gapPx(): number;
}

const HIT_PX = 8; // strip thickness (the visible seam is the grid gap; this is the grab target)

/**
 * Owns the divider strips over a grid container: one strip per seam SEGMENT of each
 * internal column/row boundary (never the boundary's full length — a cell spanning
 * the boundary must keep receiving the pointer there), repositioned via
 * {@link trackOffsets}/{@link seamSegments} whenever `layout()` is called (layout
 * change, container resize, drag). Dragging trades weight between the two neighboring
 * tracks; double-click evens the axis out.
 */
export class SplitterLayer {
    private readonly strips: HTMLDivElement[] = [];
    private drag: { axis: 'cols' | 'rows'; index: number; startPx: number; startWeights: number[]; sizePx: number } | null = null;

    constructor(
        private readonly container: HTMLElement,
        private readonly deps: SplitterDeps,
    ) {}

    /** Rebuild + reposition the strips for the current tracks/size/occupancy. */
    layout(): void {
        const { cols, rows } = this.deps.tracks();
        const grid = this.deps.grid();
        const rect = this.container.getBoundingClientRect();
        const gap = this.deps.gapPx();
        const placements: Array<{ axis: 'cols' | 'rows'; index: number; css: string }> = [];
        for (const [i, x] of trackOffsets(cols, rect.width, gap).entries()) {
            for (const [from, to] of seamSegments(grid, 'cols', i)) {
                const { start, end } = segmentSpanPx(rows, rect.height, gap, from, to);
                placements.push({
                    axis: 'cols',
                    index: i,
                    css: `left:${Math.round(x - HIT_PX / 2)}px;top:${Math.round(start)}px;width:${HIT_PX}px;height:${Math.round(end - start)}px;cursor:col-resize;`,
                });
            }
        }
        for (const [i, y] of trackOffsets(rows, rect.height, gap).entries()) {
            for (const [from, to] of seamSegments(grid, 'rows', i)) {
                const { start, end } = segmentSpanPx(cols, rect.width, gap, from, to);
                placements.push({
                    axis: 'rows',
                    index: i,
                    css: `left:${Math.round(start)}px;top:${Math.round(y - HIT_PX / 2)}px;width:${Math.round(end - start)}px;height:${HIT_PX}px;cursor:row-resize;`,
                });
            }
        }
        while (this.strips.length > placements.length) this.strips.pop()!.remove();
        while (this.strips.length < placements.length) this.strips.push(this.makeStrip());
        for (const [k, p] of placements.entries()) this.place(this.strips[k]!, p.axis, p.index, p.css);
    }

    destroy(): void {
        for (const s of this.strips.splice(0)) s.remove();
        this.drag = null;
    }

    private makeStrip(): HTMLDivElement {
        const el = document.createElement('div');
        el.className = 'vela-ws-splitter';
        el.style.cssText = 'position:absolute;z-index:30;';
        el.addEventListener('pointerdown', (e) => this.onDown(el, e));
        el.addEventListener('dblclick', () => {
            const axis = el.dataset.axis as 'cols' | 'rows' | undefined;
            if (axis) this.deps.reset(axis);
        });
        this.container.appendChild(el);
        return el;
    }

    private place(el: HTMLDivElement, axis: 'cols' | 'rows', index: number, css: string): void {
        el.dataset.axis = axis;
        el.dataset.index = String(index);
        el.style.cssText = `position:absolute;z-index:30;${css}`;
    }

    private onDown(el: HTMLDivElement, e: PointerEvent): void {
        const axis = el.dataset.axis as 'cols' | 'rows' | undefined;
        const index = Number(el.dataset.index);
        if (!axis || Number.isNaN(index)) return;
        e.preventDefault();
        const rect = this.container.getBoundingClientRect();
        const gap = this.deps.gapPx();
        const tracks = this.deps.tracks()[axis];
        this.drag = {
            axis,
            index,
            startPx: axis === 'cols' ? e.clientX : e.clientY,
            startWeights: [...tracks],
            sizePx: (axis === 'cols' ? rect.width : rect.height) - gap * (tracks.length - 1),
        };
        try {
            el.setPointerCapture(e.pointerId);
        } catch {
            // a synthetic/already-released pointer can't be captured — the move/up pair below still works
        }
        const move = (ev: PointerEvent): void => {
            const d = this.drag;
            if (!d) return;
            const delta = (d.axis === 'cols' ? ev.clientX : ev.clientY) - d.startPx;
            this.deps.apply(d.axis, resizeTracks(d.startWeights, d.index, delta, d.sizePx));
        };
        const up = (): void => {
            this.drag = null;
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
            el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
    }
}
