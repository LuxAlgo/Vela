// Layout mode — the shell's size class. The widget is embeddable, so the honest
// signal is the CONTAINER width, not the viewport: a 380px widget on a desktop page
// gets the mobile chrome, a full-screen tablet widget keeps the desktop one unless
// the pointer is coarse and the container is narrow enough that desktop affordances
// (hover flyouts, 30px targets) stop working.
import type { Unsubscribe } from '../core/util/types';

export type LayoutMode = 'mobile' | 'desktop';
export type LayoutModeOption = 'auto' | LayoutMode;

/** Below this container width the shell is unconditionally mobile. */
export const MOBILE_BREAKPOINT_PX = 640;
/** With a coarse pointer (touch-first device) the mobile chrome applies wider —
 *  desktop affordances assume hover, which a coarse pointer does not have. */
export const COARSE_BREAKPOINT_PX = 920;

/**
 * Resolve the effective layout mode. Pure — the controller feeds it measurements.
 * An unmeasured container (width 0: display:none, not yet attached) stays desktop
 * until a real measurement arrives, so nothing flashes mobile during construction.
 */
export function resolveLayoutMode(option: LayoutModeOption, width: number, coarsePointer: boolean): LayoutMode {
    if (option !== 'auto') return option;
    if (width <= 0) return 'desktop';
    if (width < MOBILE_BREAKPOINT_PX) return 'mobile';
    if (coarsePointer && width < COARSE_BREAKPOINT_PX) return 'mobile';
    return 'desktop';
}

/**
 * Observes one element and keeps its `data-layout` attribute (`'mobile'`/`'desktop'`)
 * in sync with the resolved mode — chrome stylesheets key off it. Change listeners
 * fire only on actual transitions, after the attribute is already updated.
 */
export class LayoutModeController {
    private mode: LayoutMode;
    private readonly listeners = new Set<(mode: LayoutMode) => void>();
    private ro: ResizeObserver | null = null;
    private mql: MediaQueryList | null = null;
    private readonly onMediaChange = (): void => this.evaluate();

    constructor(
        private readonly el: HTMLElement,
        private readonly option: LayoutModeOption = 'auto',
    ) {
        const win = el.ownerDocument.defaultView;
        if (win && typeof win.matchMedia === 'function') {
            this.mql = win.matchMedia('(pointer: coarse)');
            // Older WebViews only ship addListener — fall back rather than throw.
            if (typeof this.mql.addEventListener === 'function') this.mql.addEventListener('change', this.onMediaChange);
        }
        this.mode = resolveLayoutMode(option, el.getBoundingClientRect().width, this.mql?.matches ?? false);
        el.dataset.layout = this.mode;
        if (option === 'auto' && win && typeof win.ResizeObserver === 'function') {
            this.ro = new win.ResizeObserver(() => this.evaluate());
            this.ro.observe(el);
        }
    }

    get current(): LayoutMode {
        return this.mode;
    }

    /** Subscribe to mode transitions (fires with the NEW mode). */
    onChange(cb: (mode: LayoutMode) => void): Unsubscribe {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    destroy(): void {
        this.ro?.disconnect();
        this.ro = null;
        if (this.mql && typeof this.mql.removeEventListener === 'function') this.mql.removeEventListener('change', this.onMediaChange);
        this.mql = null;
        this.listeners.clear();
    }

    private evaluate(): void {
        const next = resolveLayoutMode(this.option, this.el.getBoundingClientRect().width, this.mql?.matches ?? false);
        if (next === this.mode) return;
        this.mode = next;
        this.el.dataset.layout = next;
        for (const cb of [...this.listeners]) cb(next);
    }
}
