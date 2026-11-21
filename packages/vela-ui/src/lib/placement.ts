// Where a floating part opens beside its trigger, in shadcn's words: the side it opens on, its
// alignment along that side, the two offsets, and how it keeps inside its collision area. The
// popover family places itself with these (`placePopover`); the parts positioned by Zag (menu,
// tooltip) map them onto Zag's positioning.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';
/** The area a floating part stays inside: the viewport, an element, or a rectangle read at
 *  each placement. */
export type CollisionBoundary = 'viewport' | HTMLElement | (() => DOMRect | null);

export interface PlacementProps {
    /** The side of the trigger it opens on. With `avoidCollisions`, it flips to the opposite
     *  side when this one lacks room. */
    side?: Side;
    /** Its alignment along that side. */
    align?: Align;
    /** Its distance from the trigger, in px. */
    sideOffset?: number;
    /** A shift along the side, in px, away from the aligned edge (toward the middle for
     *  `start` and `end`). */
    alignOffset?: number;
    /** Flip to the opposite side when there is no room, and stay inside the collision area
     *  (default true). */
    avoidCollisions?: boolean;
    /** Room kept from the collision area's edges, in px. */
    collisionPadding?: number;
    /** The area it stays inside (default: the viewport). */
    collisionBoundary?: CollisionBoundary;
}

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
    /** The distance from the trigger (shadcn's `sideOffset`). */
    gap: number;
    align: Align;
    /** Default `'bottom'`. */
    side?: Side;
    alignOffset?: number;
    /** Flip to the opposite side and stay inside `clamp` (default true). */
    avoidCollisions?: boolean;
    /** Already-inset clamp rectangle in viewport coordinates. */
    clamp: Rect;
    /** Subtracted from left/top when the popover is `position:absolute` inside a host. */
    originX: number;
    originY: number;
}

export interface PlaceResult {
    left: number;
    top: number;
    /** The side it opened on, after any flip. */
    side: Side;
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
 * Place a popover on `side` of `trigger` (default below), flipping to the opposite side when
 * it would leave `clamp` and preferring the side with more room when neither fully fits,
 * then keeping it inside `clamp`. `align: 'end'` lines it up with the trigger's far edge
 * (swatches and width fields sit at the row's right edge); `'center'` centers it on the
 * trigger (a popup over a small glyph). `avoidCollisions: false` keeps the side and skips
 * the clamp.
 */
export function placePopover(a: PlaceArgs): PlaceResult {
    const side = a.side ?? 'bottom';
    const avoid = a.avoidCollisions ?? true;
    const shift = a.alignOffset ?? 0;
    // Main axis: across the side it opens on; cross axis: along that side.
    const vertical = side === 'top' || side === 'bottom';
    const t = vertical
        ? { start: a.trigger.top, end: a.trigger.bottom, crossStart: a.trigger.left, crossEnd: a.trigger.right, crossSize: a.trigger.width }
        : { start: a.trigger.left, end: a.trigger.right, crossStart: a.trigger.top, crossEnd: a.trigger.bottom, crossSize: a.trigger.height };
    const size = vertical ? a.pop.height : a.pop.width;
    const crossSize = vertical ? a.pop.width : a.pop.height;
    const clamp = vertical
        ? { start: a.clamp.top, end: a.clamp.bottom, crossStart: a.clamp.left, crossEnd: a.clamp.right }
        : { start: a.clamp.left, end: a.clamp.right, crossStart: a.clamp.top, crossEnd: a.clamp.bottom };

    let cross = a.align === 'end' ? t.crossEnd - crossSize - shift : a.align === 'center' ? t.crossStart + t.crossSize / 2 - crossSize / 2 + shift : t.crossStart + shift;
    const after = t.end + a.gap;
    const before = t.start - size - a.gap;
    let useAfter = side === 'bottom' || side === 'right';
    if (avoid) {
        const fitsAfter = after + size <= clamp.end;
        const fitsBefore = before >= clamp.start;
        const roomBefore = t.start - clamp.start;
        const roomAfter = clamp.end - t.end;
        if (useAfter && !fitsAfter && (fitsBefore || roomBefore > roomAfter)) useAfter = false;
        else if (!useAfter && !fitsBefore && (fitsAfter || roomAfter > roomBefore)) useAfter = true;
    }
    let main = useAfter ? after : before;
    if (avoid) {
        if (cross + crossSize > clamp.crossEnd) cross = clamp.crossEnd - crossSize;
        if (cross < clamp.crossStart) cross = clamp.crossStart;
        if (main + size > clamp.end) main = clamp.end - size;
        if (main < clamp.start) main = clamp.start;
    }
    const left = vertical ? cross : main;
    const top = vertical ? main : cross;
    return {
        left: Math.round(left - a.originX),
        top: Math.round(top - a.originY),
        side: vertical ? (useAfter ? 'bottom' : 'top') : useAfter ? 'right' : 'left',
    };
}

type ZagPlacement = Side | `${Side}-start` | `${Side}-end`;

/** A Zag placement string (`'bottom-start'`) as a side and an alignment. */
export function splitPlacement(placement: string): { side: Side; align: Align } {
    const [side, align] = placement.split('-') as [Side, 'start' | 'end' | undefined];
    return { side, align: align ?? 'center' };
}

/**
 * Zag's positioning for `props`, over the part's own default side and alignment. Only what
 * the caller set is passed on, so a part given nothing keeps exactly Zag's behavior.
 */
export function zagPositioning(
    props: PlacementProps,
    defaults: { side: Side; align: Align },
): {
    placement: ZagPlacement;
    gutter?: number;
    shift?: number;
    flip?: boolean;
    slide?: boolean;
    overflowPadding?: number;
    boundary?: () => Element;
} {
    const side = props.side ?? defaults.side;
    const align = props.align ?? defaults.align;
    const placement = (align === 'center' ? side : `${side}-${align}`) as ZagPlacement;
    const boundary = props.collisionBoundary;
    return {
        placement,
        ...(props.sideOffset !== undefined ? { gutter: props.sideOffset } : {}),
        // Zag shifts along the axis; shadcn's offset moves away from the aligned edge.
        ...(props.alignOffset !== undefined ? { shift: align === 'end' ? -props.alignOffset : props.alignOffset } : {}),
        ...(props.avoidCollisions === false ? { flip: false, slide: false } : {}),
        ...(props.collisionPadding !== undefined ? { overflowPadding: props.collisionPadding } : {}),
        ...(boundary && typeof boundary === 'object' ? { boundary: () => boundary } : {}),
    };
}
