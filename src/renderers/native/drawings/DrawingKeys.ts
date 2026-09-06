/**
 * Pure keyboard-shortcut mapping for the drawings layer — `(event, context) →
 * action | null`, with no DOM access, so it's unit-testable headlessly (mirrors
 * the chart's own `keyToAction`). The {@link UserDrawingController} adapts the
 * action into a renderer→core intent. `Escape` is handled by the controller
 * directly (it's stateful: popup open / placing / selection).
 */
export interface DrawingKeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

export interface DrawingKeyContext {
    /** A real selection exists (drives copy / duplicate / nudge). */
    hasSelection: boolean;
    /** A deletable target exists (selection OR the hovered drawing). */
    hasTarget: boolean;
    /** A label text field is focused — don't hijack keystrokes. */
    editingText: boolean;
}

export type DrawingKeyAction =
    | { kind: 'undo' }
    | { kind: 'redo' }
    | { kind: 'copy' }
    | { kind: 'paste' }
    | { kind: 'duplicate' }
    | { kind: 'delete' }
    | { kind: 'nudge'; dx: number; dy: number }; // pixel deltas (controller converts via the projector)

const NUDGE_STEP = 1; // px per arrow press; Shift = a coarser jump
const NUDGE_STEP_COARSE = 10;

/** Keep keyboard deletion non-destructive for locked drawings. Unknown stale ids pass through harmlessly. */
export function unlockedDrawingIds(drawings: readonly { id: string; locked: boolean }[], ids: readonly string[]): string[] {
    const locked = new Set(drawings.filter((drawing) => drawing.locked).map((drawing) => drawing.id));
    return ids.filter((id) => !locked.has(id));
}

export function keyToDrawingAction(e: DrawingKeyEvent, ctx: DrawingKeyContext): DrawingKeyAction | null {
    if (ctx.editingText) return null; // typing a label → leave the keys alone
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
        switch (e.key.toLowerCase()) {
            case 'z':
                return e.shiftKey ? { kind: 'redo' } : { kind: 'undo' };
            case 'y':
                return { kind: 'redo' };
            case 'c':
                return ctx.hasSelection ? { kind: 'copy' } : null;
            case 'v':
                return { kind: 'paste' };
            case 'd':
                return ctx.hasSelection ? { kind: 'duplicate' } : null;
            default:
                return null;
        }
    }
    if (e.key === 'Delete' || e.key === 'Backspace') return ctx.hasTarget ? { kind: 'delete' } : null;
    if (ctx.hasSelection) {
        const s = e.shiftKey ? NUDGE_STEP_COARSE : NUDGE_STEP;
        switch (e.key) {
            case 'ArrowLeft':
                return { kind: 'nudge', dx: -s, dy: 0 };
            case 'ArrowRight':
                return { kind: 'nudge', dx: s, dy: 0 };
            case 'ArrowUp':
                return { kind: 'nudge', dx: 0, dy: -s };
            case 'ArrowDown':
                return { kind: 'nudge', dx: 0, dy: s };
        }
    }
    return null;
}

/** Whether the keyboard event targets an editable field (so shortcuts must stand down). */
export function isEditingText(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}
