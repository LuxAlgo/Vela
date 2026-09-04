// Browser-owned reduced-motion preference. The resolver stays in core/options; this
// adapter is deliberately presentation-side because matchMedia is a DOM capability.
import type { Unsubscribe } from '../../core/util/types';

const MOTION_STYLE_ID = 'vela-reduced-motion';
const MOTION_CSS = `
[data-vela-motion='reduced'],
[data-vela-motion='reduced'] *,
[data-vela-motion='reduced'] *::before,
[data-vela-motion='reduced'] *::after {
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
}
`;

/** Install the scoped CSS gate in the host root and its document portal root. */
export function ensureMotionStyles(host: HTMLElement): void {
    if (typeof host.getRootNode !== 'function') return; // lightweight injected/test hosts
    const doc = host.ownerDocument;
    const root = host.getRootNode() as Document | ShadowRoot;
    const install = (target: Document | ShadowRoot): void => {
        if (target.querySelector(`#${MOTION_STYLE_ID}`)) return;
        const style = doc.createElement('style');
        style.id = MOTION_STYLE_ID;
        style.textContent = MOTION_CSS;
        (target === doc ? doc.head : target).appendChild(style);
    };
    install(root);
    // Kit popovers default to document.body. A trigger inside a ShadowRoot therefore
    // needs the same scoped rule in the document tree that owns its portaled surface.
    if (root !== doc) install(doc);
}

/** Apply the effective policy to presentation roots portaled outside the chart tree. */
export function applyMotionScope(host: HTMLElement, reduced: boolean, ...roots: HTMLElement[]): void {
    ensureMotionStyles(host);
    const value = reduced ? 'reduced' : 'full';
    for (const root of roots) root.dataset.velaMotion = value;
}

export interface MotionPreferenceSource {
    readonly reduced: boolean;
    onChange(cb: (reduced: boolean) => void): Unsubscribe;
}

/** One live `prefers-reduced-motion` observation, shareable by every chart in a
 * workspace. Standalone charts own one themselves. */
export class MotionPreferenceController implements MotionPreferenceSource {
    private readonly listeners = new Set<(reduced: boolean) => void>();
    private mql: MediaQueryList | null = null;
    private current = false;
    private legacy = false;
    private readonly onMediaChange = (event: MediaQueryListEvent): void => this.update(event.matches);

    constructor(host: HTMLElement, observe = true) {
        ensureMotionStyles(host);
        const win = host.ownerDocument?.defaultView;
        if (!observe || !win || typeof win.matchMedia !== 'function') return;
        this.mql = win.matchMedia('(prefers-reduced-motion: reduce)');
        this.current = this.mql.matches;
        if (typeof this.mql.addEventListener === 'function') this.mql.addEventListener('change', this.onMediaChange);
        else if (typeof this.mql.addListener === 'function') {
            this.legacy = true;
            this.mql.addListener(this.onMediaChange);
        }
    }

    get reduced(): boolean {
        return this.current;
    }

    onChange(cb: (reduced: boolean) => void): Unsubscribe {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    destroy(): void {
        if (this.mql) {
            if (this.legacy && typeof this.mql.removeListener === 'function') this.mql.removeListener(this.onMediaChange);
            else if (typeof this.mql.removeEventListener === 'function') this.mql.removeEventListener('change', this.onMediaChange);
        }
        this.mql = null;
        this.listeners.clear();
    }

    private update(reduced: boolean): void {
        if (reduced === this.current) return;
        this.current = reduced;
        for (const cb of [...this.listeners]) cb(reduced);
    }
}
