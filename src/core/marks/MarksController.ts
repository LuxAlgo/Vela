import type { Unsubscribe } from '../util/types';
import type { IChartRenderer } from '../ports/IChartRenderer';
import type { TypedEventBus } from '../events/EventBus';
import type { VelaEventMap } from '../events/types';
import type { MarkGroup, TimelineMark } from './types';

/**
 * Renderer-agnostic owner of the timeline-mark model (backs `chart.marks`). Holds the
 * marks + group definitions (the source of truth), pushes snapshots to the renderer
 * through its optional `setTimelineMarks` seam, and re-emits the renderer's glyph
 * clicks as `mark:click`. Inert on a renderer without the `timelineMarks` capability —
 * the model still fills, so `all()` and a later host UI see it.
 */
export class MarksController {
    /** Insertion-ordered — the order a cluster falls back to for equal times. */
    private readonly marks = new Map<string, TimelineMark>();
    private readonly groups = new Map<string, MarkGroup>();
    private readonly enabled: boolean;
    private readonly subs: Unsubscribe[] = [];

    constructor(
        private readonly renderer: IChartRenderer,
        events: TypedEventBus<VelaEventMap>,
    ) {
        this.enabled = !!renderer.capabilities.timelineMarks && typeof renderer.setTimelineMarks === 'function';
        if (this.enabled && renderer.onMarkClick) this.subs.push(renderer.onMarkClick((e) => events.emit('mark:click', e)));
    }

    /** Whether the active renderer paints timeline marks. */
    get supported(): boolean {
        return this.enabled;
    }

    /** Add (or replace, by id) one mark. */
    add(mark: TimelineMark): void {
        this.marks.set(mark.id, validateMark(mark));
        this.sync();
    }

    /** Replace the whole set — a market switch. */
    set(marks: readonly TimelineMark[]): void {
        this.marks.clear();
        for (const m of marks) this.marks.set(m.id, validateMark(m));
        this.sync();
    }

    remove(id: string): boolean {
        const had = this.marks.delete(id);
        if (had) this.sync();
        return had;
    }

    clear(): void {
        if (this.marks.size === 0) return;
        this.marks.clear();
        this.sync();
    }

    /** Every mark, in insertion order (shallow copies — mutating one changes nothing). */
    all(): TimelineMark[] {
        return [...this.marks.values()].map((m) => ({ ...m, glyph: { ...m.glyph } }));
    }

    /** Define (or replace) a group's presentation — its settings label and default visibility. */
    defineGroup(group: MarkGroup): void {
        if (!group || typeof group.id !== 'string' || group.id.length === 0) throw new Error('[vela] marks.defineGroup: `id` must be a non-empty string');
        if (typeof group.label !== 'string') throw new Error(`[vela] marks.defineGroup: group "${group.id}" needs a string \`label\``);
        this.groups.set(group.id, { ...group });
        this.sync();
    }

    /** The defined groups, in definition order. */
    groupDefinitions(): MarkGroup[] {
        return [...this.groups.values()].map((g) => ({ ...g }));
    }

    /**
     * Show or hide one group's marks. The choice lives in the renderer's cosmetic config
     * (the `marks` feature) — what the settings dialog's Events checkboxes edit and what
     * a persisted chart restores — so it warns + no-ops on a renderer without it.
     */
    setGroupVisible(id: string, visible: boolean): void {
        if (!this.renderer.features.includes('marks')) {
            console.warn(`[vela] renderer "${this.renderer.name}" does not paint timeline marks — setGroupVisible ignored.`);
            return;
        }
        this.renderer.applyFeature('marks', { groups: { [id]: visible } });
    }

    /** A group's effective visibility: the user's (persisted) choice, else the group's declared default, else visible. */
    isGroupVisible(id: string): boolean {
        const state = this.renderer.readFeature('marks') as { groups?: Record<string, unknown> } | undefined;
        const chosen = state?.groups?.[id];
        if (typeof chosen === 'boolean') return chosen;
        return this.groups.get(id)?.visible !== false;
    }

    destroy(): void {
        for (const unsub of this.subs) unsub();
        this.subs.length = 0;
    }

    private sync(): void {
        if (!this.enabled) return;
        this.renderer.setTimelineMarks!([...this.marks.values()], [...this.groups.values()]);
    }
}

/** Reject the malformed shapes a host can plausibly pass — a mark that cannot be placed or drawn is a programming error, not data to tolerate. */
function validateMark(mark: TimelineMark): TimelineMark {
    if (!mark || typeof mark !== 'object') throw new Error('[vela] marks: a mark must be an object');
    if (typeof mark.id !== 'string' || mark.id.length === 0) throw new Error('[vela] marks: `id` must be a non-empty string');
    if (typeof mark.time !== 'number' || !Number.isFinite(mark.time)) throw new Error(`[vela] marks: mark "${mark.id}" needs a finite epoch-ms \`time\``);
    if (!mark.glyph || typeof mark.glyph !== 'object' || typeof mark.glyph.color !== 'string') throw new Error(`[vela] marks: mark "${mark.id}" needs a glyph with a \`color\``);
    return { ...mark, glyph: { ...mark.glyph } };
}
