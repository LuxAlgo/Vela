import type { OHLCV } from '../../core/model/ohlcv';
import type { InputValue } from '../../core/model/inputs';
import type { IndicatorModel } from '../../core/model/indicator';
import type { BarRange } from '../../core/ports/MarketDataFeed';
import type { PreparedScript, ExecutionMarket, VisibleBarRange, EngineAlert, EngineWarning, ContextSelect, EngineContextSnapshot } from '../../core/ports/ScriptingEngine';

/**
 * The message protocol between `PineWorkerEngine` (main thread) and `worker.ts`
 * (worker thread). Everything here is structured-clone-serializable — notably the
 * neutral `IndicatorModel`, which is plain data, so results cross for free.
 *
 * Functions in the port (`getBars`, `fetchSeries`, handlers) don't cross the wire:
 * bars are shipped as data, handler callbacks become worker→main messages, and a
 * `fetchSeries` call becomes a request/response pair (the worker asks, the main
 * thread — which owns the cache + network — answers).
 */

export type MainToWorker =
    | { kind: 'prepare'; reqId: number; source: string; instanceId: string }
    | { kind: 'execute'; sessionId: number; prepared: PreparedScript; market: ExecutionMarket; bars: OHLCV[]; inputs: Record<string, InputValue>; visibleRange?: VisibleBarRange; mode?: 'static' | 'live'; historyState?: 'backfill' | 'complete' }
    | { kind: 'update'; sessionId: number; inputs: Record<string, InputValue> }
    | { kind: 'setVisibleRange'; sessionId: number; range: VisibleBarRange }
    | { kind: 'notifyBars'; sessionId: number; bars: OHLCV[] }
    /**
     * LIVE sessions only — bar delta for the worker-local array the streaming
     * provider polls. Normally the TAIL (the forming bar + anything newer since
     * the last send); with `restart: true` a FULL snapshot that (re)starts the
     * stream over it (history backfill completed / inputs changed).
     */
    | { kind: 'bars'; sessionId: number; bars: OHLCV[]; restart?: boolean }
    | { kind: 'getContext'; sessionId: number; reqId: number; select?: ContextSelect }
    | { kind: 'stop'; sessionId: number }
    | { kind: 'fetchSeriesResult'; reqId: number; bars?: OHLCV[]; error?: string };

export type WorkerToMain =
    | { kind: 'prepared'; reqId: number; prepared?: PreparedScript; error?: string }
    | { kind: 'model'; sessionId: number; model: IndicatorModel }
    | { kind: 'alert'; sessionId: number; alert: EngineAlert }
    | { kind: 'warning'; sessionId: number; warning: EngineWarning }
    | { kind: 'error'; sessionId: number; message: string }
    | { kind: 'done'; sessionId: number }
    | { kind: 'reactsToViewport'; sessionId: number; value: boolean }
    | { kind: 'contextResult'; reqId: number; snapshot: EngineContextSnapshot | null }
    | { kind: 'fetchSeries'; reqId: number; symbol: string; timeframe: string; range: BarRange };

/** Minimal Worker surface the proxy needs — the real `Worker` satisfies it; tests inject a fake. */
export interface WorkerLike {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    terminate(): void;
}
