import { clonePlain, type DrawingsDocument } from './document';

/**
 * Snapshot-based undo/redo for the drawing model. Holds full-document snapshots
 * (cheap — plain JSON) on an undo/redo stack pair. The controller drives it; the
 * {@link DrawingStore} stays a dumb source of truth (its single-`emit()` invariant
 * is untouched). Two recording modes:
 *
 *  - {@link record} — atomic single-step: push the pre-mutation snapshot, then the
 *    caller mutates. One CRUD call = one undo entry.
 *  - {@link begin}/{@link markDirty}/{@link commit} — a TRANSACTION that coalesces
 *    many store mutations (a multi-drag, multi-delete, duplicate, paste) into ONE
 *    undo entry. The pre-mutation snapshot is captured at `begin`; the first
 *    `markDirty` inside the transaction promotes it onto the undo stack; further
 *    `markDirty`s (e.g. N mousemoves, or each item of a loop) are no-ops.
 *
 * A new mutation clears the redo stack. The undo stack is capped (oldest dropped).
 */
export class DrawingHistory {
    private undoStack: DrawingsDocument[] = [];
    private redoStack: DrawingsDocument[] = [];
    private pending: DrawingsDocument | null = null; // pre-mutation snapshot of the open transaction
    private dirtied = false; // promoted-once guard within a transaction
    private depth = 0; // transaction nesting (re-entrancy)

    constructor(private readonly cap = 100) {}

    /** Open a transaction; `snapshot` is the model state BEFORE any mutation in it. */
    begin(snapshot: DrawingsDocument): void {
        this.depth += 1;
        if (this.depth === 1) {
            this.pending = clonePlain(snapshot);
            this.dirtied = false;
        }
    }

    /** The first mutation inside the open transaction → push the pre-snapshot once. */
    markDirty(): void {
        if (this.depth === 0 || this.dirtied || !this.pending) return;
        this.push(this.pending);
        this.dirtied = true;
    }

    /** Close the transaction; if nothing mutated, the snapshot is dropped (no entry). */
    commit(): void {
        if (this.depth === 0) return;
        this.depth -= 1;
        if (this.depth === 0) {
            this.pending = null;
            this.dirtied = false;
        }
    }

    /** Abort the open transaction (the caller rolled its mutation back); no entry. */
    abort(): void {
        this.commit(); // same teardown — the caller is responsible for restoring state
    }

    /** Atomic step: record the pre-mutation snapshot as one undo entry (or fold into an open txn). */
    record(before: DrawingsDocument): void {
        if (this.depth > 0) {
            this.markDirty();
            return;
        }
        this.push(clonePlain(before));
    }

    /** Undo: returns the document to restore (push `current` onto redo), or null if empty. */
    undo(current: DrawingsDocument): DrawingsDocument | null {
        const prev = this.undoStack.pop();
        if (!prev) return null;
        this.redoStack.push(clonePlain(current));
        return prev;
    }

    /** Redo: returns the document to restore (push `current` onto undo), or null if empty. */
    redo(current: DrawingsDocument): DrawingsDocument | null {
        const next = this.redoStack.pop();
        if (!next) return null;
        this.undoStack.push(clonePlain(current));
        return next;
    }

    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Drop all history (context switch — e.g. `fromJSON`). */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.pending = null;
        this.dirtied = false;
        this.depth = 0;
    }

    private push(doc: DrawingsDocument): void {
        this.undoStack.push(doc);
        if (this.undoStack.length > this.cap) this.undoStack.shift();
        this.redoStack = []; // a fresh mutation invalidates redo
    }
}
