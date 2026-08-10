// The docked side-panel shell: a column on the chart's right edge with a titled header, a close
// button, and a scrolling body. Closed by default — a topbar button toggles it, and because the
// shell is a flex SIBLING of the chart (not an overlay) opening it shrinks the chart. The object
// tree and the data window are built on it, and contributed panels (`registerSidePanel`) get the
// same shell from the dock, so every panel in the column looks and behaves alike.
//
// Width is a per-panel choice: fixed by default, or `resizable` — a drag handle on the panel's
// inner edge, clamped to [minWidth, maxWidth], double-click back to the declared width.
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';

const STYLE_ID = 'vela-widget-sidepanel';

/** Width (px) a panel takes when it declares none. */
export const DEFAULT_PANEL_WIDTH = 280;
/** Bounds a RESIZABLE panel takes when it declares none. */
export const DEFAULT_PANEL_MIN_WIDTH = 200;
export const DEFAULT_PANEL_MAX_WIDTH = 640;

const CSS = `
.vela-panel[hidden] { display: none !important; }
.vela-panel {
    position: relative;
    width: var(--vela-panel-w, ${DEFAULT_PANEL_WIDTH}px);
    flex: none;
    border-left: 1px solid var(--vela-border);
    display: flex;
    flex-direction: column;
    color: var(--vela-fg);
    font-size: 13px;
    box-sizing: border-box;
    background: var(--vela-bg);
}
.vela-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px 10px 14px;
    border-bottom: 1px solid var(--vela-border);
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
}
.vela-panel-title { flex: none; }
.vela-panel-title:empty { display: none; }
/* The contributed slot claims the space between title and close; its children lay out
   inline and the close button stays pinned right. */
.vela-panel-header-slot { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 6px; }
.vela-panel-close {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 16px;
}
.vela-panel-close .vela-icon { width: 16px; height: 16px; }
.vela-panel-close:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-panel-body { flex: 1; overflow: auto; padding: 8px; }
.vela-panel-body::-webkit-scrollbar { width: 8px; }
.vela-panel-body::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
/* Straddles the panel's inner border so the whole seam is grabbable; it paints only under the
   pointer — a permanently visible bar would read as a second border. */
.vela-panel-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    width: 7px;
    cursor: col-resize;
    touch-action: none;
    z-index: 1;
}
.vela-panel-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
}
.vela-panel-resizer:hover::after,
.vela-panel-resizer[data-dragging]::after { background: var(--vela-accent); }
/* Mobile: a 280px column would crush a phone-width chart — the panel overlays the
   chart area instead (its flex parent is position:relative), full-bleed, closed by
   the same header ✕. Width dragging is a pointer affordance; off on mobile. */
[data-layout='mobile'] .vela-panel {
    position: absolute;
    inset: 0;
    width: auto;
    z-index: 25;
    border-left: none;
}
[data-layout='mobile'] .vela-panel-resizer { display: none; }
`;

/** Per-panel width policy. Omitted fields fall back to the module defaults. */
export interface SidePanelOptions {
    /** Declared width in px — also where a double-click on the drag handle returns. */
    width?: number;
    /** Let the user drag the panel's inner edge. Fixed width when false/omitted. */
    resizable?: boolean;
    minWidth?: number;
    maxWidth?: number;
}

/**
 * Clamp a width to its bounds and round to whole pixels — PURE. The drag, a programmatic
 * {@link SidePanel.setWidth}, and the restore of a persisted width all go through it, so a bad
 * stored value (or a `maxWidth` below `minWidth`) can never paint an unusable column.
 */
export function clampPanelWidth(px: number, min = DEFAULT_PANEL_MIN_WIDTH, max = DEFAULT_PANEL_MAX_WIDTH): number {
    const lo = Number.isFinite(min) && min > 0 ? min : DEFAULT_PANEL_MIN_WIDTH;
    // An infinite max is "no upper bound" (a fixed panel); a finite one below the min is a
    // caller's mistake — the min wins rather than collapsing the range.
    const hi = Number.isFinite(max) ? Math.max(max, lo) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(px)) return lo;
    return Math.round(Math.min(Math.max(px, lo), hi));
}

export class SidePanel {
    readonly el: HTMLElement;
    /**
     * Notified whenever the panel opens or closes, by ANY path — a topbar toggle, the header ✕,
     * or another panel taking the dock. The owning shell reflects it on its chrome, so a button's
     * pressed state can never drift from the panel it controls.
     */
    onOpenChange: ((open: boolean) => void) | null = null;
    /** Notified when the USER settles a new width (drag release, or double-click reset) — never on
     *  a programmatic {@link setWidth}, so restoring a persisted width raises no change. */
    onWidthChange: ((px: number) => void) | null = null;
    protected readonly body: HTMLElement;
    private readonly heading: HTMLElement;
    private readonly slot: HTMLElement;
    private readonly declaredWidth: number;
    private readonly minWidth: number;
    private readonly maxWidth: number;
    private widthPx: number;

    /** `modifier` is the panel's own class, carrying its content styles (e.g. `vela-ot`). */
    constructor(host: HTMLElement, title: string, modifier: string, opts: SidePanelOptions = {}) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        // A FIXED panel is its own bound — the resize bounds would otherwise silently rewrite a
        // declared width a host set from code (or restored) outside the resizable defaults.
        this.minWidth = opts.resizable ? (opts.minWidth ?? DEFAULT_PANEL_MIN_WIDTH) : 1;
        this.maxWidth = opts.resizable ? (opts.maxWidth ?? DEFAULT_PANEL_MAX_WIDTH) : Number.POSITIVE_INFINITY;
        this.declaredWidth = clampPanelWidth(opts.width ?? DEFAULT_PANEL_WIDTH, this.minWidth, this.maxWidth);
        this.widthPx = this.declaredWidth;
        this.el = doc.createElement('div');
        this.el.className = `vela-panel ${modifier}`;
        this.el.hidden = true;
        this.el.style.setProperty('--vela-panel-w', `${this.widthPx}px`);
        const header = doc.createElement('div');
        header.className = 'vela-panel-header';
        this.heading = doc.createElement('span');
        this.heading.className = 'vela-panel-title';
        this.heading.textContent = title;
        // The header SLOT — the space between the title and the close button, handed to a
        // contributed panel's `mount` so it can dock its own compact controls there
        // (script name, action icons) instead of spending a toolbar row on them.
        this.slot = doc.createElement('div');
        this.slot.className = 'vela-panel-header-slot';
        const close = doc.createElement('button');
        close.className = 'vela-panel-close';
        close.appendChild(iconEl('close', doc));
        close.title = 'Close';
        close.addEventListener('click', () => this.toggle(false));
        header.append(this.heading, this.slot, close);
        this.body = doc.createElement('div');
        this.body.className = 'vela-panel-body';
        this.el.append(header, this.body);
        if (opts.resizable) this.mountResizer(doc);
        host.appendChild(this.el);
    }

    get open(): boolean {
        return !this.el.hidden;
    }

    /** Open/close the panel — a bare call flips it. */
    toggle(open = this.el.hidden): void {
        if (open === !this.el.hidden) return;
        this.el.hidden = !open;
        this.onOpenChange?.(open);
    }

    /** The scrolling body, for a panel filled from OUTSIDE the class — a contributed panel's
     *  `mount` receives exactly this element. Subclasses use the protected `body`. */
    get content(): HTMLElement {
        return this.body;
    }

    /** The header slot between the title and the close button — a contributed panel's
     *  `mount` receives it (via {@link SidePanelHeader}) to dock compact controls. */
    get headerSlot(): HTMLElement {
        return this.slot;
    }

    /** Replace the header title. The topbar toggle keeps the DECLARED title as its
     *  tooltip — this only changes what the open column says about itself. */
    setTitle(title: string): void {
        this.heading.textContent = title;
    }

    /** Current width in px. */
    get width(): number {
        return this.widthPx;
    }

    /** Resize the panel (clamped). Silent — {@link onWidthChange} reports user drags only. */
    setWidth(px: number): void {
        const next = clampPanelWidth(px, this.minWidth, this.maxWidth);
        if (next === this.widthPx) return;
        this.widthPx = next;
        this.el.style.setProperty('--vela-panel-w', `${next}px`);
    }

    destroy(): void {
        this.el.remove();
    }

    /** The drag handle on the panel's inner (left) edge — the panel is docked right, so dragging
     *  AWAY from the edge widens it. Pointer capture keeps the drag alive over the chart canvas. */
    private mountResizer(doc: Document): void {
        const handle = doc.createElement('div');
        handle.className = 'vela-panel-resizer';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        let startX = 0;
        let startWidth = 0;
        let dragging = false;

        const end = (e: PointerEvent): void => {
            if (!dragging) return;
            dragging = false;
            delete handle.dataset.dragging;
            handle.releasePointerCapture(e.pointerId);
            if (this.widthPx !== startWidth) this.onWidthChange?.(this.widthPx);
        };

        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startWidth = this.widthPx;
            handle.dataset.dragging = '1';
            handle.setPointerCapture(e.pointerId);
            e.preventDefault(); // no text selection, and no drag starting on the chart underneath
        });
        handle.addEventListener('pointermove', (e: PointerEvent) => {
            if (!dragging) return;
            this.setWidth(startWidth + (startX - e.clientX));
            e.preventDefault();
        });
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        handle.addEventListener('dblclick', () => {
            const before = this.widthPx;
            this.setWidth(this.declaredWidth);
            if (this.widthPx !== before) this.onWidthChange?.(this.widthPx);
        });
        this.el.appendChild(handle);
    }
}
