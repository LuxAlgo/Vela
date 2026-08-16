// Popover CONTROLLER — placement math only. No DOM: the view measures rects and
// the vanilla (or a future React) projection applies the returned coordinates.

export type PopoverAlign = 'start' | 'end';
export type PopoverPosition = 'fixed' | 'absolute';

/** Axis-aligned rectangle in viewport coordinates. */
export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface PlaceArgs {
    trigger: Rect;
    pop: { width: number; height: number };
    gap: number;
    align: PopoverAlign;
    /** Already-inset clamp rectangle in viewport coordinates. */
    clamp: Rect;
    /** Subtracted from left/top when the popover is `position:absolute` inside a host. */
    originX: number;
    originY: number;
}

export interface PlaceResult {
    left: number;
    top: number;
}

/** Inset a rectangle uniformly (positive inset shrinks). */
export function insetRect(r: Rect, inset: number): Rect {
    return {
        left: r.left + inset,
        top: r.top + inset,
        right: r.right - inset,
        bottom: r.bottom - inset,
        width: r.width - inset * 2,
        height: r.height - inset * 2,
    };
}

/** Viewport rect with a uniform inset (the 6px air ColorField / glyph-select used). */
export function viewportRect(width: number, height: number, inset: number): Rect {
    return {
        left: inset,
        top: inset,
        right: width - inset,
        bottom: height - inset,
        width: width - inset * 2,
        height: height - inset * 2,
    };
}

/** Intersection of two rects. Empty (non-positive size) if they don't overlap. */
export function intersectRects(a: Rect, b: Rect): Rect {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Place a popover under `trigger`, flipping above when it would leave `clamp`.
 * Prefers the side with more room when neither fully fits. `align: 'end'` right-aligns
 * to the trigger (swatches and width fields sit at the row's right edge).
 */
export function placePopover(a: PlaceArgs): PlaceResult {
    let left = a.align === 'end' ? a.trigger.right - a.pop.width : a.trigger.left;
    const below = a.trigger.bottom + a.gap;
    const above = a.trigger.top - a.pop.height - a.gap;
    const fitsBelow = below + a.pop.height <= a.clamp.bottom;
    const fitsAbove = above >= a.clamp.top;
    let top = below;
    if (!fitsBelow && (fitsAbove || a.trigger.top - a.clamp.top > a.clamp.bottom - a.trigger.bottom)) {
        top = Math.max(a.clamp.top, above);
    }
    if (left + a.pop.width > a.clamp.right) left = a.clamp.right - a.pop.width;
    if (left < a.clamp.left) left = a.clamp.left;
    if (top + a.pop.height > a.clamp.bottom) top = a.clamp.bottom - a.pop.height;
    if (top < a.clamp.top) top = a.clamp.top;
    return {
        left: Math.round(left - a.originX),
        top: Math.round(top - a.originY),
    };
}

export interface PopoverControllerOptions {
    gap?: number;
    align?: PopoverAlign;
    matchWidth?: boolean;
    position?: PopoverPosition;
    boundaryInset?: number;
    viewportInset?: number;
    onClose?: () => void;
}

export interface PopoverController {
    gap: number;
    align: PopoverAlign;
    matchWidth: boolean;
    position: PopoverPosition;
    boundaryInset: number;
    viewportInset: number;
    onClose?: () => void;
}

export function popoverController(opts: PopoverControllerOptions = {}): PopoverController {
    return {
        gap: opts.gap ?? 4,
        align: opts.align ?? 'start',
        matchWidth: opts.matchWidth ?? false,
        position: opts.position ?? 'fixed',
        boundaryInset: opts.boundaryInset ?? 0,
        viewportInset: opts.viewportInset ?? 6,
        onClose: opts.onClose,
    };
}
