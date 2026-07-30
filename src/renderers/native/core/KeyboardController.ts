/**
 * Keyboard navigation for the native renderer (accessibility). Mirrors the pointer
 * gestures from InputController as discrete key actions and emits the SAME high-level
 * intents (pan / zoom / move crosshair / reset). The renderer owns the focusable host,
 * the ARIA live region, and the actual viewport/crosshair math — this just classifies a
 * keydown into an intent and dispatches it, so the mapping is unit-testable in isolation.
 */

export interface KeyboardControllerDeps {
    /** Pan the view by `bars` (positive ⇒ toward the latest/right, negative ⇒ earlier/left). */
    panByBars(bars: number): void;
    /** Step the zoom one notch (+1 = in, -1 = out), right-edge anchored. */
    zoomByStep(direction: 1 | -1): void;
    /** Move the focused/crosshair bar by `delta`, scrolling it into view + announcing it. */
    stepCrosshair(delta: number): void;
    /** Jump the focused bar to the first or last bar. */
    jumpToEdge(edge: 'first' | 'last'): void;
    /** Reset the view (fit content + drop manual scales). */
    resetView(): void;
    /** Scroll back to the most recent bars, keeping the current zoom. */
    scrollToRealtime(): void;
    /** Hide the crosshair (and stop announcing). */
    clearCrosshair(): void;
    /** Optional pre-empt — the drawings layer handles Escape/Delete first. Returns true when consumed. */
    preempt?(e: KeyboardEvent): boolean;
}

/** A classified keyboard intent (pure result of `keyToAction`), or null when unhandled. */
export type KeyAction =
    | { kind: 'pan'; bars: number }
    | { kind: 'zoom'; direction: 1 | -1 }
    | { kind: 'step'; delta: number }
    | { kind: 'edge'; edge: 'first' | 'last' }
    | { kind: 'reset' }
    | { kind: 'realtime' }
    | { kind: 'clear' };

const PAN_BARS = 10; // Shift+Arrow pans this many bars at once

/**
 * Map a keydown to a chart action (pure). Arrow keys step the crosshair bar-to-bar
 * (Shift = pan a chunk); Alt+Shift+Right jumps back to the latest bars; `+`/`-` zoom;
 * Home/End jump to the data edges; `0` resets; Escape clears the crosshair. Returns
 * null for keys the chart doesn't own.
 */
export function keyToAction(e: Pick<KeyboardEvent, 'key' | 'shiftKey'> & { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }): KeyAction | null {
    // Ctrl/Cmd chords belong to the HOST (a widget/workspace keymap: pan/zoom glides,
    // undo, …). The chart's own navigation is plain-key only — if a chorded arrow also
    // stepped the crosshair here, its scroll-into-view would fight the host's pan glide
    // (the same keystroke handled twice reads as a bounce).
    if (e.ctrlKey || e.metaKey) return null;
    switch (e.key) {
        case 'ArrowLeft':
            return e.shiftKey ? { kind: 'pan', bars: -PAN_BARS } : { kind: 'step', delta: -1 };
        case 'ArrowRight':
            if (e.altKey && e.shiftKey) return { kind: 'realtime' };
            return e.shiftKey ? { kind: 'pan', bars: PAN_BARS } : { kind: 'step', delta: 1 };
        case '+':
        case '=':
            return { kind: 'zoom', direction: 1 };
        case '-':
        case '_':
            return { kind: 'zoom', direction: -1 };
        case 'Home':
            return { kind: 'edge', edge: 'first' };
        case 'End':
            return { kind: 'edge', edge: 'last' };
        case '0':
            return { kind: 'reset' };
        case 'Escape':
            return { kind: 'clear' };
        default:
            return null;
    }
}

export class KeyboardController {
    private el: HTMLElement | null = null;

    constructor(private readonly deps: KeyboardControllerDeps) {}

    attach(el: HTMLElement): void {
        this.el = el;
        el.addEventListener('keydown', this.onKey);
    }

    detach(): void {
        this.el?.removeEventListener('keydown', this.onKey);
        this.el = null;
    }

    private readonly onKey = (e: KeyboardEvent): void => {
        // The drawings layer gets Escape/Delete first (cancel placing, delete selection).
        if (this.deps.preempt?.(e)) {
            e.preventDefault();
            return;
        }
        const action = keyToAction(e);
        if (!action) return;
        e.preventDefault();
        switch (action.kind) {
            case 'pan':
                this.deps.panByBars(action.bars);
                break;
            case 'zoom':
                this.deps.zoomByStep(action.direction);
                break;
            case 'step':
                this.deps.stepCrosshair(action.delta);
                break;
            case 'edge':
                this.deps.jumpToEdge(action.edge);
                break;
            case 'reset':
                this.deps.resetView();
                break;
            case 'realtime':
                this.deps.scrollToRealtime();
                break;
            case 'clear':
                this.deps.clearCrosshair();
                break;
        }
    };
}
