import { describe, it, expect } from 'vitest';
import { keyToDrawingAction, isEditingText, unlockedDrawingIds, type DrawingKeyContext } from '../src/renderers/native/drawings/DrawingKeys';

const ctx = (over: Partial<DrawingKeyContext> = {}): DrawingKeyContext => ({
    hasSelection: true,
    hasTarget: true,
    editingText: false,
    ...over,
});

describe('keyToDrawingAction', () => {
    it('maps undo / redo (Ctrl or Cmd)', () => {
        expect(keyToDrawingAction({ key: 'z', ctrlKey: true }, ctx())).toEqual({ kind: 'undo' });
        expect(keyToDrawingAction({ key: 'z', ctrlKey: true, shiftKey: true }, ctx())).toEqual({ kind: 'redo' });
        expect(keyToDrawingAction({ key: 'y', ctrlKey: true }, ctx())).toEqual({ kind: 'redo' });
        expect(keyToDrawingAction({ key: 'z', metaKey: true }, ctx())).toEqual({ kind: 'undo' });
    });

    it('copy / duplicate need a selection; paste does not', () => {
        expect(keyToDrawingAction({ key: 'c', ctrlKey: true }, ctx())).toEqual({ kind: 'copy' });
        expect(keyToDrawingAction({ key: 'c', ctrlKey: true }, ctx({ hasSelection: false }))).toBeNull();
        expect(keyToDrawingAction({ key: 'd', ctrlKey: true }, ctx())).toEqual({ kind: 'duplicate' });
        expect(keyToDrawingAction({ key: 'v', ctrlKey: true }, ctx({ hasSelection: false }))).toEqual({ kind: 'paste' });
    });

    it('delete needs a target; nudge needs a selection (Shift = coarse)', () => {
        expect(keyToDrawingAction({ key: 'Delete' }, ctx())).toEqual({ kind: 'delete' });
        expect(keyToDrawingAction({ key: 'Backspace' }, ctx({ hasTarget: false }))).toBeNull();
        expect(keyToDrawingAction({ key: 'ArrowLeft' }, ctx())).toEqual({ kind: 'nudge', dx: -1, dy: 0 });
        expect(keyToDrawingAction({ key: 'ArrowDown', shiftKey: true }, ctx())).toEqual({ kind: 'nudge', dx: 0, dy: 10 });
        expect(keyToDrawingAction({ key: 'ArrowRight' }, ctx({ hasSelection: false }))).toBeNull();
    });

    it('stands down entirely while a text field is focused', () => {
        expect(keyToDrawingAction({ key: 'z', ctrlKey: true }, ctx({ editingText: true }))).toBeNull();
        expect(keyToDrawingAction({ key: 'Delete' }, ctx({ editingText: true }))).toBeNull();
    });

    it('ignores unrelated keys', () => {
        expect(keyToDrawingAction({ key: 'a' }, ctx())).toBeNull();
        expect(keyToDrawingAction({ key: 'Enter' }, ctx())).toBeNull();
    });
});

describe('isEditingText', () => {
    it('detects inputs / textareas / contenteditable, ignores the rest', () => {
        expect(isEditingText({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
        expect(isEditingText({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
        expect(isEditingText({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
        expect(isEditingText({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
        expect(isEditingText(null)).toBe(false);
    });
});

describe('unlockedDrawingIds', () => {
    it('keeps unlocked and stale targets in order while excluding locked drawings', () => {
        const drawings = [
            { id: 'open', locked: false },
            { id: 'locked', locked: true },
        ];
        expect(unlockedDrawingIds(drawings, ['locked', 'stale', 'open'])).toEqual(['stale', 'open']);
    });
});
