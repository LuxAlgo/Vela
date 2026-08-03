import type { Millis } from './model/time';
import type { StrategyState, StrategyTrade } from './model/strategy';
import type { EngineWarning } from './ports/ScriptingEngine';

/**
 * Why a script computed. The distinction that matters most is `'tick'` vs `'bar'`: a tick
 * refines the bar that is still open, so its values can still move, while `'bar'` means a
 * new bar opened and everything before it is now settled. Anything that records, alerts,
 * or exports should key off `'bar'`.
 */
export type ScriptRunCause =
    /** The first computation over the loaded history (also every re-computation an engine
     *  makes while a deep backfill is still landing — see {@link ScriptRun.complete}). */
    | 'history'
    /** The forming bar changed (a live tick). */
    | 'tick'
    /** A new bar opened — the previous one is final. */
    | 'bar'
    /** An input was edited. */
    | 'inputs'
    /** The visible range moved (viewport-aware scripts only). */
    | 'viewport'
    /** The chart's market changed and the script re-executed over the new bars. */
    | 'market';

/**
 * One computation of one script, as host code observes it — the payload of `script:run`
 * and what `runScript()` resolves to.
 *
 * The split is deliberate: everything FLAT and at the current bar rides the run itself,
 * while anything historical and unbounded (the trade ledger, a plot's full history) is a
 * call you make only when you need it, so a per-tick listener never ships a 5 000-row
 * ledger it will not read.
 */
export interface ScriptRun {
    /** The indicator id — the same one `chart.indicators()` and the lifecycle events carry. */
    readonly id: string;
    /** The title the script DECLARED (`strategy("SMA cross")`), not a placeholder. */
    readonly title: string;
    readonly kind: 'indicator' | 'strategy';
    readonly cause: ScriptRunCause;
    /** This script's first computed run. */
    readonly first: boolean;
    /** Index of the last computed bar. */
    readonly bar: number;
    /** Open time of that bar. */
    readonly time: Millis;
    /** That bar is still open, so these values are provisional. False on a static chart
     *  and on any run computed over settled history. */
    readonly forming: boolean;
    /** The run saw the FULL requested history. False only while an engine that computes
     *  progressively is still being fed a deep backfill — a deeper run will follow. */
    readonly complete: boolean;
    /** Each named plot's value at {@link bar}; `null` marks a gap. */
    readonly plots: Readonly<Record<string, number | null>>;
    /** The script's own variables at {@link bar}, keyed by the names WRITTEN in the source.
     *  Empty for an engine that exposes none. */
    readonly vars: Readonly<Record<string, unknown>>;
    /** Broker state at {@link bar} — present iff `kind === 'strategy'` and the engine
     *  reports it. */
    readonly strategy?: StrategyState;
    /** Warnings this script has raised so far. */
    readonly warnings: readonly EngineWarning[];
    /** The strategy's round trips, closed then open. Async because the ledger is unbounded:
     *  it never rides the run. Empty for an indicator. */
    trades(): Promise<readonly StrategyTrade[]>;
    /** One plot's full history. Async for the same reason. Empty for an unknown key. */
    series(key: string): Promise<ReadonlyArray<{ time: Millis; value: number | null }>>;
}

/**
 * What `chart.runScript()` resolves to: the script's first run, plus the controls for the
 * indicator it put on the chart. Never rejects — a compile or runtime failure resolves
 * with `ok: false` and the indicator is removed again (no dead legend row).
 */
export interface ScriptRunResult {
    ok: boolean;
    /** The first computed run on success; null on failure. */
    run: ScriptRun | null;
    /** The failure, or null. */
    error: Error | null;
    /** Follow this script's later runs. Returns an unsubscriber. No-op after a failure. */
    onUpdate(handler: (run: ScriptRun) => void): () => void;
    /** Take the script off the chart. No-op after a failure. */
    remove(): void;
}
