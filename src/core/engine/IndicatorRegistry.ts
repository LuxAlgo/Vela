import type { IndicatorModel } from '../model/indicator';
import type { InputValue } from '../model/inputs';
import type { PreparedScript, ScriptingEngine, ExecutionSession } from '../ports/ScriptingEngine';
import type { IndicatorRenderHandle } from '../ports/IChartRenderer';
import type { AddIndicatorOptions } from '../options';
import type { ScriptRunCause } from '../script-run';
import type { NativeIndicator, NativeIndicatorDescriptor } from '../native-indicators/NativeIndicator';

/** Per-indicator instance state held by the orchestrator. */
export interface IndicatorRecord {
    id: string;
    title: string;
    source: string;
    /**
     * Present for a NATIVE (core-computed) indicator — its type, the running instance, and the
     * descriptor (metadata + capability). Absent ⇒ an ordinary Pine indicator (driven via `engine`/
     * `prepared`/`session`). The two paths share the registry, handle, legend, and lifecycle events.
     * `stale` marks an instance re-created for a NEW market while the indicator was hidden —
     * showing it must START the fresh instance instead of resuming the old market's compute.
     */
    native?: { type: string; instance: NativeIndicator; descriptor: NativeIndicatorDescriptor; stale?: boolean };
    /** Routing/inputs options from addIndicator (used to re-route on a fresh first model). */
    options?: AddIndicatorOptions;
    /** The engine selected for this indicator's language. */
    engine?: ScriptingEngine;
    prepared?: PreparedScript;
    model?: IndicatorModel;
    renderHandle?: IndicatorRenderHandle;
    inputValues: Record<string, InputValue>;
    /** Declaration-prop values (effective defaults merged with user/add-time overrides).
     *  Stays empty for engines without props support and for natives. */
    propValues: Record<string, InputValue>;
    /** The live execution session (static or streaming) — poked on input/viewport/bar changes. */
    session?: ExecutionSession;
    /**
     * What the NEXT emitted model should be attributed to on `script:run`. Set by whoever
     * pokes the session (a bar change, an input edit, a viewport move, a market switch);
     * a model that arrives with none was produced by the session's own first execution.
     * Attribution is by last poke — the pokes are what make a model arrive at all.
     */
    pendingCause?: ScriptRunCause;
    /**
     * Set when the next emitted model should structurally remount (after an input
     * change) rather than value-patch (live tick / viewport re-run). Consumed by
     * the model handler.
     */
    pendingStructural?: boolean;
    /**
     * Hidden via `handle.setVisible(false)` / the legend eye. A hidden indicator has its
     * session torn down (no `session`) and its visuals dropped — it consumes no resources
     * until shown again, which re-executes it.
     */
    hidden?: boolean;
    /**
     * A compute is in flight and the mounted visuals are a placeholder (or stale): the
     * legend row shows a loading spinner, and `inspect()` skips the record. Cleared by
     * the next emitted model (or a failure).
     */
    loading?: boolean;
    /** `indicator:added` + the handle's `ready` have fired (they fire once, on the first COMPUTED model). */
    announced?: boolean;
    /**
     * The user explicitly placed this indicator in a pane (via `moveIndicator` / `handle.moveTo`).
     * Once locked, recomputes (live ticks, input changes) must keep the chosen `paneId` and
     * `ownScale` instead of re-deriving them from the freshly emitted model's routing.
     */
    paneLocked?: boolean;
}

export class IndicatorRegistry {
    private readonly records = new Map<string, IndicatorRecord>();
    private counter = 0;

    /** Allocate a unique, stable per-instance id. */
    nextId(prefix = 'ind'): string {
        this.counter += 1;
        return `${prefix}-${this.counter}`;
    }

    add(record: IndicatorRecord): void {
        this.records.set(record.id, record);
    }

    get(id: string): IndicatorRecord | undefined {
        return this.records.get(id);
    }

    remove(id: string): IndicatorRecord | undefined {
        const record = this.records.get(id);
        this.records.delete(id);
        return record;
    }

    all(): IndicatorRecord[] {
        return [...this.records.values()];
    }
}
