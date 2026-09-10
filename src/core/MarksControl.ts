import type { MarksController } from './marks/MarksController';
import type { MarkGroup, TimelineMark } from './marks/types';

/**
 * The chart's timeline-marks control surface (`chart.marks`) — sibling of
 * `chart.drawings` / `chart.panes`. Marks are DATA, not user state: the chart never
 * persists them; re-supply them when the market changes (`market:changed`). The model
 * is core-owned, so every method works on any renderer; on one without the
 * `timelineMarks` capability nothing paints (`supported` reports it) and the group
 * visibility setter warns + no-ops.
 */
export class MarksControl {
    constructor(private readonly ctrl: MarksController) {}

    /** Whether the active renderer paints timeline marks. */
    get supported(): boolean {
        return this.ctrl.supported;
    }

    /** Add one mark; an existing id is replaced in place. */
    add(mark: TimelineMark): this {
        this.ctrl.add(mark);
        return this;
    }

    /** Replace the whole set (a market switch). */
    set(marks: readonly TimelineMark[]): this {
        this.ctrl.set(marks);
        return this;
    }

    remove(id: string): this {
        this.ctrl.remove(id);
        return this;
    }

    clear(): this {
        this.ctrl.clear();
        return this;
    }

    /** Every mark, in insertion order. */
    all(): TimelineMark[] {
        return this.ctrl.all();
    }

    /**
     * Define a visibility group's presentation: the label of its checkbox in chart
     * settings (the Events tab) and its default visibility. Marks may name a group
     * that was never defined — it then shows its capitalized id.
     */
    defineGroup(group: MarkGroup): this {
        this.ctrl.defineGroup(group);
        return this;
    }

    /** The defined groups, in definition order. */
    groups(): MarkGroup[] {
        return this.ctrl.groupDefinitions();
    }

    /** Show or hide one group's marks — the same switch as the settings checkbox, persisted with the chart's config. */
    setGroupVisible(id: string, visible = true): this {
        this.ctrl.setGroupVisible(id, visible);
        return this;
    }

    /** A group's effective visibility (the user's choice, else the group's declared default). */
    isGroupVisible(id: string): boolean {
        return this.ctrl.isGroupVisible(id);
    }
}
