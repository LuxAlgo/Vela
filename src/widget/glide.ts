// Keyboard zoom glide — the reference's eased "follow" animation toward a target
// visible range (pure math ported from the reference shortcuts core + a small rAF
// driver). Keyboard PAN doesn't glide here: it goes through `chart.panBy`, the
// renderer's drag-equivalent scroll (same clamp and easing as a pointer drag).
import type { Vela } from '../Vela';

const MIN_SPAN_MS = 60_000;
const FOLLOW = 0.25;
export const ZOOM_IN = 0.8;
export const ZOOM_OUT = 1.25;
/** Fraction of the visible width one pan key-press scrolls (fed to `chart.panBy`). */
export const PAN_FAST = 0.2;

export interface Range {
    from: number;
    to: number;
}

/** Right-anchored zoom target (like the renderer's wheel default). */
export function zoomTarget(base: Range, factor: number): Range {
    const newSpan = Math.max(MIN_SPAN_MS, (base.to - base.from) * factor);
    return { from: base.to - newSpan, to: base.to };
}

/** One easing step toward `target`; snaps when both edges are within ~0.15% of the span. */
export function followStep(cur: Range, target: Range, follow = FOLLOW, epsFrac = 0.0015): { cur: Range; done: boolean } {
    const eps = Math.max(MIN_SPAN_MS, (target.to - target.from) * epsFrac);
    const nf = cur.from + (target.from - cur.from) * follow;
    const nt = cur.to + (target.to - cur.to) * follow;
    const done = Math.abs(target.from - nf) <= eps && Math.abs(target.to - nt) <= eps;
    return { cur: done ? { ...target } : { from: nf, to: nt }, done };
}

/** Drives eased range changes on a chart; repeated calls retarget the running glide. */
export class Glider {
    // The glide eases ITS OWN range, never the chart's read-back: getVisibleRange()
    // is data-bounded (whole bars, `to` capped at the newest bar) and the renderer
    // clamps what gets applied — chasing that read-back can never converge on a
    // clamped step, leaving the rAF loop re-applying a stale target forever (and
    // grinding the span down when panning past the newest bar). The internal range
    // converges geometrically, so the glide always terminates; the renderer is free
    // to clamp each applied frame.
    private cur: Range | null = null;
    private target: Range | null = null;
    private raf = 0;

    constructor(private readonly chart: () => Vela | null) {}

    zoom(factor: number): void {
        this.to((base) => zoomTarget(base, factor));
    }

    stop(): void {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.cur = null;
        this.target = null;
    }

    private to(make: (base: Range) => Range): void {
        const chart = this.chart();
        const base = this.target ?? chart?.getVisibleRange();
        if (!chart || !base) return;
        this.cur ??= { ...base }; // seed from the chart on a fresh glide; keep it while retargeting
        this.target = make(base);
        if (chart.reducedMotion) {
            chart.setVisibleRange(this.target);
            this.stop();
            return;
        }
        if (!this.raf) this.tick();
    }

    private tick(): void {
        this.raf = requestAnimationFrame(() => {
            const chart = this.chart();
            if (!chart || !this.cur || !this.target) {
                this.stop();
                return;
            }
            if (chart.reducedMotion) {
                chart.setVisibleRange(this.target);
                this.stop();
                return;
            }
            const { cur: next, done } = followStep(this.cur, this.target);
            this.cur = next;
            chart.setVisibleRange(next);
            if (done) this.stop();
            else this.tick();
        });
    }
}
