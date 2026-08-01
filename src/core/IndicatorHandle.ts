import type { InputSchema, InputValue } from './model/inputs';
import type { ContextSelect, EngineContextSnapshot } from './ports/ScriptingEngine';
import type { MoveTarget } from './options';

/** Per-indicator events emitted on `handle.on(...)`. */
export interface IndicatorEventMap extends Record<string, unknown> {
    ready: undefined;
    error: { error: Error };
    alert: { id: string; message: string; title?: string; time: number };
}

/**
 * What `chart.addIndicator(...)` returns to the developer. The handle is usable
 * synchronously; data renders when execution resolves (see `on('ready')`).
 */
export interface IndicatorHandle {
    readonly id: string;
    readonly title: string;
    /** The script source this indicator was added with. `undefined` for a NATIVE
     *  (core-computed) indicator — there is no script to show. What a host editor
     *  opens when a legend action asks for "the code behind this row". */
    readonly source?: string;
    /** Inputs parsed from the Pine source (populated once the script is prepared). */
    readonly inputs: readonly InputSchema[];
    /** Whether the indicator is currently shown (vs hidden). Hidden indicators stop computing. */
    readonly visible: boolean;
    setInput(key: string, value: InputValue): void;
    setInputs(values: Record<string, InputValue>): void;
    /**
     * Hide or show the indicator. Hiding **suspends** it — its visuals are dropped (the legend
     * row stays, marked hidden) and its computation stops (the engine session is torn down), so a
     * hidden indicator consumes no resources. Showing re-runs it over the current bars.
     */
    setVisible(visible: boolean): void;
    /**
     * Move (or merge) this indicator to another pane: the main price pane (`'price'`),
     * an existing pane (`{ pane: id }`), or a fresh pane (`{ newPane: {...} }`, optionally
     * placed relative to an existing pane). Merging into a pane it doesn't own gives it its
     * own scale column. No-op (with a warning) on a renderer without pane management.
     */
    moveTo(target: MoveTarget): void;
    on<K extends keyof IndicatorEventMap>(event: K, handler: (payload: IndicatorEventMap[K]) => void): () => void;
    /**
     * Read-only snapshot of the engine's execution context (variables, plots, the
     * script's return value…). Resolves null when the engine lacks the capability or
     * nothing has run yet. Always a copy — never a live reference. `select` limits the
     * extracted keys (keeps worker transfers small). Re-pull on `'context:changed'`.
     */
    context(select?: ContextSelect): Promise<EngineContextSnapshot | null>;
    remove(): void;
}
