import type { Drawing, DrawingIntent, DrawingPoint, DrawingStyle, DrawingTypeKey, FreeAxis, Projector, SnapMode } from '../../../core/drawings';
import { createDrawing } from '../../../core/drawings';
import { topDrawingAt, HIT_TOLERANCE } from './DrawingHitTester';

/** Pixels of motion before a press counts as a drag (vs a click → open settings). */
const DRAG_SLOP = 3;
/** Minimum pixel gap between captured freehand points (keeps a stroke from over-sampling). */
const FREEHAND_SAMPLE_PX = 4;

/** What the interaction needs from its host (the {@link UserDrawingController}). */
export interface InteractionDeps {
    projector(): Projector;
    /** The currently armed tool, or null in select/idle mode. */
    activeTool(): DrawingTypeKey | null;
    /** The drawings currently shown (ascending paint order). */
    drawings(): readonly Drawing[];
    /** The drawing currently under the cursor (controller-owned) — its handles are showing. */
    hoveredId(): string | null;
    /** The selected drawings (controller-owned) — their handles are showing + grabbable off-body. */
    selectedIds(): ReadonlySet<string>;
    /** Emit a renderer→core intent. */
    emit(i: DrawingIntent): void;
    /** Request a drawings-layer repaint (ghost/drag/state changed). */
    changed(): void;
    /** A click (press+release, no drag) landed on a drawing → open its settings popup. */
    openSettings(id: string, x: number, y: number): void;
    /** Snap a data point to the nearest candle (time + OHLC), per the magnet mode + cursor pixel. */
    snap(point: DrawingPoint, paneId: string, mode: SnapMode, cursorPx?: { x: number; y: number }): DrawingPoint;
    /** The armed tool's last-used style (if any) — seeds the placement draft so its ghost
     *  previews the last color/width, not the type default. */
    lastStyle(): DrawingStyle | undefined;
}

type State =
    | { kind: 'idle' }
    | { kind: 'placing'; draft: Drawing; need: number; cursor: DrawingPoint | null }
    | { kind: 'pressed'; id: string; handle: number; grab: DrawingPoint; orig: DrawingPoint[]; px: number; py: number; moved: boolean };

/**
 * The single user-drawing interaction state machine: arm → place (click anchors,
 * live ghost) → press a drawing → release-without-moving opens its settings, or
 * drag (whole body / a handle) to move/resize. Built with a deps closure so it is
 * unit-testable without a canvas. `locked` drawings open settings but never drag.
 */
export class DrawingInteraction {
    private state: State = { kind: 'idle' };
    private snapAt: { point: DrawingPoint; paneId: string } | null = null; // magnet target for the ring

    constructor(private readonly deps: InteractionDeps) {}

    /** The current magnet target (snapped point + pane) to mark with a ring, or null. */
    snapMarker(): { point: DrawingPoint; paneId: string } | null {
        return this.snapAt;
    }

    /**
     * Control-circle positions for the anchors placed so far while PLACING — so the
     * user always sees where each clicked point landed (e.g. a pitchfork's pivot),
     * even before the shape has enough anchors to render a ghost. Null when not placing.
     */
    placingMarkers(proj: Projector): Array<[number, number]> | null {
        if (this.state.kind !== 'placing') return null;
        const { draft } = this.state;
        if (draft.placementMode() === 'freehand') return null; // a captured stroke shows no per-point circles
        const points: Array<[number, number]> = [];
        for (const a of draft.anchors) {
            const y = proj.yOf(a.price, draft.paneId);
            if (y != null) points.push([proj.xOf(a.time), y]);
        }
        return points.length ? points : null;
    }

    /** Resolve a pixel to a data point, snapping to a candle per the magnet `mode`. The snap ring
     *  marker is set only when a snap actually happened (so `weak` outside its radius shows nothing). */
    private resolve(x: number, y: number, paneId: string, mode: SnapMode): DrawingPoint {
        const raw = this.deps.projector().pxToPoint(x, y, paneId);
        if (mode === 'off') {
            this.snapAt = null;
            return raw;
        }
        const snapped = this.deps.snap(raw, paneId, mode, { x, y });
        const changed = snapped.time !== raw.time || snapped.price !== raw.price;
        this.snapAt = changed ? { point: snapped, paneId } : null;
        return snapped;
    }

    /** Should the drawing layer win this press (vs pan)? Armed/placing/pressed, or over a drawing/handle. */
    claim(x: number, y: number): boolean {
        if (this.deps.activeTool() != null || this.state.kind !== 'idle') return true;
        return this.hitAt(x, y) != null;
    }

    /** A cursor hint for hovering (pointer over a drawing/handle), or null off any drawing. */
    cursorAt(x: number, y: number): string | null {
        if (this.deps.activeTool() != null) return null; // armed → keep the crosshair
        return this.hitAt(x, y) ? 'pointer' : null;
    }

    isPlacing(): boolean {
        return this.state.kind === 'placing';
    }

    isDragging(): boolean {
        return this.state.kind === 'pressed' && this.state.moved;
    }

    /** The drawing being actively dragged (so its handles stay shown mid-drag), or null. */
    activeDragId(): string | null {
        return this.state.kind === 'pressed' && this.state.moved ? this.state.id : null;
    }

    /** A press: place the next anchor, or grab a drawing/handle (resolved as click or drag on release).
     *  `shift` over a drawing toggles it in/out of the selection (multi-select) instead of dragging. */
    down(x: number, y: number, mode: SnapMode = 'off', shift = false): void {
        const proj = this.deps.projector();
        if (this.state.kind === 'placing') {
            if (this.state.draft.placementMode() !== 'click') return; // drag/freehand finalize on release, not extra clicks
            this.state.draft.anchors.push(this.placementAnchor(this.state.draft, this.resolve(x, y, this.state.draft.paneId, mode)));
            if (this.state.draft.anchors.length >= this.state.need) this.finalize();
            else this.deps.changed();
            return;
        }
        const tool = this.deps.activeTool();
        if (tool) {
            const paneId = proj.paneIdAtY(y) ?? 'price';
            const draft = createDrawing(tool, { paneId, anchors: [this.resolve(x, y, paneId, mode)], style: this.deps.lastStyle() });
            if (!draft) return;
            this.state = { kind: 'placing', draft, need: draft.anchorSchema().max, cursor: null };
            // Fixed tools (max === min) finalize as soon as the count is met; variable/freehand wait for a gesture.
            if (draft.placementMode() === 'click' && draft.anchors.length >= this.state.need) this.finalize();
            else this.deps.changed();
            return;
        }
        // ── press mode ── a press grabs the drawing/handle under the cursor; release
        // without moving = a click (→ settings), release after moving = a drag.
        const hit = this.hitAt(x, y);
        if (hit) {
            if (shift) {
                this.deps.emit({ kind: 'select', ids: [hit.id], additive: true }); // shift-click toggles selection
                return;
            }
            const handle = hit.hitHandle(x, y, proj, HIT_TOLERANCE); // -1 = body, ≥0 = a handle
            this.state = { kind: 'pressed', id: hit.id, handle, grab: proj.pxToPoint(x, y, hit.paneId), orig: cloneAnchors(hit), px: x, py: y, moved: false };
        }
        // empty space → nothing here: the popup self-dismisses + hover already cleared handles.
    }

    /** Pointer move: advance the placing ghost, or live-preview a drag once past the slop. */
    move(x: number, y: number, mode: SnapMode = 'off'): void {
        if (this.state.kind === 'idle') {
            // Armed but not yet placing: preview where the FIRST anchor will magnet-snap.
            const tool = this.deps.activeTool();
            const had = this.snapAt != null;
            if (tool && mode !== 'off') this.resolve(x, y, this.deps.projector().paneIdAtY(y) ?? 'price', mode);
            else this.snapAt = null;
            if (this.snapAt != null || had) this.deps.changed();
            return;
        }
        if (this.state.kind === 'placing') {
            if (this.state.draft.placementMode() === 'freehand') {
                this.captureFreehand(x, y);
                return;
            }
            this.state.cursor = this.resolve(x, y, this.state.draft.paneId, mode);
            this.deps.changed();
            return;
        }
        if (this.state.kind !== 'pressed') return;
        const d = this.byId(this.state.id);
        if (!d || d.locked) return; // locked → never drags (stays a click)
        if (!this.state.moved && Math.abs(x - this.state.px) <= DRAG_SLOP && Math.abs(y - this.state.py) <= DRAG_SLOP) return;
        this.state.moved = true;
        if (this.state.handle >= 0) {
            const a = d.anchors[this.state.handle]; // a handle snaps to the candle
            if (a) applyFree(a, this.resolve(x, y, d.paneId, mode), d.anchorSchema().slots[this.state.handle]?.free ?? 'both');
            d.constrainHandleDrag(this.state.handle); // e.g. a position flips its reward/stop to stay opposed
        } else {
            const pt = this.deps.projector().pxToPoint(x, y, d.paneId); // whole-body move stays smooth (no snap)
            this.snapAt = null;
            const dt = pt.time - this.state.grab.time;
            const dp = pt.price - this.state.grab.price;
            d.anchors = d.translateBody(dt, dp, this.state.orig); // a callout pins its tip + moves only the box
        }
        this.deps.changed();
    }

    /** Pointer release: finish a freehand stroke, end a polyline click (no-op), commit a drag,
     *  or treat a no-move press as a click → settings. */
    up(x: number, y: number): void {
        this.snapAt = null;
        if (this.state.kind === 'placing') {
            const mode = this.state.draft.placementMode();
            if (mode === 'drag') {
                // press-drag-release: the release point is the second anchor (e.g. a box's far corner)
                if (this.state.cursor) this.state.draft.anchors.push(this.state.cursor);
                if (this.state.draft.anchors.length >= this.state.draft.anchorSchema().min) this.finalize();
                else this.discardPlacing(); // a bare click with no drag → nothing to keep
            } else if (mode === 'freehand') {
                if (this.state.draft.anchors.length >= this.state.draft.anchorSchema().min) this.finalize();
                else this.discardPlacing();
            }
            return; // click placement: releasing a click adds nothing (the press already placed the anchor)
        }
        if (this.state.kind !== 'pressed') return;
        const { id, moved } = this.state;
        this.state = { kind: 'idle' };
        const d = this.byId(id);
        if (moved) {
            if (d) this.deps.emit({ kind: 'edit', doc: d.serialize() });
            this.deps.changed();
        } else {
            this.deps.openSettings(id, x, y); // a click opens the settings popup
        }
    }

    /** Cancel an in-progress placement or drag (Escape). Returns whether anything was cancelled. */
    cancel(): boolean {
        this.snapAt = null;
        if (this.state.kind === 'placing') {
            const type = this.state.draft.type;
            this.state = { kind: 'idle' };
            this.deps.emit({ kind: 'tool-finished', type });
            this.deps.changed();
            return true;
        }
        if (this.state.kind === 'pressed') {
            const d = this.byId(this.state.id);
            if (d && this.state.moved) d.anchors = this.state.orig.map((o) => ({ time: o.time, price: o.price }));
            this.state = { kind: 'idle' };
            this.deps.changed();
            return true;
        }
        return false;
    }

    /** Disarm cleanup when the active tool is cleared externally. */
    onToolCleared(): void {
        if (this.state.kind === 'placing') {
            this.state = { kind: 'idle' };
            this.deps.changed();
        }
    }

    /** The transient drawing to paint while placing (committed anchors + the cursor), or null. */
    ghost(): Drawing | null {
        if (this.state.kind !== 'placing') return null;
        const { draft, cursor } = this.state;
        if (!cursor) return draft.anchors.length >= 1 && draft.type === 'hline' ? draft : null;
        return createDrawing(draft.type, { paneId: draft.paneId, anchors: [...draft.anchors, this.placementAnchor(draft, cursor)], style: draft.style });
    }

    /** Map a raw placement cursor to the anchor the drawing actually stores.
     *  Parallel channel: its 3rd anchor is the parallel-line price measured AT THE
     *  BASELINE MIDPOINT (its time is ignored). The cursor, though, sits near p2, so
     *  storing it raw would read as an offset of ≈ half the baseline's price span and
     *  snap the channel wide open. Instead measure the cursor's vertical gap from the
     *  baseline at its own time and re-express that as the midpoint price, so the
     *  channel line simply passes through the cursor. Every other type is unchanged. */
    private placementAnchor(draft: Drawing, cursor: DrawingPoint): DrawingPoint {
        if (draft.type !== 'parallelchannel' || draft.anchors.length !== 2) return cursor;
        const a = draft.anchors[0]!;
        const b = draft.anchors[1]!;
        const span = b.time - a.time;
        const baseAtCursor = span === 0 ? a.price : a.price + ((b.price - a.price) * (cursor.time - a.time)) / span;
        const gap = cursor.price - baseAtCursor;
        return { time: (a.time + b.time) / 2, price: (a.price + b.price) / 2 + gap };
    }

    /** Sample a freehand point while dragging (raw / unsnapped), capped at the path max. */
    private captureFreehand(x: number, y: number): void {
        if (this.state.kind !== 'placing') return;
        this.snapAt = null;
        const draft = this.state.draft;
        const proj = this.deps.projector();
        const last = draft.anchors[draft.anchors.length - 1];
        const lx = last ? proj.xOf(last.time) : NaN;
        const ly = last ? proj.yOf(last.price, draft.paneId) ?? NaN : NaN;
        if (draft.anchors.length < this.state.need && Math.hypot(x - lx, y - ly) > FREEHAND_SAMPLE_PX) {
            draft.anchors.push(proj.pxToPoint(x, y, draft.paneId));
        }
        this.state.cursor = proj.pxToPoint(x, y, draft.paneId);
        this.deps.changed();
    }

    /** Finish a variable click-placement (polyline). `dropLast` removes the duplicate point a
     *  double-click adds. Returns whether a drawing was committed. */
    finishPlacing(dropLast: boolean): boolean {
        if (this.state.kind !== 'placing') return false;
        const draft = this.state.draft;
        const sch = draft.anchorSchema();
        if (draft.placementMode() !== 'click' || sch.max <= sch.min) return false; // only variable click tools
        if (dropLast && draft.anchors.length > sch.min) draft.anchors.pop();
        if (draft.anchors.length < sch.min) return false;
        this.finalize();
        return true;
    }

    /** Abandon an in-progress placement (too few points) and disarm. */
    private discardPlacing(): void {
        if (this.state.kind !== 'placing') return;
        const type = this.state.draft.type;
        this.state = { kind: 'idle' };
        this.deps.emit({ kind: 'tool-finished', type });
        this.deps.changed();
    }

    private finalize(): void {
        if (this.state.kind !== 'placing') return;
        this.snapAt = null;
        const draft = this.state.draft;
        draft.onPlaced(this.deps.projector()); // let the type finalize its anchors (e.g. a position derives its box)
        const type = draft.type;
        this.state = { kind: 'idle' };
        this.deps.emit({ kind: 'create', doc: draft.serialize() });
        this.deps.emit({ kind: 'tool-finished', type });
        this.deps.changed();
    }

    /** A showing handle (any selected/hovered drawing) — even off the body, e.g. an ellipse's
     *  bounding-box corners — wins; otherwise the topmost drawing whose body is under (x,y). */
    private hitAt(x: number, y: number): Drawing | null {
        const proj = this.deps.projector();
        for (const d of this.handleDrawings()) {
            if (d.hitHandle(x, y, proj, HIT_TOLERANCE) >= 0) return d;
        }
        return topDrawingAt(this.deps.drawings(), x, y, proj, HIT_TOLERANCE);
    }

    /** Drawings whose handles are currently shown (selected ∪ hovered) — their handles are grabbable. */
    private handleDrawings(): Drawing[] {
        const ids = new Set<string>(this.deps.selectedIds());
        const hov = this.deps.hoveredId();
        if (hov) ids.add(hov);
        const out: Drawing[] = [];
        for (const id of ids) {
            const d = this.byId(id);
            if (d) out.push(d);
        }
        return out;
    }

    private byId(id: string): Drawing | null {
        return this.deps.drawings().find((d) => d.id === id) ?? null;
    }
}

function cloneAnchors(d: Drawing): DrawingPoint[] {
    return d.anchors.map((a) => ({ time: a.time, price: a.price }));
}

/** Move an anchor toward `pt`, honoring which axes its handle is free to move along. */
function applyFree(anchor: DrawingPoint, pt: DrawingPoint, free: FreeAxis): void {
    if (free === 'both' || free === 'x') anchor.time = pt.time;
    if (free === 'both' || free === 'y') anchor.price = pt.price;
}
