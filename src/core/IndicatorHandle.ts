import type { InputSchema, InputValue } from './model/inputs';
import type { ContextSelect, EngineContextSnapshot } from './ports/ScriptingEngine';
import type { MoveTarget } from './options';

/** Per-indicator events emitted on `handle.on(...)`. */
export interface IndicatorEventMap extends Record<string, unknown> {
    ready: undefined;
    error: { error: Error };
    alert: { id: string; message: string; title?: string; time: number };
}

/** How a {@link IndicatorHandle.updateCode} call ended. Never a rejection. */
export interface CodeUpdateResult {
    /** The new code is the one running (or, hidden, the one that will run when shown). */
    ok: boolean;
    /** Why the update did not land — the previous code is running again. Null on success. */
    error: Error | null;
}

/**
 * What `chart.addIndicator(...)` returns to the developer. The handle is usable
 * synchronously; data renders when execution resolves (see `on('ready')`).
 */
export interface IndicatorHandle {
    readonly id: string;
    readonly title: string;
    /** The script source this indicator currently runs (the one it was added with,
     *  until {@link updateCode} replaces it). `undefined` for a NATIVE (core-computed)
     *  indicator — there is no script to show. What a host editor opens when a legend
     *  action asks for "the code behind this row". */
    readonly source?: string;
    /** The registered type of a NATIVE (core-computed) indicator — `undefined` for a
     *  script indicator. The two are exclusive: a handle has a `source` or a `nativeType`. */
    readonly nativeType?: string;
    /** Inputs parsed from the Pine source (populated once the script is prepared). */
    readonly inputs: readonly InputSchema[];
    /** Declaration-props schema (a strategy's `initial_capital`, an indicator's
     *  `precision`, …; populated once the script is prepared). Empty when the
     *  engine exposes none. */
    readonly props: readonly InputSchema[];
    /** Whether the indicator is currently shown (vs hidden). Hidden indicators stop computing. */
    readonly visible: boolean;
    /** The CURRENT stored input values (declaration defaults merged with every edit so
     *  far) — what state persistence diffs against the schema's `defval`s. */
    inputValues(): Record<string, InputValue>;
    /** The CURRENT stored declaration-prop values (overrides only — props keep no
     *  merged defaults; absent keys mean the declaration value). */
    propValues(): Record<string, InputValue>;
    setInput(key: string, value: InputValue): void;
    setInputs(values: Record<string, InputValue>): void;
    /** Override one declaration prop and re-run (a prop change replays the whole script). */
    setProp(key: string, value: InputValue): void;
    /** Override several declaration props at once and re-run. */
    setProps(values: Record<string, InputValue>): void;
    /**
     * Replace the script and re-run it **in place** — same `id`, same legend row, same
     * pane placement, same handle; the seam for a host editor's "run my edit" and for a
     * library's "update to the new version". The new source is prepared first: only once
     * it compiles is the running script stopped and the new one started. Until the new
     * code's first run has landed, a failure — at compile time or at run time — puts the
     * previous code back, with its input and prop values, and reports through `error`; the
     * visuals on the chart are never dropped in between.
     *
     * An edited input or prop value survives where the new script still declares its key;
     * a value still at its old declared default takes the NEW default, and anything else
     * takes the new declaration default — all before the first run, so the new code
     * computes once, with its final values.
     *
     * Resolves once the new code's first run has landed (`{ ok: true }`), or with
     * `{ ok: false, error }` after a failure. A HIDDEN indicator resolves as soon as the
     * source has compiled — it computes nothing until shown. An unchanged source resolves
     * at once; a call superseded by a later one resolves with that later call's outcome.
     * Never rejects; a native indicator resolves `ok: false`.
     */
    updateCode(source: string): Promise<CodeUpdateResult>;
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
