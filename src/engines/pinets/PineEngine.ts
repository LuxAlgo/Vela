import { PineTS } from 'pinets';
import { snapshotFromCtx } from './contextSnapshot';
import type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
    ExecutionMarket,
    FetchSeries,
} from '../../core/ports/ScriptingEngine';
import type { OHLCV } from '../../core/model/ohlcv';
import type { InputValue } from '../../core/model/inputs';
import {
    preparePine,
    indicatorFor,
    runPineStatic,
    openLiveStream,
    type LiveStreamHandle,
    type IndicatorCache,
    type PineToken,
} from './runtime';

/** The prepared token plus the in-process Indicator cache (reused across re-runs/ticks). */
type PineSession = PineToken & IndicatorCache;

/**
 * The in-process PineTS implementation of `ScriptingEngine`. Both the static run
 * and the live stream go through the shared `runtime` — the same code the
 * worker-backed `PineWorkerEngine` runs — so this class is just the in-process
 * wiring to the port. Vela owns market data and passes bars into `execute`;
 * this engine never fetches.
 */
export class PineEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true };

    prepare(source: string, instanceId: string): Promise<PreparedScript> {
        return Promise.resolve(preparePine(source, instanceId));
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const token = req.prepared.token as PineSession;
        const getBars = req.getBars ?? ((): OHLCV[] => req.bars);
        let inputs: Record<string, InputValue> = { ...(req.inputs ?? {}) };
        let visibleRange = req.visibleRange;
        let stopped = false;

        // ── Live streaming: one persistent context, re-executes only the forming bar per tick ──
        if (req.mode === 'live' && this.capabilities.streaming) {
            let stream: LiveStreamHandle | null = null;
            let started = false;

            const start = (): void => {
                started = true;
                stream?.stop();
                stream = openLiveStream({
                    token,
                    cache: token,
                    prepared: req.prepared,
                    inputs,
                    bars: getBars,
                    market: () => req.market,
                    fetchSeries: req.fetchSeries,
                    visibleRange,
                    onModel: (m) => {
                        if (!stopped) handlers.onModel(m);
                    },
                    onAlert: (a) => handlers.onAlert?.(a),
                    onWarning: (w) => handlers.onWarning?.(w),
                    onError: (e) => handlers.onError?.(e),
                });
            };
            // Policy A: during a history backfill the stream must not start — its history
            // length is FROZEN at start() (ticks only re-feed the tail), so a stream begun
            // over a partial history would never see the rest. `'complete'` starts it.
            if (req.historyState !== 'backfill') start();

            return {
                getContext: (select) => {
                    const ctx = stream?.lastCtx() ?? null;
                    return Promise.resolve(ctx === null ? null : snapshotFromCtx(ctx, stopped ? 'idle' : 'streaming', select));
                },
                stop: () => {
                    stopped = true;
                    stream?.stop();
                },
                update: (next) => {
                    inputs = { ...inputs, ...next };
                    if (started) start(); // re-stream with the new inputs baked in
                },
                setVisibleRange: (range) => {
                    visibleRange = range;
                    if (started) stream?.setVisibleRange(range.left, range.right); // deferred — start() applies it
                },
                notifyBars: (reason) => {
                    if (reason === 'backfill') return; // partial history — keep holding
                    if (reason === 'complete') {
                        // (Re)start over the FULL history: a stream running through the
                        // backfill has its history frozen at the pre-backfill length.
                        start();
                        return;
                    }
                    if (started) stream?.markDirty();
                },
            };
        }

        // ── Static: run on demand; re-run whenever the session is poked ──
        // Policy A: while the chart's history backfill is in progress, every run is
        // HELD (state changes merge meanwhile) — the `'complete'` notification fires
        // the first run over the full history. Backfill pokes are ignored outright.
        let deferred = req.historyState === 'backfill';
        let lastCtx: unknown = null;
        let running = false;
        const runOnce = async (): Promise<void> => {
            if (stopped) return;
            running = true;
            try {
                const outcome = await runPineStatic({
                    ind: indicatorFor(token, token.source, inputs),
                    bars: getBars(),
                    market: req.market,
                    visibleRange,
                    prepared: req.prepared,
                    instanceId: token.instanceId,
                    inputs,
                    fetchSeries: req.fetchSeries,
                });
                if (stopped) return;
                lastCtx = outcome.ctx;
                running = false;
                req.prepared.reactsToViewport = outcome.reactsToViewport; // refine in place
                for (const a of outcome.alerts) handlers.onAlert?.(a);
                for (const w of outcome.warnings) handlers.onWarning?.(w);
                handlers.onModel(outcome.model);
                handlers.onDone?.();
            } catch (err) {
                handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
            }
        };
        if (!deferred) void runOnce();

        return {
            getContext: (select) =>
                Promise.resolve(lastCtx === null ? null : snapshotFromCtx(lastCtx, running ? 'computing' : 'idle', select)),
            stop: () => {
                stopped = true;
            },
            update: (next) => {
                inputs = { ...inputs, ...next };
                if (!deferred) void runOnce();
            },
            setVisibleRange: (range) => {
                visibleRange = range;
                if (!deferred) void runOnce();
            },
            notifyBars: (reason) => {
                if (reason === 'backfill') return;
                if (reason === 'complete') deferred = false;
                if (!deferred) void runOnce();
            },
        };
    }

}
