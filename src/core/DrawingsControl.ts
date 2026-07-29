import type { DrawingController, AddInit } from './drawings/DrawingController';
import type { Drawing, DrawingTypeKey, SerializedDrawing } from './drawings/Drawing';
import type { DrawingsDocument } from './drawings/document';
import type { SnapMode } from './drawings/geometry';
import type { DrawingMode } from './drawings/port';
import type { DrawingsOption } from './drawings/toolbar';

/**
 * The chart's drawing control surface (`chart.drawings`) — sibling of
 * `chart.data` / `chart.renderer`. Activate tools, create/mutate drawings
 * programmatically, and persist them. Always present; on a renderer without the
 * `userDrawings` capability the interactive methods warn + no-op (the
 * {@link DataControl} pattern), while `toJSON`/`fromJSON`/`all` still round-trip
 * because the model is core-owned.
 */
export class DrawingsControl {
    constructor(private readonly ctrl: DrawingController) {}

    /** Whether the active renderer supports interactive drawings. */
    get supported(): boolean {
        return this.ctrl.supported;
    }

    /** Arm a tool — the next click(s) place it. `null` returns to select/idle. */
    setTool(type: DrawingTypeKey | null): this {
        if (this.ok('setTool')) this.ctrl.setTool(type);
        return this;
    }

    /** The currently armed tool (`null` = select/idle). Mirrors in-chart toolbar clicks
     *  and one-shot tools disarming — listen on `drawing:tool` to follow changes. */
    getTool(): DrawingTypeKey | null {
        return this.ctrl.getTool();
    }

    /** Set the sticky magnet snap mode (`'off' | 'weak' | 'strong'`). */
    setSnapMode(mode: SnapMode): this {
        if (this.ok('setSnapMode')) this.ctrl.setSnapMode(mode);
        return this;
    }

    /** The current magnet snap mode — follow changes on `drawing:snap`. */
    getSnapMode(): SnapMode {
        return this.ctrl.getSnapMode();
    }

    /** Enter/exit a renderer-local mode: `'measure'` (transient ruler), `'eraser'`, or
     *  `null` (none). Mutually exclusive with each other and with any armed tool — the
     *  renderer enforces the exclusion and the outcome lands on `drawing:mode`. */
    setMode(mode: DrawingMode): this {
        if (this.ok('setMode')) this.ctrl.setMode(mode);
        return this;
    }

    /** The current renderer-local mode — follow changes on `drawing:mode`. */
    getMode(): DrawingMode {
        return this.ctrl.getMode();
    }

    /** Show or hide the on-chart drawing toolbar. */
    showToolbar(visible = true): this {
        if (this.ok('showToolbar')) this.ctrl.showToolbar(visible);
        return this;
    }

    /** Reconfigure the toolbar groups/tools live. */
    setToolbar(option: DrawingsOption): this {
        if (this.ok('setToolbar')) this.ctrl.setToolbar(option);
        return this;
    }

    /** Show per-tool shortcut hints in the toolbar flyouts. Values are PRE-FORMATTED
     *  display strings (e.g. `'Alt+T'`, `'⌥T'`) — the host owns the keymap and the
     *  platform formatting, so hints always match the host's actual bindings. */
    setToolShortcuts(map: Readonly<Partial<Record<DrawingTypeKey, string>>>): this {
        if (this.ok('setToolShortcuts')) this.ctrl.setToolShortcuts(map);
        return this;
    }

    /** Create a drawing programmatically (no clicking). Returns it, or null if unsupported. */
    add(type: DrawingTypeKey, init: AddInit = {}): Drawing | null {
        if (!this.ok('add')) return null;
        return this.ctrl.add(type, init);
    }

    remove(id: string): this {
        this.ctrl.remove(id);
        return this;
    }

    /** Apply a partial record to a drawing — for a custom (headless) settings UI. */
    update(id: string, patch: Partial<SerializedDrawing>): this {
        this.ctrl.update(id, patch);
        return this;
    }

    /** Apply several partial records as one undo step (group hide/lock/reorder from a host UI). */
    updateMany(patches: ReadonlyArray<{ id: string; patch: Partial<SerializedDrawing> }>): this {
        this.ctrl.updateMany(patches);
        return this;
    }

    /** Remove several drawings as one undo step. */
    removeMany(ids: readonly string[]): this {
        this.ctrl.removeMany(ids);
        return this;
    }

    lock(id: string, v = true): this {
        this.ctrl.setLocked(id, v);
        return this;
    }

    show(id: string, v = true): this {
        this.ctrl.setVisible(id, v);
        return this;
    }

    /** Select drawings on the chart (highlight + open their toolbar) — for a host-side tree/list.
     *  Pass `null` or `[]` to clear the selection. */
    select(ids: string | readonly string[] | null): this {
        if (this.ok('select')) this.ctrl.select(ids == null ? [] : typeof ids === 'string' ? [ids] : ids);
        return this;
    }

    /** Open a drawing's settings popup on the chart (selecting it) — the twin of clicking it. */
    openSettings(id: string): this {
        if (this.ok('openSettings')) this.ctrl.openSettings(id);
        return this;
    }

    bringToFront(id: string): this {
        this.ctrl.bringToFront(id);
        return this;
    }

    sendToBack(id: string): this {
        this.ctrl.sendToBack(id);
        return this;
    }

    // ── undo / redo (core-owned — work regardless of renderer support) ──
    /** Revert the last edit. No-op when there is nothing to undo. */
    undo(): this {
        this.ctrl.undo();
        return this;
    }

    /** Re-apply the last undone edit. No-op when there is nothing to redo. */
    redo(): this {
        this.ctrl.redo();
        return this;
    }

    canUndo(): boolean {
        return this.ctrl.canUndo();
    }

    canRedo(): boolean {
        return this.ctrl.canRedo();
    }

    // ── clone / clipboard ──
    /** Duplicate a drawing in place; the clone is selected. Returns this (chainable). */
    clone(id: string): this {
        if (this.ok('clone')) this.ctrl.clone(id);
        return this;
    }

    /** Duplicate several drawings in place; the clones become the selection. */
    duplicate(ids: string[]): this {
        if (this.ok('duplicate')) this.ctrl.duplicate(ids);
        return this;
    }

    /** Copy drawings into the in-memory clipboard for a later {@link paste}. */
    copyToClipboard(ids: string[]): this {
        if (this.ok('copy')) this.ctrl.copy(ids);
        return this;
    }

    /** Paste the clipboard as new drawings (fresh ids), selecting them. */
    paste(): this {
        if (this.ok('paste')) this.ctrl.paste();
        return this;
    }

    /** Every drawing as plain JSON, in paint order. */
    all(): SerializedDrawing[] {
        return this.ctrl.all();
    }

    /** Snapshot all drawings as a versioned document (persistence). */
    toJSON(): DrawingsDocument {
        return this.ctrl.toJSON();
    }

    /** Restore drawings from a document produced by {@link toJSON} (untrusted-safe). */
    fromJSON(doc: unknown): this {
        this.ctrl.fromJSON(doc);
        return this;
    }

    /** The favorite tool types (starred in the toolbar flyouts), insertion-ordered. */
    favorites(): DrawingTypeKey[] {
        return this.ctrl.favorites();
    }

    isFavorite(type: DrawingTypeKey): boolean {
        return this.ctrl.isFavorite(type);
    }

    /** Star/unstar one tool type. */
    setFavorite(type: DrawingTypeKey, on: boolean): this {
        if (this.ok('setFavorite')) this.ctrl.setFavorite(type, on);
        return this;
    }

    /** Replace the whole favorite set (e.g. restoring persisted prefs). */
    setFavorites(types: readonly DrawingTypeKey[]): this {
        if (this.ok('setFavorites')) this.ctrl.setFavorites([...types]);
        return this;
    }

    /** Aliases mirroring `renderer.getConfig()/applyConfig()` for symmetry. */
    getConfig(): DrawingsDocument {
        return this.ctrl.toJSON();
    }
    applyConfig(doc: unknown): this {
        this.ctrl.fromJSON(doc);
        return this;
    }

    private ok(op: string): boolean {
        if (this.ctrl.supported) return true;
        console.warn(`[vela] chart.drawings.${op}() ignored — the active renderer has no userDrawings capability.`);
        return false;
    }
}
