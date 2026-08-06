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
import { deserializeDrawing, resetDrawingSettings, Callout, TextLabel } from '../../../core/drawings';
import type { Unsubscribe } from '../../../core/util/types';
import { contrastColor, namedFontSize, labelLineHeight, TEXT_FRAME_INSET, TEXT_FRAME_RISE } from '../../shared/drawing-geometry';
import { withAlpha } from '../core/chartConfig';
import { blendOver, splitColor } from './colorPicker';
import { DrawingPainter, handleIdsFor, type PaintTargets } from './DrawingPainter';
import { DrawingInteraction } from './DrawingInteraction';
import { DrawingSettingsPopup } from './DrawingSettingsPopup';
import { DrawingToolbar, TOOLBAR_WIDTH, TOOLBAR_COLLAPSED_WIDTH } from './DrawingToolbar';
import { MeasureOverlay } from './MeasureOverlay';
import { topDrawingAt, HIT_TOLERANCE } from './DrawingHitTester';
import { keyToDrawingAction, isEditingText } from './DrawingKeys';
import type { DrawingSlice } from '../core/SceneGraph';

/** Shown in the inline editor while a label carries no text yet. */
const TEXT_PLACEHOLDER = 'Enter Text';
/** Extra width past the measured glyphs so the caret has somewhere to sit. */
const CARET_ROOM = 8;
/** The editor's border weight; its padding is the shared TEXT_FRAME inset/rise minus this, so the
 *  border lands exactly on the frame the painter draws — the box doesn't move when editing starts. */
const EDITOR_BORDER = 1;

/** The drawings whose text is typed straight onto the chart rather than through the settings popup. */
type InlineEditable = Callout | TextLabel;

function isInlineEditable(d: Drawing | null | undefined): d is InlineEditable {
    return d instanceof Callout || d instanceof TextLabel;
}

/** What the controller needs from the native renderer (coords + theme + dpr). */
export interface UserDrawingDeps {
    projector(): Projector;
    dpr(): number;
    theme(): VelaTheme;
    /** Ask the renderer to recompute per-pane autoscale (so a drawing folds into the price range). */
    requestScaleUpdate(): void;
    /** The pane's series z keys (candles + indicators), ascending — the boundaries a drawing's
     *  z is slotted against to decide which interleave layer (if any) it paints on. */
    seriesBoundaries(paneId: string): readonly number[];
    /** The candles' own z key, or null off the price pane — a new drawing starts just under it. */
    priceZ(paneId: string): number | null;
    /** Ask the renderer for a data-layer repaint — needed when a drawing that paints INSIDE the
     *  series stack changed, since its pixels live in the backend composite, not on this layer. */
    requestDataPaint(): void;
    /** Snap a data point to the nearest candle (time + OHLC), per magnet `mode` + the cursor pixel. */
    snap(point: DrawingPoint, paneId: string, mode: SnapMode, cursorPx?: { x: number; y: number }): DrawingPoint;
    /** Set the sticky magnet mode (driven by the toolbar's 3-state button). */
    setSnapMode(mode: SnapMode): void;
    /** Reserve `px` of left gutter for the docked toolbar (0 releases it) — the plot insets to its right. */
    setToolbarGutter(px: number): void;
}

/** No interaction targets on the interleave layers — handles always paint in front. */
const EMPTY_TARGETS: PaintTargets = {};

/**
 * Which interleave layer a drawing belongs to: the first series boundary at-or-above its z —
 * the slice painted just before that series, so a drawing TYING a series' z paints under it.
 * Null when the drawing clears every boundary and belongs on the top canvas instead.
 */
export function sliceKeyFor(zIndex: number, boundaries: readonly number[]): number | null {
    if (boundaries.length === 0 || zIndex > boundaries[boundaries.length - 1]!) return null;
    return boundaries.find((b) => b >= zIndex)!;
}

/**
 * The native renderer's implementation of {@link IDrawingsRendererPort}. Owns the top
 * drawings canvas (L1.5, over the series) plus the INTERLEAVE layers — prepainted
 * plot-sized canvases handed to the geometry backend for the drawings whose z puts
 * them under a series (below the candles, between two indicators) — the interaction
 * state machine (place/select), the settings popup, and hit-testing. The core
 * `DrawingController` is the source of truth — this projects its `syncDrawings`
 * snapshots and reports gestures back as intents. It never holds authoritative
 * state beyond the current projection.
 */
export class UserDrawingController implements IDrawingsRendererPort {
    private ctx: CanvasRenderingContext2D | null = null;
    private drawings: Drawing[] = [];
    /** Ids painted on an interleave layer this frame — the top canvas paints only their handles. */
    private sliced = new Set<string>();
    /** Cached slice canvases, keyed `paneId|beforeZ`, reused across frames to avoid churn. */
    private readonly sliceCache = new Map<string, HTMLCanvasElement>();
    /** Series boundaries per pane as of the last `prepareSlices` — lets a repaint between data
     *  frames split front/interleaved consistently instead of flickering a drawing onto the
     *  wrong layer for a frame. */
    private lastBounds = new Map<string, readonly number[]>();
    private selectedIds = new Set<string>(); // selected drawings (handles shown); [first] drives the popup
    private hoveredId: string | null = null; // the drawing under the cursor (its handles show)
    private activeTool: DrawingTypeKey | null = null;
    private activeToolStyle: SerializedDrawing['style'] | undefined; // last-used style for the armed tool (seeds the placement ghost)
    private intentCb: ((i: DrawingIntent) => void) | null = null;
    /** Another chart's in-progress placement, mirrored here as a ghost (drawings sync). */
    private externalGhost: Drawing | null = null;
    /** Last draft fingerprint reported upstream — gates the per-render emission to actual changes. */
    private lastDraftKey: string | null = null;
    private readonly measure = new MeasureOverlay(); // transient ruler — not a persistent drawing
    private toolbarVisible = false; // mirrors showToolbar (drives the gutter reservation)
    private toolbarCollapsed = false; // the bar is a slim expand-strip (narrower gutter)
    /** Self-serve Ctrl+Z / Ctrl+Y as drawing undo/redo. A host that owns a UNIFIED
     *  history (drawings + app ops in one timeline) turns this off so the chords
     *  bubble to its keymap instead — see the renderer's `historyChords` feature. */
    historyChords = true;
    private measureMode = false; // the ruler is armed (placing a measurement)
    private eraserMode = false; // click/drag over a drawing deletes it
    private erasing = false; // a button is held during eraser mode (so a drag erases multiple)
    // The inline on-chart text editor: its element, the id of the drawing it edits, the text it
    // opened with (so Escape can put it back), and the text the core currently holds (so an edit is
    // reported exactly when it actually changes).
    private textEditor: { el: HTMLTextAreaElement; id: string; initial: string; stored: string } | null = null;

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
            (on) => this.emit({ kind: 'stay-mode', on }),
            {
                onCollapse: (collapsed) => {
                    this.toolbarCollapsed = collapsed;
                    this.syncToolbarGutter();
                },
            },
        );
        this.interaction = new DrawingInteraction({
            projector: () => this.deps.projector(),
            activeTool: () => this.activeTool,
            drawings: () => this.drawings,
            hoveredId: () => this.hoveredId,
            selectedIds: () => this.selectedIds,
            emit: (i) => this.emit(i),
            changed: () => {
                this.invalidateSlices(); // a live drag can be moving a drawing that paints inside the stack
                this.render();
            },
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
        this.toolbarVisible = visible;
        this.toolbar.setVisible(visible);
        this.syncToolbarGutter(); // reserve/release the left gutter so the bar never overlaps the plot
    }

    /** The gutter follows the bar's current footprint: hidden 0, collapsed a slim strip, else full width. */
    private syncToolbarGutter(): void {
        this.deps.setToolbarGutter(this.toolbarVisible ? (this.toolbarCollapsed ? TOOLBAR_COLLAPSED_WIDTH : TOOLBAR_WIDTH) : 0);
    }

    /** Core push: mirror (or clear) another chart's in-progress placement as a ghost. */
    setExternalGhost(doc: SerializedDrawing | null): void {
        this.externalGhost = doc ? deserializeDrawing(doc) : null;
        this.render();
    }

    syncDrawings(docs: readonly SerializedDrawing[]): void {
        this.drawings = docs.map((d) => deserializeDrawing(d)).filter((d): d is Drawing => d != null);
        // The edited drawing can vanish from under the editor (deleted, erased, undone) — take the
        // editor with it instead of leaving a live textarea over nothing.
        if (this.textEditor && !this.editedDrawing(this.textEditor.id)) this.closeTextEditor();
        this.invalidateSlices();
        this.render();
        this.deps.requestScaleUpdate(); // fold drawing price ranges into autoscale
    }

    /** The pane's series stack in z terms — how the core places a new drawing (just under
     *  `price`) and computes "front of everything" / "behind everything" for the reorders. */
    stackRange(paneId: string): { front: number; back: number; price?: number } {
        const b = this.deps.seriesBoundaries(paneId);
        return { front: Math.max(0, ...b), back: Math.min(0, ...b), price: this.deps.priceZ(paneId) ?? undefined };
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
            this.finishTextEditor(true); // arming a real tool ends an open inline edit (keeping the text)
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

    /** Core push: per-tool shortcut hints (display strings) shown in the toolbar flyouts. */
    setToolShortcuts(map: Readonly<Partial<Record<DrawingTypeKey, string>>>): void {
        this.toolbar.setShortcuts(map);
    }

    /** Core push: set the sticky magnet mode. Applies to the renderer + reflects on the
     *  in-chart toolbar WITHOUT notifying back (the caller already holds the value). */
    setSnapMode(mode: SnapMode): void {
        this.deps.setSnapMode(mode);
        this.toolbar.setMagnetMode(mode);
    }

    /** Core push: stay-in-drawing-mode — reflect on the toolbar without notifying back. */
    setStayMode(on: boolean): void {
        this.toolbar.setStayMode(on);
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

    /** Delete the (unlocked) drawing under the cursor. True when one was removed.
     *  Shared by the eraser (click + drag) and the middle-click shortcut. */
    deleteAt(x: number, y: number): boolean {
        const hit = topDrawingAt(this.drawings, x, y, this.deps.projector(), HIT_TOLERANCE);
        if (!hit || hit.locked) return false;
        this.popup.close();
        this.emit({ kind: 'delete', ids: [hit.id] });
        return true;
    }

    /** Shift+press on the empty plot: arm the measure ruler AND start it at (x, y) in one
     *  gesture — the equivalent of clicking the toolbar's Measure button, then pressing.
     *  Returns false when a mode/tool is already active (the normal press path owns it). */
    beginMeasureAt(x: number, y: number): boolean {
        if (this.measureMode || this.eraserMode || this.activeTool != null) return false;
        this.withModeIntent(() => this.toggleMeasure());
        this.measure.down(x, y);
        this.render();
        return true;
    }

    /** A press landed on the chart: a finished transient measurement clears (the ruler vanishes on the
     *  next press / pan / zoom), and an open inline edit ends. This runs for EVERY press, including the
     *  ones the drawings layer doesn't claim — a press on empty chart is a pan, and the editor may not
     *  hold focus (the settings popup can), so neither `pointerDown` nor blur would end the edit. */
    clearTransient(): void {
        if (this.textEditor) this.finishTextEditor(true); // clicking off the text keeps what was typed
        if (this.measure.isFinished()) {
            this.measure.clear();
            this.render();
        }
    }

    pointerDown(x: number, y: number, snap: SnapMode = 'off', shift = false): void {
        if (this.eraserMode) {
            this.erasing = true; // hold to drag-erase across multiple drawings
            this.deleteAt(x, y);
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
            if (this.erasing) this.deleteAt(x, y); // erase only while the button is held (not on hover)
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

    /**
     * Open an inline textarea over the drawing's own text so it is typed directly on the chart:
     * a callout fills its bubble, a plain text label sits exactly where the glyphs paint (the
     * canvas label is muted meanwhile, so what you type IS what the chart shows) inside a thin frame
     * that marks the text as being edited. An empty label shows a placeholder. Enter breaks the line,
     * a press on the chart (or Ctrl/Cmd+Enter) keeps the text, Escape puts back what was there. The
     * editor and the settings popup are one unit: reaching for a control in the popup does not end
     * the edit.
     */
    private editTextInline(id: string): void {
        const d = this.editedDrawing(id);
        if (!d) return;
        this.closeTextEditor();
        const initial = d.text?.value ?? '';
        const css = this.inlineEditorCss(d, initial);
        if (!css) return;
        const ta = document.createElement('textarea');
        ta.value = initial;
        ta.placeholder = TEXT_PLACEHOLDER;
        ta.spellcheck = false;
        ta.style.cssText = css;
        // live: the canvas bubble / hit box follow the typed text (and the editor re-lays out around it)
        const sync = (): void => {
            this.editedDrawing(id)?.applySettings({ 'text.value': ta.value });
            this.render();
        };
        ta.addEventListener('input', sync);
        ta.addEventListener('pointerdown', (e) => e.stopPropagation());
        ta.addEventListener('keydown', (e) => {
            e.stopPropagation();
            // Enter breaks the line — the break is inserted here rather than left to the textarea's
            // default so it lands whatever else handled the key. Ctrl/Cmd+Enter is the keyboard way
            // to finish, for anyone who'd rather not click off the text.
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const at = ta.selectionStart;
                ta.setRangeText('\n', at, ta.selectionEnd, 'end');
                sync();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                this.finishTextEditor(true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.finishTextEditor(false);
            }
        });
        ta.addEventListener('blur', (e) => {
            // Reaching for a control in the settings popup keeps the edit alive — but hand the text
            // over to the core first, so the popup's own patches build on it instead of a re-sync
            // dropping it.
            if (this.popup.contains((e as FocusEvent).relatedTarget as Node | null)) this.storeText(ta.value);
            else this.finishTextEditor(true); // clicking away keeps the text
        });
        this.overlayHost.appendChild(ta);
        this.textEditor = { el: ta, id, initial, stored: initial };
        ta.focus();
        // Caret at the end, nothing selected: reopening existing text with everything highlighted
        // reads as a rename/resize box rather than in-place editing (and one keystroke would
        // replace the whole annotation).
        ta.setSelectionRange(ta.value.length, ta.value.length);
    }

    /** Hand the edited text to the core (once per actual change) without ending the edit. */
    private storeText(value: string): void {
        const ed = this.textEditor;
        const d = ed && this.editedDrawing(ed.id);
        if (!ed || !d) return;
        d.applySettings({ 'text.value': value });
        if (value !== ed.stored) {
            ed.stored = value;
            this.emit({ kind: 'edit', doc: d.serialize() });
        }
    }

    /** The drawing an inline editor may edit, resolved fresh from the current projection (a core
     *  sync replaces the instances, so the editor holds an id rather than the object). */
    private editedDrawing(id: string): InlineEditable | null {
        const d = this.drawings.find((x) => x.id === id);
        return isInlineEditable(d) ? d : null;
    }

    /** Close the inline editor, keeping (`commit`) or reverting the typed text. A text label left
     *  with nothing in it would paint nothing at all, so it's dropped rather than left invisible. */
    private finishTextEditor(commit: boolean): void {
        const ed = this.textEditor;
        if (!ed) return;
        const value = commit ? ed.el.value : ed.initial;
        this.closeTextEditor();
        const d = this.editedDrawing(ed.id);
        if (!d) return; // deleted from under the editor
        d.applySettings({ 'text.value': value });
        this.render();
        if (d instanceof TextLabel && value.trim() === '') {
            this.clearSelection(); // its settings popup would outlive the drawing
            this.emit({ kind: 'delete', ids: [d.id] });
        } else if (value !== ed.stored) this.emit({ kind: 'edit', doc: d.serialize() });
    }

    /** Absolute position + text metrics for the inline editor, so the typed glyphs land where the
     *  painter would draw them. Null when the drawing has no on-screen box (off-pane anchor). */
    private inlineEditorCss(d: InlineEditable, value: string): string | null {
        const proj = this.deps.projector();
        const theme = this.deps.theme();
        const text = d.text;
        const fs = namedFontSize(text?.size ?? 'normal');
        const font = `${text?.italic ? 'italic ' : ''}${text?.bold ? 'bold ' : ''}${fs}px ${theme.fontFamily}`;
        const base = 'position:absolute;z-index:24;box-sizing:border-box;resize:none;overflow:hidden;margin:0;outline:none;pointer-events:auto;text-align:left;';
        if (d instanceof Callout) {
            const box = d.box(proj);
            if (!box) return null;
            const fill = d.style.fillColor ?? theme.background;
            return (
                base +
                `left:${Math.round(box.x)}px;top:${Math.round(box.y)}px;width:${Math.round(box.w)}px;height:${Math.round(box.h)}px;` +
                `padding:5px 8px;border-radius:5px;border:1px solid ${d.style.lineColor ?? theme.borderColor};` +
                `background:${blendOver(fill, theme.background, splitColor(fill).alpha)};color:${text?.color ?? theme.textColor};font:${font};`
            );
        }
        const anchor = d.handlePoints(proj)[0];
        if (!anchor) return null;
        const lh = labelLineHeight(fs);
        const lines = (value || TEXT_PLACEHOLDER).split('\n');
        const w = Math.ceil(this.measureTextWidth(lines, font)) + CARET_ROOM;
        // The painter draws the label at (anchor + 2) with a `top` baseline; a textarea centers each
        // glyph in its line box, so lift it by half the leading to keep both in the same place. The
        // frame then grows outwards around that origin rather than pushing the text off it.
        return (
            base +
            `left:${Math.round(anchor[0] + 2) - TEXT_FRAME_INSET}px;top:${Math.round(anchor[1] + 2 - (lh - fs) / 2) - TEXT_FRAME_RISE}px;` +
            `width:${w + TEXT_FRAME_INSET * 2}px;height:${lines.length * lh + TEXT_FRAME_RISE * 2}px;` +
            `padding:${TEXT_FRAME_RISE - EDITOR_BORDER}px ${TEXT_FRAME_INSET - EDITOR_BORDER}px;` +
            `border:${EDITOR_BORDER}px solid ${withAlpha(theme.textColor, 0.3)};border-radius:4px;` +
            `background:transparent;color:${text?.color ?? theme.textColor};font:${font};line-height:${lh}px;white-space:pre;`
        );
    }

    /** Widest of `lines` at `font`, measured on the drawings canvas (transform-independent). */
    private measureTextWidth(lines: readonly string[], font: string): number {
        const ctx = this.ctx;
        if (!ctx) return 120;
        const prev = ctx.font;
        ctx.font = font;
        const w = Math.max(8, ...lines.map((l) => ctx.measureText(l).width));
        ctx.font = prev;
        return w;
    }

    /** Keep an open editor glued to its drawing (typing, panning, zooming all move the anchor). */
    private layoutTextEditor(): void {
        const ed = this.textEditor;
        if (!ed) return;
        const d = this.editedDrawing(ed.id);
        const css = d && this.inlineEditorCss(d, ed.el.value);
        if (css) ed.el.style.cssText = css;
    }

    private closeTextEditor(): void {
        const ed = this.textEditor;
        if (!ed) return;
        this.textEditor = null; // null first: removing a focused textarea fires blur → re-entrant close
        ed.el.remove();
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
        if (isInlineEditable(hit)) {
            this.editTextInline(hit.id); // double-click a callout / text label → edit its text in place
            return true;
        }
        return hit != null;
    }

    /** Keyboard pre-empt: Escape (popup/placing/selection), undo/redo, copy/paste/duplicate,
     *  delete (multi), and arrow-nudge. Stands down while a label text field is focused. */
    handleKey(e: KeyboardEvent): boolean {
        if (e.key === 'Escape') {
            if (this.textEditor) {
                this.finishTextEditor(false); // cancel the edit before the popup/selection
                return true;
            }
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
                if (!this.historyChords) return false; // the host's keymap owns Ctrl+Z/Y
                this.emit({ kind: 'undo' });
                break;
            case 'redo':
                if (!this.historyChords) return false;
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
        this.finishTextEditor(true);
        this.popup.close();
        this.render();
    }

    /** Whether the drawing's z puts it INSIDE the series stack (per the last-known boundaries)
     *  rather than over it — i.e. its body belongs to an interleave layer, not the top canvas. */
    private isInterleaved(d: Drawing): boolean {
        return sliceKeyFor(d.zIndex, this.lastBounds.get(d.paneId) ?? []) !== null;
    }

    /** A drawing that paints inside the series stack changed (content, not hover): its pixels
     *  live in the backend composite, so this layer alone can't show the change — ask for a
     *  data frame, which re-runs `prepareSlices` before the backend composites. */
    private invalidateSlices(): void {
        if (this.sliced.size > 0 || this.drawings.some((d) => this.isInterleaved(d))) this.deps.requestDataPaint();
    }

    /**
     * Rebuild the interleave layers for this data frame: bucket the visible drawings whose z
     * sits at-or-under a series boundary by the FIRST boundary at-or-above them (a tie paints
     * under that series), and paint each bucket on its own cached plot-sized canvas. Runs from
     * the renderer's data paint, just before the backend composites the scene.
     */
    prepareSlices(paneIds: readonly string[]): ReadonlyMap<string, DrawingSlice[]> {
        this.sliced.clear();
        this.lastBounds = new Map(paneIds.map((id) => [id, this.deps.seriesBoundaries(id)]));
        const out = new Map<string, DrawingSlice[]>();
        const dpr = this.deps.dpr();
        const proj = this.deps.projector();
        const theme = this.deps.theme();
        const buckets = new Map<string, { paneId: string; beforeZ: number; drawings: Drawing[] }>(); // keyed `paneId|beforeZ`
        for (const d of this.drawings) {
            if (!d.visible) continue;
            const beforeZ = sliceKeyFor(d.zIndex, this.lastBounds.get(d.paneId) ?? []);
            if (beforeZ === null) continue; // over the stack → top canvas
            const key = `${d.paneId}|${beforeZ}`;
            const bucket = buckets.get(key);
            if (bucket) bucket.drawings.push(d);
            else buckets.set(key, { paneId: d.paneId, beforeZ, drawings: [d] });
            this.sliced.add(d.id);
        }
        for (const [key, { paneId, beforeZ, drawings }] of buckets) {
            let canvas = this.sliceCache.get(key);
            if (!canvas) {
                canvas = document.createElement('canvas');
                this.sliceCache.set(key, canvas);
            }
            if (canvas.width !== this.canvas.width || canvas.height !== this.canvas.height) {
                canvas.width = this.canvas.width;
                canvas.height = this.canvas.height;
            }
            const sctx = canvas.getContext('2d');
            if (!sctx) continue;
            sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            sctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            this.painter.paintAll(sctx, drawings, proj, theme, EMPTY_TARGETS);
            const slices = out.get(paneId) ?? [];
            slices.push({ beforeZ, canvas });
            out.set(paneId, slices);
        }
        for (const key of [...this.sliceCache.keys()]) if (!buckets.has(key)) this.sliceCache.delete(key); // drop stale layers
        for (const slices of out.values()) slices.sort((a, b) => a.beforeZ - b.beforeZ);
        return out;
    }

    /** Repaint the TOP drawings layer (called every data frame + on internal changes): the
     *  drawings over the series stack, every selection handle (interleaved drawings' included,
     *  or a drawing sent under the candles could never show what you grabbed), and the
     *  transients — the placing ghost, anchor markers, the snap ring, the ruler. */
    render(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const dpr = this.deps.dpr();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
        const proj = this.deps.projector();
        // A transparent inline editor overlays the label it edits — mute the canvas copy so the
        // typed text isn't drawn twice (the callout editor is opaque, so its label stays).
        const edited = this.textEditor ? this.editedDrawing(this.textEditor.id) : null;
        const targets: PaintTargets = {
            selected: this.selectedIds,
            hovered: this.hoveredId,
            dragged: this.interaction.activeDragId(),
            mutedLabel: edited instanceof TextLabel ? edited.id : null,
        };
        // Front (non-interleaved) drawings paint fully here; the ones interleaved into the series
        // stack painted their bodies on the backend layers, so only their handles come back on top
        // — buried under the candles they'd be unusable.
        this.painter.paintAll(ctx, this.drawings.filter((d) => !this.isInterleaved(d)), proj, this.deps.theme(), targets);
        this.painter.paintHighlights(ctx, this.drawings.filter((d) => this.isInterleaved(d)), proj, handleIdsFor(targets));
        this.layoutTextEditor();
        const ghost = this.interaction.ghost();
        if (ghost) this.painter.paintGhost(ctx, ghost, proj, this.deps.theme());
        // A remote placement mirrored here (drawings sync) paints as the same ghost.
        if (this.externalGhost) this.painter.paintGhost(ctx, this.externalGhost, proj, this.deps.theme());
        // Every placing change re-renders (deps.changed), so this catches each anchor
        // click, cursor move and cancel; the fingerprint gate drops the no-change frames.
        this.emitDraft(ghost);
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
        this.closeTextEditor();
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
            // Sync rebuilds instances, so a panel that reads values back after a patch (e.g. the
            // position tool's price fields, where one edit can flip another level) resolves fresh.
            resolve: () => live() ?? null,
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
                this.closeTextEditor(); // else the editor floats over the deleted label until it loses focus
                this.popup.close();
                this.emit({ kind: 'delete', ids: [id] });
            },
        }, () => this.clearSelection()); // dismiss-on-outside-click also clears the selection/highlight
    }

    /** Report placement progress upstream (`draft` intent) so the drawings sync can
     *  mirror the ghost live on linked charts. Called from every render; only actual
     *  shape changes emit, and the end of a placement emits one `null`. */
    private emitDraft(ghost: Drawing | null): void {
        const key = ghost
            ? JSON.stringify({ t: ghost.type, p: ghost.paneId, a: ghost.anchors, s: ghost.style, x: ghost.text })
            : null;
        if (key === this.lastDraftKey) return;
        this.lastDraftKey = key;
        this.intentCb?.({ kind: 'draft', doc: ghost ? ghost.serialize() : null });
    }

    private emit(i: DrawingIntent): void {
        // A freshly-placed drawing surfaces its editing UI by default once it's set: every type opens
        // its settings menu, and a text label / callout additionally opens its inline editor so the
        // caret is already waiting. Works for both click + drag finalize — the core reassigns the id,
        // so we diff the drawing set around the create to find the new one.
        if (i.kind === 'create') {
            // A fresh annotation FIXES its text ink at creation: max contrast against the
            // live theme's plot background, stored on the drawing itself — so a later theme
            // or background change never recolors what is already placed. A color the user
            // chose (or a deserialized document carries) always passes through untouched.
            if (i.doc.text && i.doc.text.color === undefined) {
                i.doc.text = { ...i.doc.text, color: contrastColor(this.deps.theme().background) };
            }
            const before = new Set(this.drawings.map((d) => d.id));
            this.intentCb?.(i);
            // Defer past the sync + the placing click (which would otherwise steal focus / dismiss
            // the popup) before opening the editing UI on the new drawing.
            setTimeout(() => {
                const fresh = this.drawings.find((d) => !before.has(d.id));
                if (!fresh) return;
                this.openSettingsById(fresh.id, 0, 0);
                if (isInlineEditable(fresh)) this.editTextInline(fresh.id); // focus lands in the editor, not the bar
            }, 0);
            return;
        }
        this.intentCb?.(i);
    }
}
