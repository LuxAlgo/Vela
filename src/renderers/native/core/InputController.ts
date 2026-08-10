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
    /** Touch long-press on the price or time axis strip (the mobile substitute for a
     *  right-click menu — host chrome opens a timezone / price-scale sheet). */
    onAxisLongPress?(axis: 'price' | 'time', x: number, y: number): void;

    // ── user drawings (optional) — let the drawings layer claim a gesture before pan ──
    /** True when a press at (x,y) belongs to the drawings layer (armed tool, or over a drawing). */
    drawingsClaim?(x: number, y: number): boolean;
    /** Shift+press on empty plot: arm the measure ruler AND start it at (x,y). True when it started
     *  (the drawings layer then owns the rest of the gesture). */
    drawingsMeasureStart?(x: number, y: number): boolean;
    /** Middle-click: delete the drawing under the cursor. True when one was removed. */
    drawingsDeleteAt?(x: number, y: number): boolean;
    /** A claimed press began. `snap` = effective magnet mode; `shift` = additive (multi-) select. */
    drawingsPointerDown?(x: number, y: number, snap: SnapMode, shift: boolean): void;
    /** Pointer moved (forwarded for the placing ghost / drag preview). `snap` = effective magnet
     *  mode; `shift` = lock a line tool's segment angle to 45° steps. */
    drawingsPointerMove?(x: number, y: number, snap: SnapMode, shift: boolean): void;
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
// ── touch gestures ──
const LONG_PRESS_MS = 350; // touch hold before a data-area press becomes crosshair-inspect mode
// A resting finger wobbles far more than a mouse: within this radius a hold still counts
// as stationary (long-press keeps arming), beyond it the gesture is a pan.
const TOUCH_SLOP = 8;
// Two clean taps this close together (time and space) are a double-tap — the touch
// dblclick. The browser never synthesizes dblclick here (the controller owns the touch
// stream via touch-action:none), so the pairing is detected by hand. 350ms matches the
// platform double-tap windows; 300 was tight enough to drop casual pairs.
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP = 30;
// Time-axis horizontal-zoom sensitivity: dragging left zooms in (e^(Δpx·k)). Kept low so
// the zoom takes a deliberate, sizeable drag (~2× over ~170px) rather than a twitch.
const TIME_SCALE_K = 0.004;
// Wheel-zoom sensitivity: barSpacing scales by e^(-deltaY·k) per notch. Tuned higher than
// the axis-drag feel so a single scroll notch makes a clearly visible zoom step.
const WHEEL_ZOOM_K = 0.0025;

/** Which strip a gesture started over — the data plot, the right price axis, the bottom
 *  time axis, a sub-pane separator (drag to resize the panes above/below it), or one of
 *  the touch-only modes: a two-finger pinch, long-press crosshair inspection, or a
 *  long-press that opened an axis sheet (no further drag for that gesture). */
type DragRegion = 'data' | 'price' | 'time' | 'separator' | 'drawing' | 'pinch' | 'crosshair' | 'axis-sheet';

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

/**
 * The pixel delta a wheel gesture pans by, or null when it should zoom instead.
 * Pans on a horizontal-dominant gesture (trackpad swipe / tilt wheel), and on
 * Shift+wheel — scrolling through history like a document. Most browsers already remap
 * Shift+wheel into `deltaX` (caught by the horizontal branch); the shift fallback
 * covers those that keep the delta vertical. Scroll down/right ⇒ toward the latest bars.
 */
export function wheelPanDelta(deltaX: number, deltaY: number, shift: boolean): number | null {
    if (isHorizontalWheel(deltaX, deltaY)) return deltaX;
    if (shift) return deltaY;
    return null;
}

/** The magnet mode actually applied: holding Ctrl/Cmd forces `strong`, else the sticky toolbar mode. */
export function effectiveSnapMode(momentaryOverride: boolean, sticky: SnapMode): SnapMode {
    return momentaryOverride ? 'strong' : sticky;
}

/** The barSpacing a pinch has reached: the start spacing scaled by the finger-distance
 *  ratio, clamped to the viewport's zoom bounds. `startDist` is floored at 1px so a
 *  degenerate two-fingers-on-one-point start cannot divide by zero. */
export function pinchBarSpacing(startBarSpacing: number, startDist: number, dist: number): number {
    return clampBarSpacing(startBarSpacing * (dist / Math.max(1, startDist)));
}

/**
 * The rightOffset that pins logical index `anchorLogical` at pixel `x` for a given
 * effective pitch (barSpacing × spacing multiplier) — inverse of `logicalToX`. Pinning
 * the pinch's start-midpoint logical at the LIVE midpoint x makes the bars track the
 * fingers exactly: spread to zoom, drag both to pan, in one gesture.
 */
export function pinchPinnedRightOffset(anchorLogical: number, barCount: number, width: number, x: number, pxPerBar: number): number {
    return anchorLogical - (barCount - 1) + (width - x) / pxPerBar;
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
    private middleDeleted = false; // the last middle press deleted a drawing (suppress autoscroll/paste)
    // Last cursor position over the element (NaN once it leaves) — lets a modifier
    // press/release re-shape the drawings preview with the pointer stationary.
    private cursorX = NaN;
    private cursorY = NaN;
    // ── touch state ──
    /** Live touch contacts (local coords) — two entries drive a pinch; extras are ignored. */
    private readonly touches = new Map<number, { x: number; y: number }>();
    private lpTimer: ReturnType<typeof setTimeout> | null = null;
    private pinchStartDist = 1;
    private pinchStartBarSpacing = 0;
    private pinchAnchorLogical = 0;
    // Last clean touch tap (for double-tap pairing). Time 0 = no pending first tap.
    private lastTapT = 0;
    private lastTapX = 0;
    private lastTapY = 0;

    constructor(private readonly deps: InputControllerDeps) {}

    attach(el: HTMLElement): void {
        this.el = el;
        // Own the touch stream: without this the browser converts a drag into page
        // scroll (and a pinch into page zoom) before the chart sees coherent pointer
        // events. Selection/callout off — a long-press means crosshair here. Guarded:
        // headless fakes (unit tests) attach without a style object.
        if (el.style !== undefined) {
            el.style.touchAction = 'none';
            el.style.userSelect = 'none';
            el.style.setProperty('-webkit-user-select', 'none');
            el.style.setProperty('-webkit-touch-callout', 'none');
        }
        el.addEventListener('pointerdown', this.onDown);
        el.addEventListener('pointermove', this.onMove);
        el.addEventListener('pointerup', this.onUp);
        el.addEventListener('pointerleave', this.onLeave);
        el.addEventListener('pointercancel', this.onCancel);
        el.addEventListener('dblclick', this.onDblClick);
        el.addEventListener('wheel', this.onWheel, { passive: false });
        // Middle-press companions: autoscroll starts on mousedown and Linux paste on
        // auxclick — both fire AFTER pointerdown, so a middle press that deleted a
        // drawing (see onDown) can veto them here.
        el.addEventListener('mousedown', this.onMiddleGuard);
        el.addEventListener('auxclick', this.onMiddleGuard);
        // Modifiers change the drawings preview (Shift = angle lock, Ctrl/Cmd = magnet
        // override) and must take effect the moment they are pressed/released, not on the
        // next mouse move — window-level so no chart focus is required. Optional chaining
        // keeps headless fakes (unit tests) attachable without a document.
        const win = el.ownerDocument?.defaultView;
        win?.addEventListener('keydown', this.onModifier);
        win?.addEventListener('keyup', this.onModifier);
        // A touch long-press must never open a context menu over the chart (the hold
        // means crosshair): swallow the synthesized event at the window capture phase,
        // BEFORE any host/plugin contextmenu listener, while a touch gesture is live.
        win?.addEventListener('contextmenu', this.onTouchContextMenu, true);
    }

    detach(): void {
        const el = this.el;
        if (!el) return;
        const win = el.ownerDocument?.defaultView;
        win?.removeEventListener('keydown', this.onModifier);
        win?.removeEventListener('keyup', this.onModifier);
        win?.removeEventListener('contextmenu', this.onTouchContextMenu, true);
        el.removeEventListener('pointerdown', this.onDown);
        el.removeEventListener('pointermove', this.onMove);
        el.removeEventListener('pointerup', this.onUp);
        el.removeEventListener('pointerleave', this.onLeave);
        el.removeEventListener('pointercancel', this.onCancel);
        el.removeEventListener('dblclick', this.onDblClick);
        el.removeEventListener('wheel', this.onWheel);
        el.removeEventListener('mousedown', this.onMiddleGuard);
        el.removeEventListener('auxclick', this.onMiddleGuard);
        this.cancelLongPress();
        this.touches.clear();
        this.el = null;
    }

    private readonly onTouchContextMenu = (e: MouseEvent): void => {
        if (this.touches.size === 0) return;
        if (!(e.target instanceof Node) || !this.el?.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };

    private readonly onMiddleGuard = (e: MouseEvent): void => {
        if (e.button === 1 && this.middleDeleted) e.preventDefault();
    };

    /** A modifier press/release with the pointer stationary: re-issue the last cursor
     *  position so the placing ghost / drag preview reflects the new state immediately
     *  (Shift's 45° angle lock, Ctrl/Cmd's momentary strong magnet). */
    private readonly onModifier = (e: KeyboardEvent): void => {
        if (e.repeat || (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta')) return;
        if (Number.isNaN(this.cursorX)) return; // pointer is not over the chart
        if (this.dragging && this.region !== 'drawing') return; // mid pan/axis gesture — nothing to re-shape
        this.deps.drawingsPointerMove?.(this.cursorX, this.cursorY, this.snapMode(e), e.shiftKey);
    };

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
        if (e.button === 1) {
            // Middle-click deletes the drawing under the cursor. The flag lets the
            // mousedown/auxclick companions suppress autoscroll/paste for THIS press only.
            const { x, y } = this.local(e);
            this.middleDeleted = this.deps.drawingsDeleteAt?.(x, y) ?? false;
            if (this.middleDeleted) e.preventDefault();
            return;
        }
        if (e.button !== 0) return;
        const { x, y } = this.local(e);
        if (e.pointerType === 'touch') {
            // A second finger during a pan (or long-press crosshair) escalates to a
            // pinch; during a claimed drawing/axis gesture — and beyond two contacts —
            // extra fingers are ignored so they can't corrupt the gesture in flight.
            if (this.touches.size === 1 && this.dragging && (this.region === 'data' || this.region === 'crosshair')) {
                this.touches.set(e.pointerId, { x, y });
                this.beginPinch(e);
                return;
            }
            if (this.touches.size >= 1) return;
            this.touches.set(e.pointerId, { x, y });
        }
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
        // Shift+press on the empty plot starts the measure ruler in one gesture (a press
        // over a drawing keeps the additive-select meaning of shift, via the claim above).
        if (e.shiftKey && this.regionAt(x, y) === 'data' && this.deps.drawingsMeasureStart?.(x, y)) {
            this.region = 'drawing';
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
        // A stationary touch hold in the plot becomes crosshair inspection — the touch
        // substitute for hovering (a finger can't hover, and a pan would move the view).
        // On an axis strip the same hold opens the host's timezone / price-scale sheet
        // (the mobile substitute for a right-click), unless the finger moves into a drag.
        if (e.pointerType === 'touch' && (this.region === 'data' || this.region === 'price' || this.region === 'time')) {
            this.startLongPress(x, y, this.region);
        }
        this.lastX = x;
        this.lastT = e.timeStamp;
        this.vx = 0;
        this.capture(e.pointerId);
    };

    /** Arm the long-press timer for a data-area → crosshair or axis → sheet hold;
     *  movement past TOUCH_SLOP or a second finger cancels it. */
    private startLongPress(x: number, y: number, region: 'data' | 'price' | 'time'): void {
        this.cancelLongPress();
        this.lpTimer = setTimeout(() => {
            this.lpTimer = null;
            if (!this.dragging || this.region !== region) return;
            if (region === 'data') {
                this.region = 'crosshair';
                this.deps.onPointerMove(x, y);
                return;
            }
            // Axis sheet: freeze the gesture so a later wobble cannot rescale/zoom.
            this.region = 'axis-sheet';
            this.moved = true; // not a click / not a pending drag
            this.deps.onAxisLongPress?.(region, x, y);
        }, LONG_PRESS_MS);
    }

    private cancelLongPress(): void {
        if (this.lpTimer !== null) clearTimeout(this.lpTimer);
        this.lpTimer = null;
    }

    /** Two fingers down: freeze the view and re-base the gesture as an anchored pinch. */
    private beginPinch(e: PointerEvent): void {
        this.cancelLongPress();
        if (this.region === 'crosshair') this.deps.onPointerMove(null, null); // inspection ends; the pinch owns the gesture
        const coords = this.deps.getCoords();
        const vp = coords.getViewport();
        this.deps.apply(vp); // freeze any in-flight fling/zoom before grabbing
        const [a, b] = [...this.touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinchStartDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.pinchStartBarSpacing = vp.barSpacing;
        this.pinchAnchorLogical = coords.xToLogical((a.x + b.x) / 2);
        this.region = 'pinch';
        this.dragging = true;
        this.moved = true; // a pinch is never a click
        this.vx = 0;
        this.capture(e.pointerId);
    }

    /** Track both fingers: distance ratio zooms, the live midpoint pans (anchor pinned under it). */
    private applyPinch(): void {
        const coords = this.deps.getCoords();
        const pts = [...this.touches.values()];
        if (pts.length < 2) return;
        const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
        const barSpacing = pinchBarSpacing(this.pinchStartBarSpacing, this.pinchStartDist, Math.hypot(a.x - b.x, a.y - b.y));
        // The spacing multiplier is constant through the gesture; derive it from the live
        // effective pitch so the pin math matches logicalToX exactly.
        const vp = coords.getViewport();
        const pitchScale = vp.barSpacing > 0 ? coords.pxPerBar() / vp.barSpacing : 1;
        const midX = (a.x + b.x) / 2;
        this.deps.apply({
            barSpacing,
            rightOffset: pinchPinnedRightOffset(this.pinchAnchorLogical, coords.barCount, coords.width, midX, barSpacing * pitchScale),
        });
    }

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
        this.cursorX = x;
        this.cursorY = y;
        if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x, y });
        if (this.dragging && this.region === 'pinch') {
            this.applyPinch();
            return; // no crosshair while pinching — two fingers name no single point
        }
        if (this.dragging && this.region === 'crosshair') {
            this.deps.onPointerMove(x, y); // inspect: the finger drives the crosshair, the view stays put
            return;
        }
        if (this.dragging && this.region === 'axis-sheet') {
            return; // sheet already opened — ignore further motion for this gesture
        }
        // Once a touch travels past the wobble slop it is a pan, not a nascent long-press.
        if (this.lpTimer !== null && Math.hypot(x - this.startX, y - this.startY) > TOUCH_SLOP) this.cancelLongPress();
        // Click/tap-vs-drag classification: a resting finger wobbles far more than a
        // mouse, so a touch keeps its tap-hood through TOUCH_SLOP of travel — with the
        // 2px mouse slop, most real taps read as micro-pans and double-taps almost
        // never paired. (The view still pans by those few px either way; `moved` only
        // decides what the RELEASE means.)
        const slop = e.pointerType === 'touch' ? TOUCH_SLOP : DRAG_SLOP;
        if (this.dragging) {
            if (this.region === 'price') {
                if (Math.abs(y - this.startY) > slop) this.moved = true;
                this.deps.priceScaleBy(y - this.startY);
            } else if (this.region === 'separator') {
                if (Math.abs(y - this.startY) > slop) this.moved = true;
                this.deps.paneResizeBy(y - this.startY);
            } else if (this.region === 'time') {
                if (Math.abs(x - this.startX) > slop) this.moved = true;
                // Pin the right edge (keep rightOffset): logicalToX(rightEdge) == width for
                // any barSpacing, so only barSpacing changes. Drag left ⇒ zoom in.
                const barSpacing = clampBarSpacing(this.startBarSpacing * Math.exp((this.startX - x) * TIME_SCALE_K));
                this.deps.apply({ barSpacing, rightOffset: this.startRightOffset });
            } else if (this.region === 'drawing') {
                if (Math.abs(x - this.startX) > slop || Math.abs(y - this.startY) > slop) this.moved = true;
                this.deps.drawingsPointerMove?.(x, y, this.snapMode(e), e.shiftKey);
            } else {
                const coords = this.deps.getCoords();
                const vp = coords.getViewport();
                const dx = x - this.startX;
                if (Math.abs(dx) > slop) this.moved = true;
                // Drag right → reveal earlier bars → rightOffset decreases. Track by the effective
                // pitch (zoom × spacing multiplier) so the chart follows the cursor 1:1.
                this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: this.startRightOffset - dx / coords.pxPerBar() });
                if (this.verticalPan) {
                    if (Math.abs(y - this.startY) > slop) this.moved = true;
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
            this.deps.drawingsPointerMove?.(x, y, this.snapMode(e), e.shiftKey);
        }
        this.deps.onPointerMove(x, y);
    };

    private readonly onUp = (e: PointerEvent): void => {
        if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
        this.cancelLongPress();
        if (this.dragging && this.region === 'pinch') {
            if (this.touches.size === 1) {
                // One finger lifted: the survivor continues as a plain pan, re-based at
                // its current position so the view doesn't jump.
                const rest = [...this.touches.values()][0]!;
                const vp = this.deps.getCoords().getViewport();
                this.region = 'data';
                this.verticalPan = false;
                this.startX = rest.x;
                this.startY = rest.y;
                this.startRightOffset = vp.rightOffset;
                this.startBarSpacing = vp.barSpacing;
                this.lastX = rest.x;
                this.lastT = e.timeStamp;
                this.vx = 0;
                return; // still dragging with the remaining finger
            }
            this.endGesture(e);
            return;
        }
        if (this.dragging && this.region === 'crosshair') {
            this.deps.onPointerMove(null, null); // no hover on touch — lifting the finger ends the readout
            this.endGesture(e);
            return;
        }
        if (this.dragging && this.region === 'axis-sheet') {
            this.endGesture(e);
            return;
        }
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
        const wasTouch = e.pointerType === 'touch';
        // A stationary touch release is a tap — feed the double-tap pairing (touch has
        // no native dblclick here). Checked before endGesture clears the flags.
        const wasTap = wasTouch && this.dragging && !this.moved;
        this.endGesture(e);
        // A finger leaves no resting cursor behind — clear the crosshair a pan/tap drew.
        if (wasTouch) this.deps.onPointerMove(null, null);
        if (wasTap) {
            const { x, y } = this.local(e);
            this.registerTap(e.timeStamp, x, y);
        }
    };

    /** Pair clean taps into a double-tap — the touch equivalent of dblclick (same
     *  routing: axis taps reset that axis' view, a plot tap toggles pane maximize). */
    private registerTap(t: number, x: number, y: number): void {
        const paired = this.lastTapT > 0 && t - this.lastTapT <= DOUBLE_TAP_MS && Math.hypot(x - this.lastTapX, y - this.lastTapY) <= DOUBLE_TAP_SLOP;
        if (paired) {
            this.lastTapT = 0; // a triple tap starts a fresh pair, not two doubles
            this.doubleActivate(x, y);
            return;
        }
        this.lastTapT = t;
        this.lastTapX = x;
        this.lastTapY = y;
    }

    private endGesture(e: PointerEvent): void {
        this.dragging = false;
        try {
            this.el?.releasePointerCapture(e.pointerId);
        } catch {
            // never captured (see capture()) or the pointer vanished — nothing to release
        }
    }

    /** The browser took the pointer back (system gesture, palm rejection, tab switch):
     *  drop the gesture where it is — no click, no fling, no stuck `dragging`. */
    private readonly onCancel = (e: PointerEvent): void => {
        if (e.pointerType === 'touch') this.touches.delete(e.pointerId);
        this.cancelLongPress();
        if (!this.dragging) return;
        if (this.region === 'drawing' && !Number.isNaN(this.cursorX)) this.deps.drawingsPointerUp?.(this.cursorX, this.cursorY);
        if (this.region === 'crosshair' || e.pointerType === 'touch') this.deps.onPointerMove(null, null);
        this.endGesture(e);
    };

    private readonly onLeave = (): void => {
        this.cursorX = NaN;
        this.cursorY = NaN;
        this.deps.onPointerMove(null, null);
    };

    private readonly onDblClick = (e: MouseEvent): void => {
        const { x, y } = this.local(e);
        this.doubleActivate(x, y);
    };

    /** Shared double-click / double-tap routing, by the region under the point. */
    private doubleActivate(x: number, y: number): void {
        // A drawing double-click opens its settings — suppress the view/scale reset.
        if (this.deps.drawingsDblClick?.(x, y)) return;
        const region = this.regionAt(x, y);
        if (region === 'price') this.deps.resetPriceScale(x, y);
        else if (region === 'separator') this.deps.resetPaneSize(y);
        else if (region === 'time') this.deps.resetView(); // fit-to-content on the time axis
        else this.deps.dataDblClick(x, y);
    }

    private readonly onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.deps.drawingsClearTransient?.(); // a finished ruler vanishes on zoom/pan
        const coords = this.deps.getCoords();
        const vp = coords.getViewport();
        // A horizontal-dominant gesture (trackpad two-finger swipe / tilt wheel) and
        // Shift+wheel pan through time instead of zooming — the renderer clamps the
        // applied viewport.
        const pan = wheelPanDelta(e.deltaX, e.deltaY, e.shiftKey);
        if (pan != null) {
            this.deps.apply({ barSpacing: vp.barSpacing, rightOffset: wheelPanRightOffset(vp.rightOffset, pan, coords.pxPerBar()) });
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
