import type { Unsubscribe } from '../util/types';
import { Drawing, type SerializedDrawing } from './Drawing';
import { deserializeDrawing } from './registry';
import { migrate, type DrawingsDocument, DRAWINGS_DOC_VERSION } from './document';

/**
 * The single source of truth for a chart's user drawings. Owns identity + paint
 * order (z), exposes CRUD + persistence, and fires `onChange` so the controller
 * re-syncs the renderer. Renderer-agnostic — holds {@link Drawing} instances, but
 * everything that leaves is plain {@link SerializedDrawing} data.
 */
export class DrawingStore {
    private readonly byId = new Map<string, Drawing>();
    private seq = 0;
    private zCounter = 1;
    private readonly listeners = new Set<() => void>();

    /** Allocate a unique, stable drawing id. */
    nextId(): string {
        this.seq += 1;
        return `dw-${this.seq}`;
    }

    /** Insert a drawing, assigning a mount-order z (later ⇒ painted in front). */
    add(d: Drawing): Drawing {
        if (!d.zIndex) d.zIndex = this.zCounter;
        this.zCounter = Math.max(this.zCounter, d.zIndex) + 1;
        this.byId.set(d.id, d);
        this.emit();
        return d;
    }

    remove(id: string): boolean {
        const ok = this.byId.delete(id);
        if (ok) this.emit();
        return ok;
    }

    get(id: string): Drawing | undefined {
        return this.byId.get(id);
    }

    has(id: string): boolean {
        return this.byId.has(id);
    }

    /** Apply a (possibly partial) record onto an existing drawing in place. */
    update(id: string, patch: Partial<SerializedDrawing>): Drawing | null {
        const d = this.byId.get(id);
        if (!d) return null;
        if (patch.anchors) d.anchors = patch.anchors.map((p) => ({ time: p.time, price: p.price }));
        // Replace style wholesale — edit intents write back `serialize().style`, and a settings
        // reset must be able to drop keys (e.g. fillColor) that are absent from the type default.
        // Callers that want a partial style patch merge before calling update.
        if (patch.style) d.style = { ...patch.style };
        if (patch.text !== undefined) d.text = patch.text ? { ...patch.text } : undefined;
        if (patch.paneId !== undefined) d.paneId = patch.paneId;
        if (patch.locked !== undefined) d.locked = patch.locked;
        if (patch.visible !== undefined) d.visible = patch.visible;
        if (patch.zIndex !== undefined) d.zIndex = patch.zIndex;
        if (patch.props !== undefined) d.applyProps(patch.props); // per-type extras (e.g. fib levels)
        this.emit();
        return d;
    }

    /** Every drawing in paint order (ascending z). */
    all(): Drawing[] {
        return [...this.byId.values()].sort((a, b) => a.zIndex - b.zIndex);
    }

    /** Drawings on one pane, in paint order. */
    byPane(paneId: string): Drawing[] {
        return this.all().filter((d) => d.paneId === paneId);
    }

    bringToFront(id: string): void {
        const d = this.byId.get(id);
        if (!d) return;
        d.zIndex = this.zCounter;
        this.zCounter += 1;
        this.emit();
    }

    sendToBack(id: string): void {
        const d = this.byId.get(id);
        if (!d) return;
        const min = Math.min(...[...this.byId.values()].map((x) => x.zIndex), 1);
        d.zIndex = min - 1;
        this.emit();
    }

    setLocked(id: string, v: boolean): void {
        const d = this.byId.get(id);
        if (d) {
            d.locked = v;
            this.emit();
        }
    }

    setVisible(id: string, v: boolean): void {
        const d = this.byId.get(id);
        if (d) {
            d.visible = v;
            this.emit();
        }
    }

    clear(): void {
        if (this.byId.size === 0) return;
        this.byId.clear();
        this.emit();
    }

    serialize(): DrawingsDocument {
        return { version: DRAWINGS_DOC_VERSION, drawings: this.all().map((d) => d.serialize()) };
    }

    /** Replace all drawings from a (validated) document. Unknown types are skipped. */
    load(doc: unknown): void {
        const valid = migrate(doc);
        this.byId.clear();
        this.seq = 0;
        this.zCounter = 1;
        for (const record of valid.drawings) {
            const d = deserializeDrawing(record);
            if (!d) continue; // unknown type → skip, don't crash
            this.byId.set(d.id, d);
            this.zCounter = Math.max(this.zCounter, d.zIndex) + 1;
            this.bumpSeqPast(d.id);
        }
        this.emit();
    }

    onChange(cb: () => void): Unsubscribe {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /** Keep `nextId()` from colliding with a loaded `dw-N` id. */
    private bumpSeqPast(id: string): void {
        const m = /^dw-(\d+)$/.exec(id);
        if (m) this.seq = Math.max(this.seq, Number(m[1]));
    }

    private emit(): void {
        for (const cb of this.listeners) cb();
    }
}

/** Re-export for convenience at the store layer. */
export { Drawing };
