import type { CoordinateSystem } from './CoordinateSystem';
import type { ViewportState } from './ViewportState';
import { clampBarSpacing } from './ViewportState';
import type { SnapMode } from '../../../core/drawings';

export interface InputControllerDeps {
    getCoords(): CoordinateSystem;
    /** Apply a viewport instantly (drag pan, freeze-on-touch); stops any animation. */
    apply(viewport: ViewportState): void;
    /** Eased cursor-anchored zoom: glide barSpacing → target, pinning `anchorLogical` at `anchorX`. */
    zoomTo(targetBarSpacing: number, anchorLogical: number, anchorX: number): void;
    /** Inertial pan: continue with this rightOffset velocity (logical units per ms) + decelerate. */
    fling(rightOffsetVelocity: number): void;
    /** Pointer moved over the chart (for the crosshair); null when it leaves. */
    onPointerMove(x: number | null, y: number | null): void;
    onClick(x: number, y: number): void;
    /** Grab the price axis at (`x`,`y`) — record the scale column there + its window (for a rescale drag). */
    beginPriceScale(x: number, y: number): void;
    /** Rescale the grabbed pane vertically by the TOTAL pixel drag (down ⇒ zoom out / compress). */
    priceScaleBy(dyTotal: number): void;
    /** Grab inside the data area at pixel `y` — returns true when vertical price-panning is
     *  enabled for that pane (i.e. it is already in manual-scale mode). */
    beginPricePan(y: number): boolean;
    /** Pan the grabbed pane's price window by the TOTAL pixel drag (down ⇒ show lower prices). */
    pricePanBy(dyTotal: number): void;
    /** Double-click on the price axis → re-enable autoscale for the pane/column at (`x`,`y`). */
    resetPriceScale(x: number, y: number): void;
    /**
     * Double-click inside the data area: on the price pane, toggle collapse of every study
     * pane (hide/show sub panes); on a study pane, toggle maximize. Replaces the old
     * fit-to-content reset (keyboard `0` still fits).
     */
    dataDblClick(x: number, y: number): void;
    /** True when pixel `y` sits on a draggable sub-pane separator (for the cursor + region). */
    paneSeparatorAt(y: number): boolean;
    /** Grab the sub-pane separator at pixel `y` — record the adjacent panes + their shared span. */
    beginPaneResize(y: number): void;
    /** Resize the grabbed panes by the TOTAL pixel drag (down ⇒ grow the upper pane). */
    paneResizeBy(dyTotal: number): void;
    /** Double-click a sub-pane separator → restore the two adjacent panes to an even split. */
    resetPaneSize(y: number): void;
    /** Double-click the time axis → fit the view to content (same as keyboard `0`). */
    resetView(): void;

    // ── user drawings (optional) — let the drawings layer claim a gesture before pan ──
    /** True when a press at (x,y) belongs to the drawings layer (armed tool, or over a drawing). */
    drawingsClaim?(x: number, y: number): boolean;
    /** A claimed press began. `snap` = effective magnet mode; `shift` = additive (multi-) select. */
    drawingsPointerDown?(x: number, y: number, snap: SnapMode, shift: boolean): void;
    /** Pointer moved (forwarded for the placing ghost / drag preview). `snap` = effective magnet mode. */
    drawingsPointerMove?(x: number, y: number, snap: SnapMode): void;
    /** Cursor to show while hovering the drawings layer (e.g. `'pointer'` over a drawing), or null. */
    drawingsCursor?(x: number, y: number): string | null;
    /** The sticky magnet mode set on the toolbar (off/weak/strong) — Ctrl/Cmd overrides it to strong. */
    drawingsSnapMode?(): SnapMode;
    /** A claimed gesture ended. */
    drawingsPointerUp?(x: number, y: number): void;
    /** Double-click — open a drawing's settings. Returns true when one was hit (suppresses reset). */
    drawingsDblClick?(x: number, y: number): boolean;
    /** Clear a finished transient overlay (the ruler) — fired on any press / wheel before pan/zoom. */
    drawingsClearTransient?(): void;
}

const FLING_MIN_SPEED = 0.04; // px/ms below which a release is treated as a stop (no fling)
const FLING_STALE_MS = 60; // if the last move is older than this at release, don't fling
const DRAG_SLOP = 2; // px of motion before a press counts as a drag (vs a click)
// Time-axis horizontal-zoom sensitivity: dragging left zooms in (e^(Δpx·k)). Kept low so
// the zoom takes a deliberate, sizeable drag (~2× over ~170px) rather than a twitch.
const TIME_SCALE_K = 0.004;
// Wheel-zoom sensitivity: barSpacing scales by e^(-deltaY·k) per notch. Tuned higher than
// the axis-drag feel so a single scroll notch makes a clearly visible zoom step.
const WHEEL_ZOOM_K = 0.0025;

/** Which strip a gesture started over — the data plot, the right price axis, the bottom
 *  time axis, or a sub-pane separator (drag to resize the panes above/below it). */
type DragRegion = 'data' | 'price' | 'time' | 'separator' | 'drawing';

/**
 * The logical bar + its pixel that a wheel-zoom keeps pinned. `right` (the default)
 * pins the right edge / latest bar (`rightOffset` stays put while zooming);
 * `cursor` pins the bar under the cursor (zoom toward the pointer).
 */
export function wheelZoomAnchor(
    coords: Pick<CoordinateSystem, 'xToLogical' | 'rightEdgeLogical' | 'width'>,
    cursorX: number,
    rightEdge: boolean,
): { logical: number; x: number } {
    if (rightEdge) return { logical: coords.rightEdgeLogical, x: coords.width };
    return { logical: coords.xToLogical(cursorX), x: cursorX };
}

/**
 * A wheel gesture pans through time when its horizontal delta dominates — a trackpad
 * two-finger sideways swipe, or a tilt/horizontal mouse wheel. A vertical-dominant
 * gesture (a normal wheel notch) keeps zooming. Ties fall through to zoom.
 */
export function isHorizontalWheel(deltaX: number, deltaY: number): boolean {
    return Math.abs(deltaX) > Math.abs(deltaY);
}

/**
 * The rightOffset after a horizontal wheel pan of `deltaX` pixels. Panning by whole
 * pixels (deltaX ÷ barSpacing bars) makes the chart track the fingers 1:1. `deltaX > 0`
 * (scroll/swipe right) moves forward toward the latest bars — matching a leftward drag,
 * which increases rightOffset the same way.
 */
export function wheelPanRightOffset(rightOffset: number, deltaX: number, barSpacing: number): number {
    return rightOffset + deltaX / barSpacing;
}

/** The magnet mode actually applied: holding Ctrl/Cmd forces `strong`, else the sticky toolbar mode. */
export function effectiveSnapMode(momentaryOverride: boolean, sticky: SnapMode): SnapMode {
    return momentaryOverride ? 'strong' : sticky;
}

/**
 * Translates pointer/wheel gestures into ViewportState + scale changes. A press in
 * the data area pans (`rightOffset`, instant) and — in manual-scale mode — also pans
 * the price window vertically; a press on the right price-axis strip rescales that
 * pane vertically; a press on the bottom time-axis strip zooms horizontally
 * (`barSpacing`); the wheel zooms (eased + anchored); a flick releases with inertia;
 * a double-click resets. The renderer owns the animation loop + the scale math — this
 * just classifies the gesture and emits intents.
 */
export class InputController {
    /** When true (the default), wheel-zoom pins the right edge instead of the bar
     *  under the cursor. */
    rightEdgeZoom = true;
    /** When true (the default), the price/time axis strips are draggable to rescale/zoom.
     *  When false, every press in those strips behaves as a normal data-area pan. */
    axisDrag = true;
    /** When true (the default), the separators between stacked panes are draggable to
     *  resize the panes above/below. When false, a press there is a normal data-area pan. */
    paneResize = true;
    private el: HTMLElement | null = null;
    private dragging = false;
    private moved = false;
    private region: DragRegion = 'data';
    private verticalPan = false; // data-area drag also pans price (pane in manual-scale mode)
    private startX = 0;
    private startY = 0;
    private startRightOffset = 0;
    private startBarSpacing = 0;
    // velocity tracking (for the inertial flick)
    private lastX = 0;
    private lastT = 0;
    private vx = 0; // smoothed pointer velocity, px/ms

    constructor(private readonly deps: InputControllerDeps) {}

    attach(el: HTMLElement): void {
        this.el = el;
        el.addEventListener('pointerdown', this.onDown);
        el.addEventListener('pointermove', this.onMove);
        el.addEventListener('pointerup', this.onUp);
        el.addEventListener('pointerleave', this.onLeave);
        el.addEventListener('dblclick', this.onDblClick);
        el.addEventListener('wheel', this.onWheel, { passive: false });
    }

    detach(): void {
        const el = this.el;
        if (!el) return;
        el.removeEventListener('pointerdown', this.onDown);
        el.removeEventListener('pointermove', this.onMove);
        el.removeEventListener('pointerup', this.onUp);
        el.removeEventListener('pointerleave', this.onLeave);
        el.removeEventListener('dblclick', this.onDblClick);
        el.removeEventListener('wheel', this.onWheel);
        this.el = null;
    }

    private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
        const rect = (this.el as HTMLElement).getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    /** Classify a pixel into the plot, an axis strip (only when `axisDrag`), or a sub-pane
     *  separator (only when `paneResize`). A separator spans the FULL width (data area + right
     *  scale gutter), so it's checked first and wins over the price-axis strip where they cross —
     *  keeping the divider grabbable all the way across the scale. */
    regionAt(x: number, y: number): DragRegion {
        const c = this.deps.getCoords();
        if (this.paneResize && y <= c.height && this.deps.paneSeparatorAt(y)) return 'separator';
        if (this.axisDrag) {
            if (x > c.width && y <= c.height) return 'price'; // right price-axis strip
            if (y > c.height && x <= c.width) return 'time'; // bottom time-axis strip
        }
        return 'data';
    }

    /** Effective magnet mode for an event: Ctrl/Cmd forces strong, else the sticky toolbar mode. */
    private snapMode(e: { ctrlKey: boolean; metaKey: boolean }): SnapMode {
        return effectiveSnapMode(e.ctrlKey || e.metaKey, this.deps.drawingsSnapMode?.() ?? 'off');
    }

    private readonly onDown = (e: PointerEvent): void => {
        if (e.button !== 0) return;
        const { x, y } = this.local(e);
        this.deps.drawingsClearTransient?.(); // a finished ruler vanishes on the next press (pan still proceeds)
        this.dragging = true;
        this.moved = false;
        this.startX = x;
        this.startY = y;
        // The drawings layer gets first refusal: when a tool is armed or the press is
        // over a drawing/handle it claims the WHOLE gesture (no pan/fling), atomically.
        if (this.deps.drawingsClaim?.(x, y)) {
            this.region = 'drawing';
            this.deps.drawingsPointerDown?.(x, y, this.snapMode(e), e.shiftKey);
            this.capture(e.pointerId);
            return;
        }
        // Freeze any in-flight zoom/fling at its current position before grabbing.
        const vp = this.deps.getCoords().getViewport();
        this.deps.apply(vp);
        this.startRightOffset = vp.rightOffset;
        this.startBarSpacing = vp.barSpacing;
        this.region = this.regionAt(x, y);
        this.verticalPan = false;
        if (this.region === 'price') this.deps.beginPriceScale(x, y);
        else if (this.region === 'separator') this.deps.beginPaneResize(y);
        else if (this.region === 'data') this.verticalPan = this.deps.beginPricePan(y);
        this.lastX = x;
        this.lastT = e.timeStamp;
        this.vx = 0;
        this.capture(e.pointerId);
    };

    /** Capture defensively: a synthetic/already-released pointer can't be captured, and
     *  the move/up pair still routes through the element listeners without it. */
    private capture(pointerId: number): void {
        try {
            this.el?.setPointerCapture(pointerId);
        } catch {
            /* keep the gesture alive uncaptured */
        }
    }

    private readonly onMove = (e: PointerEvent): void => {
        const { x, y } = this.local(e);
        if (this.dragging) {
            if (this.region === 'price') {
                if (Math.abs(y - this.startY) > DRAG_SLOP) this.moved = true;
                this.deps.priceScaleBy(y - this.startY);
            } else if (this.region === 'separator') {
                if (Math.abs(y - this.startY) > DRAG_SLOP) this.moved = true;
                this.deps.paneResizeBy(y - this.startY);
            } else if (this.region === 'time') {
                if (Math.abs(x - this.startX) > DRAG_SLOP) this.moved = true;
                // Pin the right edge (keep rightOffset): logicalToX(rightEdge) == width for
                // any barSpacing, so only barSpacing changes. Drag left ⇒ zoom in.
                const barSpacing = clampBarSpacing(this.startBarSpacing * Math.exp((this.startX - x) * TIME_SCALE_K));
                this.deps.apply({ barSpacing, rightOffset: this.startRightOffset });
            } else if (this.region === 'drawing') {
                if (Math.abs(x - this.startX) > DRAG_SLOP || Math.abs(y - this.startY) > DRAG_SLOP) this.moved = true;
                this.deps.drawingsPointerMove?.(x, y, this.snapMode(e));
            } else {
                const coords = this.deps.getCoords();
                const vp = coords.getViewport();
                const dx = x - this.startX;
                if (Math.abs(dx) > DRAG_SLOP) this.moved = true;
                // Drag right → reveal earlier bars → rightOffset decreases. Track by the effective
                // pitch (zoom × spacing multiplier) so the chart follows the cursor 1:1.
                this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: this.startRightOffset - dx / coords.pxPerBar() });
                if (this.verticalPan) {
                    if (Math.abs(y - this.startY) > DRAG_SLOP) this.moved = true;
                    this.deps.pricePanBy(y - this.startY);
                }
                // Track a low-passed pointer velocity for the release flick.
                const dt = e.timeStamp - this.lastT;
                if (dt > 0) {
                    const inst = (x - this.lastX) / dt;
                    this.vx = this.vx * 0.6 + inst * 0.4;
                    this.lastX = x;
                    this.lastT = e.timeStamp;
                }
            }
        } else if (this.el) {
            // Cursor affordance: a drawing under the cursor wins (pointer), else the
            // draggable axis-strip cursors.
            const drawCursor = this.deps.drawingsCursor?.(x, y);
            const r = this.regionAt(x, y);
            this.el.style.cursor = drawCursor ?? (r === 'price' ? 'ns-resize' : r === 'time' ? 'ew-resize' : r === 'separator' ? 'row-resize' : '');
            // Forward hover moves so the drawings layer can advance a placing ghost
            // (placing is click-based, so the cursor follow happens with no button down).
            this.deps.drawingsPointerMove?.(x, y, this.snapMode(e));
        }
        this.deps.onPointerMove(x, y);
    };

    private readonly onUp = (e: PointerEvent): void => {
        if (this.dragging && this.region === 'drawing') {
            const { x, y } = this.local(e);
            this.deps.drawingsPointerUp?.(x, y);
        } else if (this.dragging && !this.moved && this.region === 'data') {
            const { x, y } = this.local(e);
            this.deps.onClick(x, y);
        } else if (this.dragging && this.region === 'data') {
            const stale = e.timeStamp - this.lastT > FLING_STALE_MS;
            if (!stale && Math.abs(this.vx) > FLING_MIN_SPEED) {
                const pitch = this.deps.getCoords().pxPerBar();
                this.deps.fling(-this.vx / pitch); // rightOffset velocity (logical/ms)
            }
        }
        this.dragging = false;
        try {
            this.el?.releasePointerCapture(e.pointerId);
        } catch {
            // never captured (see capture()) or the pointer vanished — nothing to release
        }
    };

    private readonly onLeave = (): void => {
        this.deps.onPointerMove(null, null);
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        const { x, y } = this.local(e);
        // A drawing double-click opens its settings — suppress the view/scale reset.
        if (this.deps.drawingsDblClick?.(x, y)) return;
        const region = this.regionAt(x, y);
        if (region === 'price') this.deps.resetPriceScale(x, y);
        else if (region === 'separator') this.deps.resetPaneSize(y);
        else if (region === 'time') this.deps.resetView(); // fit-to-content on the time axis
        else this.deps.dataDblClick(x, y);
    };

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.deps.drawingsClearTransient?.(); // a finished ruler vanishes on zoom/pan
        const coords = this.deps.getCoords();
        const vp = coords.getViewport();
        // A horizontal-dominant gesture (trackpad two-finger swipe / tilt wheel) pans
        // through time instead of zooming — the renderer clamps the applied viewport.
        if (isHorizontalWheel(e.deltaX, e.deltaY)) {
            this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: wheelPanRightOffset(vp.rightOffset, e.deltaX, coords.pxPerBar()) });
            return;
        }
        const cursorX = this.local(e).x;
        // Holding Ctrl/Cmd overrides the sticky right-edge anchor → zoom toward the cursor's bar.
        const rightEdge = this.rightEdgeZoom && !(e.ctrlKey || e.metaKey);
        const anchor = wheelZoomAnchor(coords, cursorX, rightEdge);
        // Smooth multiplicative zoom; scroll up (deltaY<0) zooms in.
        const target = clampBarSpacing(vp.barSpacing * Math.exp(-e.deltaY * WHEEL_ZOOM_K));
        this.deps.zoomTo(target, anchor.logical, anchor.x);
    };
}
