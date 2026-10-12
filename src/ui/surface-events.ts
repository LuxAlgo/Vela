// Open/close announcements for the chart's chrome. Every kit surface (menu, popover —
// select lists and color pickers included — dialog, drawer) and the widget's own floating
// and docked chrome (side panels, the layout picker) dispatch one DOM event on their own
// element as they open and as they start to close, so a host can follow the chrome
// without watching the DOM. Close fires while the element is still attached (before a
// fade-out or removal), so it bubbles to the host like open does.

/** Dispatched on a surface's element once it is shown. */
export const SURFACE_OPEN_EVENT = 'vela:surface-open';
/** Dispatched on a surface's element as it starts to close, before it hides or leaves the DOM. */
export const SURFACE_CLOSE_EVENT = 'vela:surface-close';

/** What opened or closed: a menu (submenus included), a popover (select lists, color
 *  pickers, mark cards, the layout picker), a dialog, a drawer, or a side panel. */
export type SurfaceKind = 'menu' | 'popover' | 'dialog' | 'drawer' | 'panel';

/** The `detail` of a {@link SURFACE_OPEN_EVENT} / {@link SURFACE_CLOSE_EVENT} event. */
export interface SurfaceEventDetail {
    kind: SurfaceKind;
    /** The element that opened it, when there is one (a menu's button, a popover's trigger). */
    trigger: HTMLElement | null;
}

/** Announce that `el` opened or is closing. Bubbles and crosses shadow roots. */
export function announceSurface(el: HTMLElement, open: boolean, kind: SurfaceKind, trigger: HTMLElement | null = null): void {
    const View = el.ownerDocument.defaultView;
    if (!View) return;
    el.dispatchEvent(
        new View.CustomEvent<SurfaceEventDetail>(open ? SURFACE_OPEN_EVENT : SURFACE_CLOSE_EVENT, { bubbles: true, composed: true, detail: { kind, trigger } }),
    );
}
