import { describe, it, expect } from 'vitest';
import { DrawingHistory } from '../src/core/drawings/DrawingHistory';
import type { DrawingsDocument, SerializedDrawing } from '../src/core/drawings';

/** A snapshot whose only meaningful content is a tag, so we can assert what was restored. */
const doc = (tag: string): DrawingsDocument => ({ version: 1, drawings: [{ id: tag } as unknown as SerializedDrawing] });
const tag = (d: DrawingsDocument | null): string | undefined => d?.drawings[0]?.id;

describe('DrawingHistory', () => {
    it('records atomic steps and round-trips undo → redo', () => {
        const h = new DrawingHistory();
        h.record(doc('S0')); // before mutation 1 (→ S1)
        h.record(doc('S1')); // before mutation 2 (→ S2)
        expect(h.canUndo()).toBe(true);
        expect(h.canRedo()).toBe(false);

        expect(tag(h.undo(doc('S2')))).toBe('S1'); // back to after mutation 1
        expect(tag(h.undo(doc('S1')))).toBe('S0'); // back to start
        expect(h.undo(doc('S0'))).toBeNull(); // nothing left

        expect(tag(h.redo(doc('S0')))).toBe('S1');
        expect(tag(h.redo(doc('S1')))).toBe('S2');
        expect(h.redo(doc('S2'))).toBeNull();
    });

    it('coalesces a transaction into ONE undo entry regardless of mutation count', () => {
        const h = new DrawingHistory();
        h.begin(doc('S0'));
        h.markDirty(); // first mutation promotes the pre-snapshot
        h.markDirty(); // subsequent mutations are folded in
        h.markDirty();
        h.commit();
        expect(h.canUndo()).toBe(true);
        expect(tag(h.undo(doc('S1')))).toBe('S0'); // one undo reverts the whole transaction
        expect(h.canUndo()).toBe(false);
    });

    it('a transaction that mutates nothing records no entry', () => {
        const h = new DrawingHistory();
        h.begin(doc('S0'));
        h.commit();
        expect(h.canUndo()).toBe(false);
    });

    it('a fresh mutation clears the redo stack', () => {
        const h = new DrawingHistory();
        h.record(doc('S0'));
        h.undo(doc('S1'));
        expect(h.canRedo()).toBe(true);
        h.record(doc('S2')); // diverge → redo is no longer valid
        expect(h.canRedo()).toBe(false);
    });

    it('caps the undo depth, dropping the oldest', () => {
        const h = new DrawingHistory(2);
        h.record(doc('A'));
        h.record(doc('B'));
        h.record(doc('C')); // pushes past the cap → 'A' drops
        expect(tag(h.undo(doc('D')))).toBe('C');
        expect(tag(h.undo(doc('C')))).toBe('B');
        expect(h.undo(doc('B'))).toBeNull(); // 'A' is gone
    });

    it('clear() empties both stacks', () => {
        const h = new DrawingHistory();
        h.record(doc('S0'));
        h.undo(doc('S1'));
        h.clear();
        expect(h.canUndo()).toBe(false);
        expect(h.canRedo()).toBe(false);
    });
});
