// A themed hover tooltip for RENDERER chrome (legend rows, the drawing toolbar, the
// in-chart dialogs) — the same look as the ui kit's Tooltip, without importing the kit:
// renderer chrome must work on a BARE chart, where no `.vela-ui` token host exists, so
// the tip carries its own tokens (`applyChromeTokens`) like the rest of the in-chart
// chrome. Native `title` tooltips are banned here for the same reason they are banned on
// the widget chrome: they look foreign and cannot be themed.
import type { VelaTheme } from '../../core/options';
import { applyChromeTokens } from './theme-tokens';

export interface ChromeTooltipOptions {
    /** Positioned container the tip mounts into (the chart plot, the toolbar host…). */
    host: HTMLElement;
    /** Live theme — read at OPEN time, so a theme switch never shows a stale tip. */
    theme: () => VelaTheme;
    /** Tip text — read at OPEN time (dynamic labels: Hide/Show). Empty ⇒ no tip. */
    text: () => string;
    /** Hover delay before the tip opens. Default 700 ms. */
    delayMs?: number;
    /** `below` the anchor (legend rows) or to its `right` (a vertical toolbar). Default below. */
    placement?: 'below' | 'right';
    /** Allow wrapping (long texts, e.g. an input's docs). Default false — one line. */
    wrap?: boolean;
}

/**
 * Attach the tooltip to an anchor. Returns a disposer that removes the listeners AND any
 * open tip — call it when the anchor's row/dialog is torn down, or a tip visible at that
 * exact moment would outlive its anchor.
 */
export function attachChromeTooltip(anchor: HTMLElement, opts: ChromeTooltipOptions): () => void {
    let timer: number | null = null;
    let tip: HTMLElement | null = null;

    const clear = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        tip?.remove();
        tip = null;
    };

    const show = (): void => {
        const text = opts.text();
        if (!text) return;
        const doc = anchor.ownerDocument;
        tip = doc.createElement('div');
        tip.textContent = text;
        // The tooltip layer token (60) keeps tips above the in-chart dialogs (40) — the
        // settings dialog's own control tips used to open BEHIND its card at a fixed 25.
        tip.style.cssText =
            'position:absolute;z-index:var(--vela-z-tooltip);pointer-events:none;' +
            'background:var(--vela-bg);border:1px solid var(--vela-border);color:var(--vela-fg);' +
            'border-radius:var(--vela-radius-md);padding:4px 9px;box-shadow:var(--vela-shadow);' +
            'font:var(--vela-font-size-md) var(--vela-font);' +
            (opts.wrap ? 'max-width:260px;' : 'white-space:nowrap;');
        applyChromeTokens(tip, opts.theme());
        opts.host.appendChild(tip);

        const a = anchor.getBoundingClientRect();
        const h = opts.host.getBoundingClientRect();
        if (opts.placement === 'right') {
            tip.style.left = `${a.right - h.left + 8}px`;
            tip.style.top = `${a.top - h.top + (a.height - tip.offsetHeight) / 2}px`;
        } else {
            // Below the anchor, left-aligned, clamped so it never spills out of the host.
            const left = Math.min(a.left - h.left, Math.max(0, h.width - tip.offsetWidth - 4));
            tip.style.left = `${Math.max(0, left)}px`;
            tip.style.top = `${a.bottom - h.top + 6}px`;
        }
    };

    const arm = (): void => {
        clear();
        timer = window.setTimeout(show, opts.delayMs ?? 700);
    };

    anchor.addEventListener('mouseenter', arm);
    anchor.addEventListener('mouseleave', clear);
    anchor.addEventListener('pointerdown', clear); // a click answers the question the tip poses

    return () => {
        anchor.removeEventListener('mouseenter', arm);
        anchor.removeEventListener('mouseleave', clear);
        anchor.removeEventListener('pointerdown', clear);
        clear();
    };
}
