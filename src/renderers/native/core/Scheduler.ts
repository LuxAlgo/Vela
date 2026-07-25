/**
 * Invalidation level — higher levels subsume lower ones within a frame.
 *  - None:   nothing to redraw.
 *  - Cursor: only the crosshair/overlay moved (cheapest; viewport unchanged).
 *  - Chrome: only the chrome layer's content moved (the countdown chip's wall-clock
 *            tick) — repaint chrome + crosshair over the frame's existing scales;
 *            the geometry/volume/VPVR/SDK layers stay untouched.
 *  - Light:  data unchanged but a value/style changed; repaint data + chrome.
 *  - Full:   viewport/layout/data changed; repaint everything.
 *
 * Invariant enforced by callers: any ViewportState change must invalidate at
 * Light or Full (never Cursor/Chrome) so data and chrome repaint in the SAME frame.
 */
export enum InvalidateLevel {
    None = 0,
    Cursor = 1,
    Chrome = 2,
    Light = 3,
    Full = 4,
}

/**
 * Whether a frame at this level must repaint the DATA layer (series/fills/
 * drawings/axes/grid). `Cursor` repaints only the crosshair overlay and `Chrome`
 * only the chrome canvas; `Light`/`Full` repaint the data layer too. The crosshair
 * overlay is repainted on every frame regardless (it's cheap and must stay aligned
 * after a pan/zoom).
 */
export function repaintsData(level: InvalidateLevel): boolean {
    return level >= InvalidateLevel.Light;
}

/** Whether a frame at this level must repaint the CHROME layer (axes, Pine drawings,
 *  price line + countdown chips). Data-tier frames repaint chrome too (paintData). */
export function repaintsChrome(level: InvalidateLevel): boolean {
    return level >= InvalidateLevel.Chrome;
}

type FrameFn = (level: InvalidateLevel) => void;
type RafScheduler = (cb: () => void) => number;
type RafCanceller = (handle: number) => void;

/**
 * A re-armable single-rAF scheduler: many `invalidate()` calls within a frame
 * coalesce into one repaint at the highest requested level. Static charts cost
 * zero idle frames (no rAF is armed when nothing is invalid).
 */
export class Scheduler {
    private level = InvalidateLevel.None;
    private handle: number | null = null;
    private readonly raf: RafScheduler;
    private readonly cancel: RafCanceller;

    constructor(
        private readonly onFrame: FrameFn,
        raf?: RafScheduler,
        cancel?: RafCanceller,
    ) {
        this.raf = raf ?? ((cb) => requestAnimationFrame(cb));
        this.cancel = cancel ?? ((h) => cancelAnimationFrame(h));
    }

    invalidate(level: InvalidateLevel): void {
        if (level <= InvalidateLevel.None) return;
        if (level > this.level) this.level = level;
        if (this.handle === null) this.handle = this.raf(() => this.flush());
    }

    /** Force a synchronous repaint now (used by resize so layout is immediate). */
    flushNow(level: InvalidateLevel): void {
        if (this.handle !== null) {
            this.cancel(this.handle);
            this.handle = null;
        }
        if (level > this.level) this.level = level;
        this.flush();
    }

    private flush(): void {
        this.handle = null;
        const level = this.level;
        this.level = InvalidateLevel.None;
        if (level !== InvalidateLevel.None) this.onFrame(level);
    }

    destroy(): void {
        if (this.handle !== null) {
            this.cancel(this.handle);
            this.handle = null;
        }
        this.level = InvalidateLevel.None;
    }
}
