// Keyboard zoom/pan glide — the reference's eased "follow" animation toward a target
// visible range (pure math ported from the reference shortcuts core + a small rAF driver).
import type { Vela } from '../Vela';

const MIN_SPAN_MS = 60_000;
const FOLLOW = 0.25;
export const ZOOM_IN = 0.8;
export const ZOOM_OUT = 1.25;
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

/** fraction > 0 pans toward the latest bars; < 0 toward history. */
export function panTarget(base: Range, fraction: number): Range {
    const delta = (base.to - base.from) * fraction;
    return { from: base.from + delta, to: base.to + delta };
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
    private target: Range | null = null;
    private raf = 0;

    constructor(private readonly chart: () => Vela | null) {}

    zoom(factor: number): void {
        this.to((base) => zoomTarget(base, factor));
    }

    pan(fraction: number): void {
        this.to((base) => panTarget(base, fraction));
    }

    stop(): void {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.target = null;
    }

    private to(make: (base: Range) => Range): void {
        const chart = this.chart();
        const base = this.target ?? chart?.getVisibleRange();
        if (!chart || !base) return;
        this.target = make(base);
        if (!this.raf) this.tick();
    }

    private tick(): void {
        this.raf = requestAnimationFrame(() => {
            const chart = this.chart();
            const cur = chart?.getVisibleRange();
            if (!chart || !cur || !this.target) {
                this.stop();
                return;
            }
            const { cur: next, done } = followStep(cur, this.target);
            chart.setVisibleRange(next);
            if (done) this.stop();
            else this.tick();
        });
    }
}
