// Unified undo/redo timeline — app-level ops (indicator add/remove) and core drawing
// edits share ONE stack, so Ctrl+Z / Ctrl+Y step through both in the order they happened
// (the reference behavior). Drawing entries delegate to the core's own drawing history.
import type { Vela } from '../Vela';

export interface HistoryAction {
    undo(): void;
    redo(): void;
}

export class WidgetHistory {
    private readonly undoStack: HistoryAction[] = [];
    private readonly redoStack: HistoryAction[] = [];
    private readonly listeners = new Set<() => void>();
    private unsubs: Array<() => void> = [];
    private muted = false;

    /** `getChart` late-resolves the CURRENT chart: drawing steps recorded before a chart
     *  rebuild must undo on the chart that exists when the user presses Ctrl+Z, not on a
     *  destroyed instance captured at record time. */
    constructor(private readonly getChart: () => Vela | null = () => null) {}

    /** Record a reversible action (a fresh edit forks history: redo branch clears). */
    push(action: HistoryAction): void {
        if (this.muted) return;
        this.undoStack.push(action);
        this.redoStack.length = 0;
        this.notify();
    }

    undo(): void {
        const a = this.undoStack.pop();
        if (!a) return;
        this.mutedRun(() => a.undo());
        this.redoStack.push(a);
        this.notify();
    }

    redo(): void {
        const a = this.redoStack.pop();
        if (!a) return;
        this.mutedRun(() => a.redo());
        this.undoStack.push(a);
        this.notify();
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    onChange(cb: () => void): () => void {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    /** (Re)bind to a chart: drawing edits enter the unified stack as delegate steps. */
    onChart(chart: Vela): void {
        for (const u of this.unsubs) u();
        this.unsubs = [
            chart.on('drawing:created', () => this.pushDrawingStep()),
            chart.on('drawing:edited', () => this.pushDrawingStep()),
            chart.on('drawing:removed', () => this.pushDrawingStep()),
        ];
    }

    destroy(): void {
        for (const u of this.unsubs) u();
        this.unsubs = [];
        this.listeners.clear();
    }

    private pushDrawingStep(): void {
        this.push({ undo: () => this.getChart()?.drawings.undo(), redo: () => this.getChart()?.drawings.redo() });
    }

    /** Replaying an action must not re-record the drawing events it triggers. */
    private mutedRun(fn: () => void): void {
        this.muted = true;
        try {
            fn();
        } finally {
            this.muted = false;
        }
    }

    private notify(): void {
        for (const cb of this.listeners) cb();
    }
}
