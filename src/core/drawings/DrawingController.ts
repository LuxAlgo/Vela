import type { Unsubscribe } from '../util/types';
import type { IChartRenderer } from '../ports/IChartRenderer';
import type { TypedEventBus } from '../events/EventBus';
import type { VelaEventMap } from '../events/types';
import type { IDrawingsRendererPort, DrawingIntent, DrawingMode } from './port';
import type { DrawingsOption } from './toolbar';
import { getDrawingType } from './registry';
import { buildToolbar } from './toolbar';
import { DrawingStore } from './DrawingStore';
import { DrawingHistory } from './DrawingHistory';
import { createDrawing, deserializeDrawing } from './registry';
import type { Drawing, DrawingTypeKey, SerializedDrawing } from './Drawing';
import type { SnapMode } from './geometry';
import type { DrawingStyle } from './style';
import { clonePlain, type DrawingsDocument } from './document';

/** Optional seed for a programmatic {@link DrawingController.add}. */
export interface AddInit {
    paneId?: string;
    anchors?: SerializedDrawing['anchors'];
    style?: Partial<SerializedDrawing['style']>;
    text?: SerializedDrawing['text'];
    /** Per-type extras (e.g. a glyph stamp's `glyph`, a fib tool's `levels`). */
    props?: SerializedDrawing['props'];
    /** Draw-order key. Defaults to just under the pane's price on a renderer with
     *  `drawingDepth` — the candles read on top of a fresh drawing; pass an explicit key
     *  for any other slot in the stack. */
    zIndex?: number;
}

/**
 * Renderer-agnostic owner of the user-drawing model + tool/selection state. Holds
 * the {@link DrawingStore} (source of truth), pushes snapshots to the renderer
 * through {@link IDrawingsRendererPort}, and turns renderer intents into store
 * mutations + `drawing:*` events. Inert (but persistence still works) when the
 * active renderer lacks `userDrawings` — that's the LwC path.
 */
export class DrawingController {
    private readonly store = new DrawingStore();
    private readonly history = new DrawingHistory();
    private readonly port: IDrawingsRendererPort | null;
    private readonly enabled: boolean;
    private activeTool: DrawingTypeKey | null = null;
    /** Mirror of the renderer's sticky magnet mode (the renderer default is 'off'). */
    private snapMode: SnapMode = 'off';
    /** When on, finishing a drawing leaves the tool armed (instead of one-shot disarm). */
    private stayInDrawingMode = false;
    /** Mirror of the renderer-local mode (measure/eraser/none). */
    private mode: DrawingMode = null;
    /** FAVORITE tool types (insertion-ordered) — user prefs, not document data. */
    private favs = new Set<DrawingTypeKey>();
    private selectedIds: string[] = []; // ordered; [0] is the primary (settings-popup) selection
    private clipboard: SerializedDrawing[] = []; // in-memory copy buffer (per chart)
    private readonly lastStyle = new Map<DrawingTypeKey, DrawingStyle>(); // per-tool "last used" style
    private readonly subs: Unsubscribe[] = [];

    constructor(
        renderer: IChartRenderer,
        private readonly events: TypedEventBus<VelaEventMap>,
        option: DrawingsOption | undefined,
    ) {
        this.enabled = !!renderer.capabilities.userDrawings && !!renderer.userDrawingsPort;
        this.port = this.enabled ? renderer.userDrawingsPort! : null;
        if (this.port) {
            const { definition, visible } = buildToolbar(option);
            this.port.setToolbar(definition);
            this.port.showToolbar(visible);
            this.subs.push(this.port.onDrawingIntent((i) => this.onIntent(i)));
            this.subs.push(this.store.onChange(() => this.sync()));
        }
    }

    /** Whether the active renderer supports interactive drawings. */
    get supported(): boolean {
        return this.enabled;
    }

    // ── tool / toolbar control ──
    setTool(type: DrawingTypeKey | null): void {
        if (!this.port) return;
        const changed = type !== this.activeTool;
        this.activeTool = type;
        // Seed the renderer's placement preview with the tool's last-used style so the
        // ghost matches what will be committed (the `create` intent re-applies it too).
        this.port.setActiveTool(type, type ? this.lastStyle.get(type) : undefined);
        // Announce every ACTUAL change — arm, one-shot tool-finished, or programmatic —
        // so external toolbars (a workspace's shared bar) reflect the armed tool.
        if (changed) this.events.emit('drawing:tool', { type });
    }

    getTool(): DrawingTypeKey | null {
        return this.activeTool;
    }

    // ── magnet + renderer-local modes (measure/eraser) ──
    // The renderer owns the states and their mutual exclusion; the core holds a MIRROR
    // driven from both ends: facade setters push port commands, in-chart toolbar clicks
    // arrive as intents. Equal values no-op on either path, which keeps the
    // command→intent echo loop convergent.
    getSnapMode(): SnapMode {
        return this.snapMode;
    }

    setSnapMode(mode: SnapMode): void {
        if (!this.port || mode === this.snapMode) return;
        this.snapMode = mode;
        this.port.setSnapMode?.(mode);
        this.events.emit('drawing:snap', { mode });
    }

    getStayMode(): boolean {
        return this.stayInDrawingMode;
    }

    setStayMode(on: boolean): void {
        if (!this.port || on === this.stayInDrawingMode) return;
        this.stayInDrawingMode = on;
        this.port.setStayMode?.(on);
        this.events.emit('drawing:stay', { on });
    }

    getMode(): DrawingMode {
        return this.mode;
    }

    setMode(mode: DrawingMode): void {
        if (!this.port || mode === this.mode) return;
        this.mode = mode;
        this.port.setMode?.(mode);
        this.events.emit('drawing:mode', { mode });
    }

    showToolbar(visible: boolean): void {
        this.port?.showToolbar(visible);
    }

    /** The favorite tool types, in the order they were starred. */
    favorites(): DrawingTypeKey[] {
        return [...this.favs];
    }

    isFavorite(type: DrawingTypeKey): boolean {
        return this.favs.has(type);
    }

    /** Star/unstar one tool. Unknown types are ignored; no-ops don't emit. */
    setFavorite(type: DrawingTypeKey, on: boolean): void {
        if (!getDrawingType(type)) return;
        if (on === this.favs.has(type)) return;
        if (on) this.favs.add(type);
        else this.favs.delete(type);
        this.pushFavorites();
    }

    /** Replace the whole favorite set (bulk restore) — unknown types are dropped. */
    setFavorites(types: readonly DrawingTypeKey[]): void {
        const next = types.filter((t) => getDrawingType(t) != null);
        if (next.length === this.favs.size && next.every((t) => this.favs.has(t))) return;
        this.favs = new Set(next);
        this.pushFavorites();
    }

    private pushFavorites(): void {
        const list = [...this.favs];
        this.port?.setFavorites?.(list);
        this.events.emit('drawing:favorites', { favorites: list });
    }

    setToolbar(option: DrawingsOption): void {
        this.port?.setToolbar(buildToolbar(option).definition);
    }

    /** Push per-tool shortcut hints (pre-formatted display strings) to the toolbar flyouts. */
    setToolShortcuts(map: Readonly<Partial<Record<DrawingTypeKey, string>>>): void {
        this.port?.setToolShortcuts?.(map);
    }

    // ── programmatic CRUD (facade-facing) ── each is one undo step
    add(type: DrawingTypeKey, init: AddInit = {}): Drawing | null {
        if (!this.enabled) return null;
        const last = this.lastStyle.get(type);
        const style = { ...(last ?? {}), ...(init.style ?? {}) } as SerializedDrawing['style'] | undefined;
        const d = createDrawing(type, {
            id: this.store.nextId(),
            paneId: init.paneId ?? 'price',
            anchors: init.anchors,
            style,
            text: init.text,
            props: init.props,
            zIndex: init.zIndex ?? this.startZ(init.paneId ?? 'price'),
        });
        if (!d) return null;
        this.history.record(this.store.serialize());
        this.store.add(d);
        this.captureStyle(d.id);
        this.events.emit('drawing:created', { id: d.id });
        return d;
    }

    remove(id: string): void {
        this.deleteMany([id]);
    }

    /** Apply a partial record to a drawing (headless write-back from a custom UI). */
    update(id: string, patch: Partial<SerializedDrawing>): void {
        const before = this.store.serialize();
        // Public callers may send a partial style; merge onto the live style so they
        // don't wipe sibling keys. Edit intents write full `serialize()` style and go
        // straight to the store (which replaces wholesale — needed for settings reset).
        const cur = patch.style ? this.store.get(id) : undefined;
        const resolved =
            patch.style && cur ? { ...patch, style: { ...cur.style, ...patch.style } } : patch;
        if (this.store.update(id, resolved)) {
            this.history.record(before);
            this.captureStyle(id);
            this.events.emit('drawing:edited', { id });
        }
    }

    /** Apply several partial records as ONE undo step (e.g. hiding/locking/reordering a group). */
    updateMany(patches: ReadonlyArray<{ id: string; patch: Partial<SerializedDrawing> }>): void {
        this.history.begin(this.store.serialize());
        for (const { id, patch } of patches) {
            if (this.store.update(id, patch)) {
                this.history.markDirty();
                this.events.emit('drawing:edited', { id });
            }
        }
        this.history.commit();
    }

    /** Delete several drawings as ONE undo step (the public face of {@link deleteMany}). */
    removeMany(ids: readonly string[]): void {
        this.deleteMany(ids);
    }

    setLocked(id: string, v: boolean): void {
        const before = this.store.serialize();
        this.history.record(before);
        this.store.setLocked(id, v);
        this.events.emit('drawing:edited', { id });
    }

    setVisible(id: string, v: boolean): void {
        const before = this.store.serialize();
        this.history.record(before);
        this.store.setVisible(id, v);
        this.events.emit('drawing:edited', { id });
    }

    bringToFront(id: string): void {
        const before = this.store.serialize();
        this.history.record(before);
        this.store.bringToFront(id, this.seriesTopZ(this.store.get(id)?.paneId));
        this.events.emit('drawing:edited', { id });
    }

    sendToBack(id: string): void {
        const before = this.store.serialize();
        this.history.record(before);
        this.store.sendToBack(id, this.seriesBottomZ(this.store.get(id)?.paneId));
        this.events.emit('drawing:edited', { id });
    }

    /** The top of the pane's series stack — what a front drawing has to clear. 0 when the
     *  renderer keeps drawings on their own layer (no shared z space). */
    private seriesTopZ(paneId: string | undefined): number {
        return paneId !== undefined ? (this.port?.stackRange?.(paneId)?.front ?? 0) : 0;
    }

    /** The bottom of the pane's series stack — what a backmost drawing has to undercut. */
    private seriesBottomZ(paneId: string | undefined): number {
        return paneId !== undefined ? (this.port?.stackRange?.(paneId)?.back ?? 1) : 1;
    }

    /** Where a NEW drawing starts: just under the pane's price so the candles read on top of it
     *  (falling back to just under the pane's top series where there is no price — a study
     *  pane). Half a key down never ties a series; drawings tying each other paint in insertion
     *  order, so consecutive new drawings still stack newest-in-front. Undefined without a
     *  shared z space — the store then places it over the other drawings, its own layer's top. */
    private startZ(paneId: string): number | undefined {
        const range = this.port?.stackRange?.(paneId);
        return range ? (range.price ?? range.front) - 0.5 : undefined;
    }

    /** Programmatically select drawings (host UI → chart): shows the on-chart handles + toolbar.
     *  `additive` toggles membership (matching shift-click) instead of replacing. */
    select(ids: readonly string[], additive = false): void {
        this.setSelection(ids, additive);
    }

    /** Open a drawing's on-chart settings popup (and select it) — a click on it, driven from a host UI. */
    openSettings(id: string): void {
        this.port?.openSettings(id);
    }

    // ── undo / redo (core-owned; works even without renderer support) ──
    undo(): void {
        const next = this.history.undo(this.store.serialize());
        if (next) this.restoreSnapshot(next);
    }

    redo(): void {
        const next = this.history.redo(this.store.serialize());
        if (next) this.restoreSnapshot(next);
    }

    canUndo(): boolean {
        return this.history.canUndo();
    }

    canRedo(): boolean {
        return this.history.canRedo();
    }

    // ── clone / clipboard ──
    /** Duplicate drawings in place (clones land on the source, auto-selected → "duplicate then drag"). */
    duplicate(ids: readonly string[]): Drawing[] {
        if (!this.enabled) return [];
        const sources = this.resolve(ids);
        if (sources.length === 0) return [];
        return this.insertClones(sources.map((d) => d.serialize()));
    }

    clone(id: string): Drawing | null {
        return this.duplicate([id])[0] ?? null;
    }

    /** Copy drawings into the in-memory clipboard (no model change, no event). */
    copy(ids: readonly string[]): void {
        const docs = this.resolve(ids).map((d) => clonePlain(d.serialize()));
        if (docs.length) this.clipboard = docs;
    }

    paste(): Drawing[] {
        if (!this.enabled || this.clipboard.length === 0) return [];
        return this.insertClones(this.clipboard);
    }

    all(): SerializedDrawing[] {
        return this.store.serialize().drawings;
    }

    // ── persistence (works regardless of renderer support) ──
    toJSON(): DrawingsDocument {
        return this.store.serialize();
    }

    fromJSON(doc: unknown): void {
        this.history.clear(); // a new document is a context switch — don't undo into the old one
        this.selectedIds = [];
        this.store.load(doc); // load() emits change → sync() when enabled
    }

    destroy(): void {
        for (const u of this.subs) u();
        this.subs.length = 0;
    }

    // ── internals ──
    /** Set/extend the selection. `additive` toggles membership (shift-click) vs replacing it. */
    private setSelection(ids: readonly string[], additive = false): void {
        let next: string[];
        if (additive) {
            next = [...this.selectedIds];
            for (const id of ids) {
                const at = next.indexOf(id);
                if (at >= 0) next.splice(at, 1); // toggle off
                else next.push(id); // toggle on
            }
        } else {
            next = [...ids];
        }
        this.selectedIds = next.filter((id) => this.store.has(id));
        this.port?.setSelection(this.selectedIds);
        this.events.emit('drawing:selected', { id: this.selectedIds[0] ?? null });
    }

    /** Restore a history snapshot, reconciling selection against what survived. */
    private restoreSnapshot(doc: DrawingsDocument): void {
        this.store.load(doc); // fires onChange → sync() + autoscale
        this.selectedIds = this.selectedIds.filter((id) => this.store.has(id));
        this.port?.setSelection(this.selectedIds);
        this.events.emit('drawing:selected', { id: this.selectedIds[0] ?? null });
    }

    /** Delete drawings as one undo step; prune them from the selection. */
    private deleteMany(ids: readonly string[]): void {
        this.history.begin(this.store.serialize());
        const removed: string[] = [];
        for (const id of ids) {
            if (this.store.remove(id)) removed.push(id);
            this.history.markDirty();
        }
        this.history.commit();
        if (removed.length === 0) return;
        const survivors = this.selectedIds.filter((id) => this.store.has(id));
        if (survivors.length !== this.selectedIds.length) this.setSelection(survivors);
        for (const id of removed) this.events.emit('drawing:removed', { id });
    }

    /** Add clones (fresh ids, fresh mount-order z) as one undo step + select them. */
    private insertClones(docs: readonly SerializedDrawing[]): Drawing[] {
        this.history.begin(this.store.serialize());
        const clones: Drawing[] = [];
        for (const doc of docs) {
            // A copy keeps its source's DEPTH: the clone lands at the same z and, tying it,
            // paints just in front of it — "duplicate then drag" without a jump up the stack.
            const d = deserializeDrawing({ ...doc, id: this.store.nextId() });
            if (!d) continue;
            this.store.add(d);
            this.history.markDirty();
            clones.push(d);
        }
        this.history.commit();
        if (clones.length) {
            this.setSelection(clones.map((c) => c.id));
            for (const c of clones) this.events.emit('drawing:created', { id: c.id });
        }
        return clones;
    }

    private resolve(ids: readonly string[]): Drawing[] {
        return ids.map((id) => this.store.get(id)).filter((d): d is Drawing => d != null);
    }

    /** Remember a drawing's style as the "last used" for its type (seeds the next one). */
    private captureStyle(id: string): void {
        const d = this.store.get(id);
        if (d) this.lastStyle.set(d.type, { ...d.style });
    }

    private sync(): void {
        this.port?.syncDrawings(this.store.serialize().drawings);
    }

    /** Renderer gesture → authoritative store mutation + event. */
    private onIntent(i: DrawingIntent): void {
        switch (i.kind) {
            case 'arm':
                this.setTool(i.type); // toolbar click → core-authoritative tool state
                break;
            case 'create': {
                const before = this.store.serialize();
                const last = this.lastStyle.get(i.doc.type); // a freshly drawn shape inherits the last-used style
                const style = last ? { ...i.doc.style, ...last } : i.doc.style;
                const d = deserializeDrawing({ ...i.doc, id: this.store.nextId(), style });
                if (!d) return;
                if (!d.zIndex) d.zIndex = this.startZ(d.paneId) ?? 0; // a freshly placed drawing starts under the price
                this.history.record(before);
                this.store.add(d);
                this.captureStyle(d.id);
                this.events.emit('drawing:created', { id: d.id });
                // No auto-select: selection (= the drawing being edited) is driven by the
                // settings popup. A freshly drawn shape shows handles via hover instead.
                break;
            }
            case 'edit': {
                const before = this.store.serialize();
                if (this.store.update(i.doc.id, i.doc)) {
                    this.history.record(before);
                    this.captureStyle(i.doc.id);
                    this.events.emit('drawing:edited', { id: i.doc.id });
                }
                break;
            }
            case 'edit-many': {
                this.history.begin(this.store.serialize());
                for (const doc of i.docs) {
                    if (this.store.update(doc.id, doc)) {
                        this.history.markDirty();
                        this.events.emit('drawing:edited', { id: doc.id });
                    }
                }
                this.history.commit();
                break;
            }
            case 'select':
                this.setSelection(i.ids, i.additive);
                break;
            case 'delete':
                this.deleteMany(i.ids);
                break;
            case 'reorder':
                if (i.to === 'front') this.bringToFront(i.id);
                else this.sendToBack(i.id);
                break;
            case 'settings':
                this.events.emit('drawing:settings', { id: i.id });
                break;
            case 'favorite':
                this.setFavorite(i.type, i.on);
                break;
            case 'snap-mode':
                // In-chart magnet click (already applied renderer-side) — mirror + announce.
                if (i.mode !== this.snapMode) {
                    this.snapMode = i.mode;
                    this.events.emit('drawing:snap', { mode: i.mode });
                }
                break;
            case 'stay-mode':
                // In-chart stay-mode click (already applied renderer-side) — mirror + announce.
                if (i.on !== this.stayInDrawingMode) {
                    this.stayInDrawingMode = i.on;
                    this.events.emit('drawing:stay', { on: i.on });
                }
                break;
            case 'mode':
                // Measure/eraser toggled in-chart, or exited as a mutual-exclusion side effect.
                if (i.mode !== this.mode) {
                    this.mode = i.mode;
                    this.events.emit('drawing:mode', { mode: i.mode });
                }
                break;
            case 'tool-finished':
                // Most tools are one-shot (revert to the pointer once placed); brush-family tools
                // always stay armed, and stay-in-drawing-mode keeps every tool armed.
                if (!this.stayInDrawingMode && i.type !== 'freehand' && i.type !== 'highlighter') this.setTool(null);
                break;
            case 'undo':
                this.undo();
                break;
            case 'redo':
                this.redo();
                break;
            case 'duplicate':
                this.duplicate(i.ids);
                break;
            case 'copy':
                this.copy(i.ids);
                break;
            case 'paste':
                this.paste();
                break;
        }
    }
}
