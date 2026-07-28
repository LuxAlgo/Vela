import type { VelaTheme } from '../../../core/options';
import type {
    Drawing,
    DrawingIntent,
    DrawingMode,
    DrawingPoint,
    DrawingTypeKey,
    IDrawingsRendererPort,
    Projector,
    SerializedDrawing,
    SnapMode,
    ToolbarDefinition,
} from '../../../core/drawings';
import { deserializeDrawing, resetDrawingSettings, Callout } from '../../../core/drawings';
import type { Unsubscribe } from '../../../core/util/types';
import { namedFontSize } from '../../shared/drawing-geometry';
import { blendOver, splitColor } from './colorPicker';
import { DrawingPainter } from './DrawingPainter';
import { DrawingInteraction } from './DrawingInteraction';
import { DrawingSettingsPopup } from './DrawingSettingsPopup';
import { DrawingToolbar } from './DrawingToolbar';
import { MeasureOverlay } from './MeasureOverlay';
import { topDrawingAt, HIT_TOLERANCE } from './DrawingHitTester';
import { keyToDrawingAction, isEditingText } from './DrawingKeys';

/** What the controller needs from the native renderer (coords + theme + dpr). */
export interface UserDrawingDeps {
    projector(): Projector;
    dpr(): number;
    theme(): VelaTheme;
    /** Ask the renderer to recompute per-pane autoscale (so a drawing folds into the price range). */
    requestScaleUpdate(): void;
    /** Snap a data point to the nearest candle (time + OHLC), per magnet `mode` + the cursor pixel. */
    snap(point: DrawingPoint, paneId: string, mode: SnapMode, cursorPx?: { x: number; y: number }): DrawingPoint;
    /** Set the sticky magnet mode (driven by the toolbar's 3-state button). */
    setSnapMode(mode: SnapMode): void;
    /** Reserve (or release) the left gutter for the docked toolbar — the plot insets to its right. */
    setToolbarGutter(visible: boolean): void;
}

/**
 * The native renderer's implementation of {@link IDrawingsRendererPort}. Owns the
 * L1.5 drawings canvas (paint), the interaction state machine (place/select), the
 * settings popup, and hit-testing. The core `DrawingController` is the source of
 * truth — this projects its `syncDrawings` snapshots and reports gestures back as
 * intents. It never holds authoritative state beyond the current projection.
 */
export class UserDrawingController implements IDrawingsRendererPort {
    private ctx: CanvasRenderingContext2D | null = null;
    private drawings: Drawing[] = [];
    private selectedIds = new Set<string>(); // selected drawings (handles shown); [first] drives the popup
    private hoveredId: string | null = null; // the drawing under the cursor (its handles show)
    private activeTool: DrawingTypeKey | null = null;
    private activeToolStyle: SerializedDrawing['style'] | undefined; // last-used style for the armed tool (seeds the placement ghost)
    private intentCb: ((i: DrawingIntent) => void) | null = null;
    private readonly measure = new MeasureOverlay(); // transient ruler — not a persistent drawing
    private measureMode = false; // the ruler is armed (placing a measurement)
    private eraserMode = false; // click/drag over a drawing deletes it
    private erasing = false; // a button is held during eraser mode (so a drag erases multiple)
    private calloutEditor: HTMLTextAreaElement | null = null; // inline text editor for the focused callout

    private readonly painter = new DrawingPainter();
    private readonly interaction: DrawingInteraction;
    private readonly popup: DrawingSettingsPopup;
    private readonly toolbar: DrawingToolbar;

    constructor(
        private readonly toolbarHost: HTMLElement, // the left gutter (docked toolbar)
        private readonly overlayHost: HTMLElement, // the inset plot (settings popup + inline editor float over drawings)
        private readonly canvas: HTMLCanvasElement,
        private readonly deps: UserDrawingDeps,
    ) {
        this.ctx = canvas.getContext('2d');
        this.popup = new DrawingSettingsPopup(overlayHost, deps.theme());
        this.toolbar = new DrawingToolbar(
            toolbarHost,
            deps.theme(),
            (type) => this.emit({ kind: 'arm', type }),
            (mode) => {
                this.deps.setSnapMode(mode);
                this.emit({ kind: 'snap-mode', mode }); // keep the core mirror (+ external toolbars) in sync
            },
            () => this.withModeIntent(() => this.toggleMeasure()),
            () => this.withModeIntent(() => this.toggleEraser()),
            (type, on) => this.emit({ kind: 'favorite', type, on }),
        );
        this.interaction = new DrawingInteraction({
            projector: () => this.deps.projector(),
            activeTool: () => this.activeTool,
            drawings: () => this.drawings,
            hoveredId: () => this.hoveredId,
            selectedIds: () => this.selectedIds,
            emit: (i) => this.emit(i),
            changed: () => this.render(),
            openSettings: (id, x, y) => this.openSettingsById(id, x, y),
            snap: (pt, paneId, mode, cursorPx) => this.deps.snap(pt, paneId, mode, cursorPx),
            lastStyle: () => this.activeToolStyle,
        });
    }

    // ── IDrawingsRendererPort (commands down) ──
    setToolbar(def: ToolbarDefinition): void {
        this.toolbar.setDefinition(def);
    }

    showToolbar(visible: boolean): void {
        this.toolbar.setVisible(visible);
        this.deps.setToolbarGutter(visible); // reserve/release the left gutter so the bar never overlaps the plot
    }

    syncDrawings(docs: readonly SerializedDrawing[]): void {
        this.drawings = docs.map((d) => deserializeDrawing(d)).filter((d): d is Drawing => d != null);
        this.render();
        this.deps.requestScaleUpdate(); // fold drawing price ranges into autoscale
    }

    /**
     * Union of the visible drawings' price ranges on `paneId` whose time extent
     * intersects [fromTime, toTime] — folded into the pane's autoscale so an
     * off-series drawing still expands the scale (mirrors Pine drawings). Hidden
     * drawings and full-width references (hline → null extent) are handled too.
     */
    priceRangeForPane(paneId: string, fromTime: number, toTime: number): { min: number; max: number } | null {
        let lo = Infinity;
        let hi = -Infinity;
        for (const d of this.drawings) {
            if (!d.visible || d.paneId !== paneId) continue;
            const ext = d.timeExtent();
            if (ext && (ext.max < fromTime || ext.min > toTime)) continue; // off-screen in time
            const pr = d.priceRange();
            if (!pr) continue;
            if (pr.min < lo) lo = pr.min;
            if (pr.max > hi) hi = pr.max;
        }
        return lo <= hi ? { min: lo, max: hi } : null;
    }

    setActiveTool(type: DrawingTypeKey | null, lastStyle?: SerializedDrawing['style']): void {
        if (type != null) {
            this.closeCalloutEditor(); // arming a real tool cancels an open inline editor
            // Picking a drawing tool cancels the ruler and the eraser — a mutual-exclusion
            // side effect the core (and any external toolbar) learns via the mode intent.
            this.withModeIntent(() => {
                if (this.measureMode) this.exitMeasure();
                if (this.eraserMode) this.exitEraser();
            });
        }
        this.activeTool = type;
        this.activeToolStyle = lastStyle; // seeds the placement ghost so it matches the last-used color
        this.toolbar.setActiveTool(type);
        if (type == null) this.interaction.onToolCleared();
        else this.clearSelection(); // arming a tool dismisses an open settings popup + selection
        this.render();
    }

    /** Core push: the favorite tool set changed — reflect the flyout stars. */
    setFavorites(types: readonly DrawingTypeKey[]): void {
        this.toolbar.setFavorites(types);
    }

    /** Core push: set the sticky magnet mode. Applies to the renderer + reflects on the
     *  in-chart toolbar WITHOUT notifying back (the caller already holds the value). */
    setSnapMode(mode: SnapMode): void {
        this.deps.setSnapMode(mode);
        this.toolbar.setMagnetMode(mode);
    }

    /** Core push: enter/exit measure or eraser (`null` = none). Reuses the toolbar
     *  toggles so the mutual exclusion (and the button highlights) stay in one place;
     *  any ACTUAL change is reported back through the mode intent. */
    setMode(mode: DrawingMode): void {
        this.withModeIntent(() => {
            if (mode === 'measure') {
                if (!this.measureMode) this.toggleMeasure();
            } else if (mode === 'eraser') {
                if (!this.eraserMode) this.toggleEraser();
            } else {
                if (this.measureMode) this.exitMeasure();
                if (this.eraserMode) this.exitEraser();
            }
        });
    }

    /** The current renderer-local mode (measure/eraser/none). */
    private modeOf(): DrawingMode {
        return this.measureMode ? 'measure' : this.eraserMode ? 'eraser' : null;
    }

    /** Run a state transition and report the mode ONCE if it actually changed — the
     *  single choke point that keeps toggles, mutual exclusions, and core pushes from
     *  double-emitting (an equal-value intent is dropped core-side anyway). */
    private withModeIntent(fn: () => void): void {
        const before = this.modeOf();
        fn();
        const after = this.modeOf();
        if (after !== before) this.emit({ kind: 'mode', mode: after });
    }

    setSelection(ids: readonly string[]): void {
        this.selectedIds = new Set(ids);
        this.render();
    }

    /** Programmatic twin of clicking the drawing: highlight it + float its settings popup. */
    openSettings(id: string): void {
        this.openSettingsById(id, 0, 0);
    }

    onDrawingIntent(cb: (intent: DrawingIntent) => void): Unsubscribe {
        this.intentCb = cb;
        return () => {
            if (this.intentCb === cb) this.intentCb = null;
        };
    }

    // ── pointer/keyboard entry points (driven by InputController/KeyboardController) ──
    /** Should the drawing layer win this press (vs pan)? */
    claim(x: number, y: number): boolean {
        if (this.measureMode || this.eraserMode) return true; // these modes capture their clicks (no pan)
        return this.interaction.claim(x, y);
    }

    /** Delete the (unlocked) drawing under the cursor, if any. Shared by eraser click + drag. */
    private eraseAt(x: number, y: number): void {
        const hit = topDrawingAt(this.drawings, x, y, this.deps.projector(), HIT_TOLERANCE);
        if (hit && !hit.locked) this.emit({ kind: 'delete', ids: [hit.id] });
    }

    /** Clear a finished transient measurement (the ruler vanishes on the next press / pan / zoom). */
    clearTransient(): void {
        if (this.measure.isFinished()) {
            this.measure.clear();
            this.render();
        }
    }

    pointerDown(x: number, y: number, snap: SnapMode = 'off', shift = false): void {
        if (this.eraserMode) {
            this.erasing = true; // hold to drag-erase across multiple drawings
            this.eraseAt(x, y);
            return;
        }
        if (this.measureMode) {
            this.measure.down(x, y);
            // 2nd click finishes → disarm (reported as a mode change), keep the ruler shown.
            if (this.measure.isFinished()) this.withModeIntent(() => this.exitMeasure(false));
            this.render();
            return;
        }
        this.interaction.down(x, y, snap, shift); // the popup self-dismisses on any outside press
    }

    pointerMove(x: number, y: number, snap: SnapMode = 'off'): void {
        if (this.eraserMode) {
            if (this.erasing) this.eraseAt(x, y); // erase only while the button is held (not on hover)
            return;
        }
        if (this.measureMode) {
            this.measure.move(x, y); // click-move-click: the cursor sizes the ruler with no button down
            this.render();
            return;
        }
        this.interaction.move(x, y, snap);
        this.updateHover(x, y); // show handles for the drawing under the cursor
    }

    /** Track which drawing is hovered so its handles appear on hover (and only then). */
    private updateHover(x: number, y: number): void {
        let id: string | null = null;
        if (this.activeTool == null && !this.interaction.isPlacing() && !this.interaction.isDragging()) {
            id = topDrawingAt(this.drawings, x, y, this.deps.projector(), HIT_TOLERANCE)?.id ?? null;
        }
        if (id !== this.hoveredId) {
            this.hoveredId = id;
            this.render();
        }
    }

    pointerUp(x: number, y: number): void {
        if (this.eraserMode) {
            this.erasing = false;
            return;
        }
        if (this.measureMode) {
            this.measure.up(x, y); // press-drag-release finishes the ruler in one gesture
            if (this.measure.isFinished()) this.withModeIntent(() => this.exitMeasure(false));
            this.render();
            return;
        }
        this.interaction.up(x, y); // commit a drag, or open settings on a no-move click
    }

    /** Toggle the transient ruler. Arming it clears any drawing tool + selection. */
    private toggleMeasure(): void {
        if (this.measureMode) {
            this.exitMeasure();
            return;
        }
        if (this.eraserMode) this.exitEraser(); // only one renderer-local mode at a time
        this.measure.clear();
        this.measureMode = true;
        this.emit({ kind: 'arm', type: null }); // clear any armed drawing tool (core-authoritative)
        this.clearSelection();
        this.toolbar.setMeasureActive(true);
        this.render();
    }

    /** Toggle the eraser: click/drag over a drawing to delete it. Mutually exclusive with the
     *  ruler + any armed drawing tool. */
    private toggleEraser(): void {
        if (this.eraserMode) {
            this.exitEraser();
            return;
        }
        if (this.measureMode) this.exitMeasure();
        this.eraserMode = true;
        this.erasing = false;
        this.emit({ kind: 'arm', type: null }); // drop any armed drawing tool
        this.clearSelection();
        this.toolbar.setEraserActive(true);
        this.render();
    }

    private exitEraser(): void {
        this.eraserMode = false;
        this.erasing = false;
        this.toolbar.setEraserActive(false);
        this.render();
    }

    /** Leave ruler mode. `clearGraphic` keeps a just-finished measurement on screen (false). */
    private exitMeasure(clearGraphic = true): void {
        this.measureMode = false;
        if (clearGraphic) this.measure.clear();
        this.toolbar.setMeasureActive(false);
        this.render();
    }

    /** Open an inline textarea over a callout's box so its text is edited directly on the chart
     *  (click the text field and type). Commits on blur / Enter, cancels on Escape. */
    private editCalloutInline(id: string): void {
        const d = this.drawings.find((x) => x.id === id);
        if (!(d instanceof Callout)) return;
        this.closeCalloutEditor();
        this.popup.close();
        const box = d.box(this.deps.projector());
        if (!box) return;
        const theme = this.deps.theme();
        const fs = namedFontSize(d.text?.size ?? 'normal');
        const ta = document.createElement('textarea');
        ta.value = d.text?.value ?? '';
        ta.spellcheck = false;
        ta.style.cssText =
            `position:absolute;left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${Math.round(box.w)}px;height:${Math.round(box.h)}px;` +
            `z-index:24;box-sizing:border-box;resize:none;overflow:hidden;margin:0;padding:5px 8px;border-radius:5px;` +
            `border:1px solid ${d.style.lineColor ?? theme.borderColor};background:${blendOver(d.style.fillColor ?? theme.background, theme.background, splitColor(d.style.fillColor ?? theme.background).alpha)};color:${d.text?.color ?? theme.textColor};` +
            `font:${fs}px ${theme.fontFamily};text-align:left;outline:none;pointer-events:auto;`;
        ta.addEventListener('input', () => {
            d.applySettings({ 'text.value': ta.value });
            this.render(); // live: keep the canvas bubble sized to the text
            const b = d.box(this.deps.projector());
            if (b) {
                ta.style.left = `${Math.round(b.x)}px`;
                ta.style.top = `${Math.round(b.y)}px`;
                ta.style.width = `${Math.round(b.w)}px`;
                ta.style.height = `${Math.round(b.h)}px`;
            }
        });
        ta.addEventListener('pointerdown', (e) => e.stopPropagation());
        ta.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                ta.blur();
            }
        });
        ta.addEventListener('blur', () => {
            d.applySettings({ 'text.value': ta.value });
            this.emit({ kind: 'edit', doc: d.serialize() });
            this.closeCalloutEditor();
        });
        this.overlayHost.appendChild(ta);
        this.calloutEditor = ta;
        ta.focus();
        ta.select();
    }

    private closeCalloutEditor(): void {
        const ta = this.calloutEditor;
        if (!ta) return;
        this.calloutEditor = null; // null first: removing a focused textarea fires blur → re-entrant close
        ta.remove();
        this.render();
    }

    /** Cursor hint while hovering — `'pointer'` over a drawing/handle, else null. */
    cursorAt(x: number, y: number): string | null {
        if (this.eraserMode) return 'pointer'; // signal "click to delete" while erasing
        return this.interaction.cursorAt(x, y);
    }

    /** Double-click over a drawing → suppress the chart's view reset (single-click already
     *  opens settings). Returns true only when a drawing is under the cursor. */
    dblClick(x: number, y: number): boolean {
        if (this.interaction.finishPlacing(true)) return true; // double-click finishes a polyline (drops the dup point)
        const hit = topDrawingAt(this.drawings, x, y, this.deps.projector(), HIT_TOLERANCE);
        if (hit instanceof Callout) {
            this.editCalloutInline(hit.id); // double-click a callout → edit its text in place
            return true;
        }
        return hit != null;
    }

    /** Keyboard pre-empt: Escape (popup/placing/selection), undo/redo, copy/paste/duplicate,
     *  delete (multi), and arrow-nudge. Stands down while a label text field is focused. */
    handleKey(e: KeyboardEvent): boolean {
        if (e.key === 'Escape') {
            if (this.popup.isOpen()) {
                this.clearSelection();
                return true;
            }
            if (this.interaction.cancel()) return true;
            if (this.selectedIds.size) {
                this.clearSelection();
                return true;
            }
            return false;
        }
        if (e.key === 'Enter' && this.interaction.finishPlacing(false)) return true; // Enter finishes a polyline
        const action = keyToDrawingAction(e, {
            hasSelection: this.selectedIds.size > 0,
            hasTarget: this.selectedIds.size > 0 || this.hoveredId != null,
            editingText: isEditingText(e.target),
        });
        if (!action) return false;
        switch (action.kind) {
            case 'undo':
                this.emit({ kind: 'undo' });
                break;
            case 'redo':
                this.emit({ kind: 'redo' });
                break;
            case 'copy':
                this.emit({ kind: 'copy', ids: this.selectionIds() });
                break;
            case 'paste':
                this.emit({ kind: 'paste' });
                break;
            case 'duplicate':
                this.emit({ kind: 'duplicate', ids: this.selectionIds() });
                break;
            case 'delete': {
                const ids = this.selectedIds.size ? this.selectionIds() : this.hoveredId ? [this.hoveredId] : [];
                if (ids.length) {
                    this.popup.close();
                    this.emit({ kind: 'delete', ids });
                }
                break;
            }
            case 'nudge':
                this.nudgeSelection(action.dx, action.dy);
                break;
        }
        return true;
    }

    private selectionIds(): string[] {
        return [...this.selectedIds];
    }

    /** Move every selected (unlocked) drawing by a pixel delta — one edit/edit-many → one undo step. */
    private nudgeSelection(dx: number, dy: number): void {
        const proj = this.deps.projector();
        const docs: SerializedDrawing[] = [];
        for (const d of this.drawings) {
            if (!this.selectedIds.has(d.id) || d.locked) continue;
            const anchors = d.anchors.map((a) => {
                const y = proj.yOf(a.price, d.paneId);
                return y == null ? { time: a.time, price: a.price } : proj.pxToPoint(proj.xOf(a.time) + dx, y + dy, d.paneId);
            });
            const doc = d.serialize();
            doc.anchors = anchors;
            docs.push(doc);
        }
        if (docs.length === 1) this.emit({ kind: 'edit', doc: docs[0]! });
        else if (docs.length > 1) this.emit({ kind: 'edit-many', docs });
    }

    // ── lifecycle ──
    setTheme(theme: VelaTheme): void {
        this.popup.setTheme(theme);
        this.toolbar.setTheme(theme);
        this.render();
    }

    onResize(): void {
        this.closeCalloutEditor();
        this.popup.close();
        this.render();
    }

    /** Repaint the drawings layer (called every data frame + on internal changes). */
    render(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const dpr = this.deps.dpr();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        const proj = this.deps.projector();
        // Handles show for the selected drawings, the one being dragged, and the one under
        // the cursor — so they appear on hover/selection and vanish when you leave / deselect.
        const highlight = new Set(this.selectedIds);
        const drag = this.interaction.activeDragId();
        if (drag) highlight.add(drag);
        if (this.hoveredId) highlight.add(this.hoveredId);
        this.painter.paintAll(ctx, this.drawings, proj, this.deps.theme(), highlight);
        const ghost = this.interaction.ghost();
        if (ghost) this.painter.paintGhost(ctx, ghost, proj, this.deps.theme());
        // While placing, show control circles on the points clicked so far (so the user
        // sees where each anchor — e.g. a pitchfork's pivot — landed before it completes).
        const markers = this.interaction.placingMarkers(proj);
        if (markers) this.painter.paintHandles(ctx, markers);
        // Magnet (Ctrl) affordance: a ring on the candle point the next anchor will snap to.
        const m = this.interaction.snapMarker();
        const my = m ? proj.yOf(m.point.price, m.paneId) : null;
        if (m && my != null) this.painter.paintSnapRing(ctx, proj.xOf(m.point.time), my, this.deps.theme());
        // The transient ruler paints on top of everything (until cleared on the next press/pan/zoom).
        if (this.measure.isActive()) this.measure.paint(ctx, proj, this.deps.theme());
    }

    destroy(): void {
        this.closeCalloutEditor();
        this.popup.destroy();
        this.toolbar.destroy();
        this.intentCb = null;
        this.drawings = [];
    }

    /** Mark nothing as edited: close the popup + clear the selection (handles then follow hover). */
    private clearSelection(): void {
        this.popup.close();
        if (this.selectedIds.size) this.emit({ kind: 'select', ids: [] });
        this.render();
    }

    /** A click on a drawing opens its settings toolbar (text labels edit text here too). */
    private openSettingsById(id: string, _x: number, _y: number): void {
        const drawing = this.drawings.find((d) => d.id === id);
        if (!drawing) return;
        const live = (): Drawing | undefined => this.drawings.find((d) => d.id === id);
        this.emit({ kind: 'select', ids: [id] }); // editing this drawing → it stays highlighted while the popup is open
        this.emit({ kind: 'settings', id });
        const anchor = drawing.bounds(this.deps.projector()); // float the toolbar clear of the drawing
        this.popup.open(drawing, anchor, {
            patch: (p) => {
                const d = live();
                if (!d) return;
                d.applySettings(p);
                this.render();
                this.emit({ kind: 'edit', doc: d.serialize() });
            },
            setLocked: (v) => {
                const d = live();
                if (!d) return;
                d.locked = v;
                this.emit({ kind: 'edit', doc: d.serialize() });
            },
            reorder: (to) => this.emit({ kind: 'reorder', id, to }),
            resetSettings: () => {
                const d = live();
                if (!d) return;
                resetDrawingSettings(d);
                this.render();
                this.emit({ kind: 'edit', doc: d.serialize() });
                // Rebuild the toolbar so controls reflect the restored defaults.
                this.openSettingsById(id, 0, 0);
            },
            remove: () => {
                this.popup.close();
                this.emit({ kind: 'delete', ids: [id] });
            },
        }, () => this.clearSelection()); // dismiss-on-outside-click also clears the selection/highlight
    }

    private emit(i: DrawingIntent): void {
        // A freshly-placed drawing surfaces its editing UI by default once it's set: a callout opens
        // its inline text editor, every other type opens its settings menu. Works for both click +
        // drag finalize — the core reassigns the id, so we diff the drawing set around the create to
        // find the new one.
        if (i.kind === 'create') {
            const before = new Set(this.drawings.map((d) => d.id));
            this.intentCb?.(i);
            // Defer past the sync + the placing click (which would otherwise steal focus / dismiss
            // the popup) before opening the editing UI on the new drawing.
            setTimeout(() => {
                const fresh = this.drawings.find((d) => !before.has(d.id));
                if (!fresh) return;
                if (fresh instanceof Callout) this.editCalloutInline(fresh.id);
                else this.openSettingsById(fresh.id, 0, 0);
            }, 0);
            return;
        }
        this.intentCb?.(i);
    }
}
