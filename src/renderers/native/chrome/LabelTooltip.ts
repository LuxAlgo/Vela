// Hover tooltips for Pine labels (`label.new(..., tooltip=...)`). Labels are canvas
// pixels, not DOM anchors, so the chrome-tooltip helper doesn't apply: this tracks the
// pointer on the plot, hit-tests the label rects the chrome layer collected while
// painting, and shows a themed tip near the cursor after a short hover. The tip carries
// its own tokens (like the rest of the in-chart chrome) so it works on a bare chart.
import type { VelaTheme } from '../../../core/options';
import { applyChromeTokens } from '../../shared/theme-tokens';

export interface LabelTooltipDeps {
    /** Live theme — read at open time, so a theme switch never shows a stale tip. */
    theme: () => VelaTheme;
    /** Tooltip text under a plot-space point (the chrome layer's label hit-rects). */
    lookup: (x: number, y: number) => string | null;
}

const HOVER_DELAY_MS = 350;

export class LabelTooltip {
    private tip: HTMLElement | null = null;
    private timer: number | null = null;
    /** Text of the currently open OR armed tip — dedupes moves inside one label. */
    private current: string | null = null;

    constructor(
        private readonly plot: HTMLElement,
        private readonly deps: LabelTooltipDeps,
    ) {
        plot.addEventListener('pointermove', this.onMove);
        plot.addEventListener('pointerleave', this.onLeave);
        plot.addEventListener('pointerdown', this.onLeave);
    }

    destroy(): void {
        this.plot.removeEventListener('pointermove', this.onMove);
        this.plot.removeEventListener('pointerleave', this.onLeave);
        this.plot.removeEventListener('pointerdown', this.onLeave);
        this.clear();
    }

    private readonly onMove = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return; // a tap has no hover to follow (see chrome-tooltip)
        const rect = this.plot.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const text = this.deps.lookup(x, y);
        if (!text) {
            this.clear();
            return;
        }
        if (text === this.current) return; // still inside the same label
        this.clear();
        this.current = text;
        this.timer = window.setTimeout(() => this.show(text, x, y), HOVER_DELAY_MS);
    };

    private readonly onLeave = (): void => {
        this.clear();
    };

    private show(text: string, x: number, y: number): void {
        const doc = this.plot.ownerDocument;
        const tip = doc.createElement('div');
        tip.textContent = text;
        tip.style.cssText =
            'position:absolute;z-index:var(--vela-z-tooltip);pointer-events:none;' +
            'background:var(--vela-bg);border:1px solid var(--vela-border);color:var(--vela-fg);' +
            'border-radius:var(--vela-radius-md);padding:4px 9px;box-shadow:var(--vela-shadow);' +
            'font:var(--vela-font-size-md) var(--vela-font);max-width:260px;';
        applyChromeTokens(tip, this.deps.theme());
        this.plot.appendChild(tip);
        // Below-right of the cursor, clamped so the tip never spills out of the plot.
        const pw = this.plot.clientWidth;
        const ph = this.plot.clientHeight;
        tip.style.left = `${Math.max(0, Math.min(x + 12, pw - tip.offsetWidth - 4))}px`;
        tip.style.top = `${Math.max(0, Math.min(y + 16, ph - tip.offsetHeight - 4))}px`;
        this.tip = tip;
    }

    private clear(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.tip?.remove();
        this.tip = null;
        this.current = null;
    }
}
