// A themed hover tooltip for RENDERER chrome (legend rows, the drawing toolbar, the
// in-chart dialogs) — the same look as the ui kit's Tooltip, without importing the kit:
// renderer chrome must work on a BARE chart, where no `.vela-ui` token host exists, so
// the tip carries its own tokens (`applyChromeTokens`) like the rest of the in-chart
// chrome. Native `title` tooltips are banned here for the same reason they are banned on
// the widget chrome: they look foreign and cannot be themed.
import type { VelaTheme } from '../../core/options';
import { iconAt } from '../../core/icons';
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
    /** `below` the anchor (legend rows), to its `right` (a vertical toolbar), or `above`
     *  (controls sitting on the bottom edge). Default below. */
    placement?: 'below' | 'right' | 'above';
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
            // Left-aligned, clamped so it never spills out of the host. `above` is for
            // anchors sitting on the bottom edge (the A/L scale buttons).
            const left = Math.min(a.left - h.left, Math.max(0, h.width - tip.offsetWidth - 4));
            tip.style.left = `${Math.max(0, left)}px`;
            tip.style.top = opts.placement === 'above'
                ? `${Math.max(0, a.top - h.top - tip.offsetHeight - 6)}px`
                : `${a.bottom - h.top + 6}px`;
        }
    };

    // Mouse only: a tap fires a SYNTHETIC mouseenter/pointerenter with no leave to
    // follow (the emulated cursor stays put), so a touch-armed tip would open after the
    // tap and stick around forever. pointerenter carries the pointer type; mouseenter
    // does not — which is why the mouse events are not used here.
    const arm = (e: PointerEvent): void => {
        if (e.pointerType !== 'mouse') return;
        clear();
        timer = window.setTimeout(show, opts.delayMs ?? 700);
    };

    anchor.addEventListener('pointerenter', arm);
    anchor.addEventListener('pointerleave', clear);
    anchor.addEventListener('pointerdown', clear); // a click answers the question the tip poses

    return () => {
        anchor.removeEventListener('pointerenter', arm);
        anchor.removeEventListener('pointerleave', clear);
        anchor.removeEventListener('pointerdown', clear);
        clear();
    };
}

export interface ChromeHintOptions {
    /** See {@link ChromeTooltipOptions.host}. */
    host: HTMLElement;
    /** See {@link ChromeTooltipOptions.theme}. */
    theme: () => VelaTheme;
    /** Badge diameter in px. Default 16. */
    size?: number;
}

/**
 * The ⓘ hint badge every in-chart dialog puts after a label: a round chip with the `info`
 * icon and a wrapped chrome tooltip that opens quickly (a hint is asked for, not stumbled
 * on). The glyph is an SVG, so it is centered in the badge regardless of the font. Styled
 * inline (renderer chrome carries no stylesheet); the hover state is the tip's own
 * pointer listeners. Returns the element and a disposer for the tooltip.
 */
export function chromeHint(text: string, opts: ChromeHintOptions): { el: HTMLElement; dispose: () => void } {
    const px = opts.size ?? 16;
    const el = document.createElement('span');
    el.className = 'vela-hint';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', text);
    el.innerHTML = iconAt('info', px);
    el.style.cssText =
        `flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;` +
        'border-radius:50%;cursor:help;user-select:none;background:var(--vela-hover);color:var(--vela-fg-muted);' +
        'transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;';
    const hover = (on: boolean): void => {
        el.style.background = on ? 'var(--vela-active)' : 'var(--vela-hover)';
        el.style.color = on ? 'var(--vela-fg-bright)' : 'var(--vela-fg-muted)';
    };
    el.addEventListener('pointerenter', () => hover(true));
    el.addEventListener('pointerleave', () => hover(false));
    const dispose = attachChromeTooltip(el, { host: opts.host, theme: opts.theme, text: () => text, wrap: true, delayMs: 250 });
    return { el, dispose };
}
