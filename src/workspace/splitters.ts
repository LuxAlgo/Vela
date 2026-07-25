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

/** What the layer needs from the workspace. */
export interface SplitterDeps {
    /** Current track weights per axis. */
    tracks(): { cols: number[]; rows: number[] };
    /** Commit new weights for one axis (the workspace re-applies the grid template). */
    apply(axis: 'cols' | 'rows', weights: number[]): void;
    /** Reset one axis to an even split (double-click). */
    reset(axis: 'cols' | 'rows'): void;
    /** The grid gap in px (strips center on the gaps). */
    gapPx(): number;
}

const HIT_PX = 8; // strip thickness (the visible seam is the grid gap; this is the grab target)

/**
 * Owns the divider strips over a grid container: one strip per internal column/row
 * boundary, repositioned via {@link trackOffsets} whenever `layout()` is called
 * (layout change, container resize, drag). Dragging trades weight between the two
 * neighboring tracks; double-click evens the axis out.
 */
export class SplitterLayer {
    private readonly strips: HTMLDivElement[] = [];
    private drag: { axis: 'cols' | 'rows'; index: number; startPx: number; startWeights: number[]; sizePx: number } | null = null;

    constructor(
        private readonly container: HTMLElement,
        private readonly deps: SplitterDeps,
    ) {}

    /** Rebuild + reposition the strips for the current tracks/size. */
    layout(): void {
        const { cols, rows } = this.deps.tracks();
        const rect = this.container.getBoundingClientRect();
        const gap = this.deps.gapPx();
        const wanted = Math.max(0, cols.length - 1) + Math.max(0, rows.length - 1);
        while (this.strips.length > wanted) this.strips.pop()!.remove();
        while (this.strips.length < wanted) this.strips.push(this.makeStrip());
        let k = 0;
        for (const [i, x] of trackOffsets(cols, rect.width, gap).entries()) {
            this.place(this.strips[k]!, 'cols', i, `left:${Math.round(x - HIT_PX / 2)}px;top:0;width:${HIT_PX}px;height:100%;cursor:col-resize;`);
            k += 1;
        }
        for (const [i, y] of trackOffsets(rows, rect.height, gap).entries()) {
            this.place(this.strips[k]!, 'rows', i, `left:0;top:${Math.round(y - HIT_PX / 2)}px;width:100%;height:${HIT_PX}px;cursor:row-resize;`);
            k += 1;
        }
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
