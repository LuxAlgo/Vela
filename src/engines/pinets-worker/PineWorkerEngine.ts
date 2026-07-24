import type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
    EngineContextSnapshot,
} from '../../core/ports/ScriptingEngine';
import type { OHLCV } from '../../core/model/ohlcv';
import type { BarRange } from '../../core/ports/MarketDataFeed';
import type { MainToWorker, WorkerToMain, WorkerLike } from './protocol';
import workerCode from 'inline-worker:./worker.ts';

export interface PineWorkerOptions {
    /**
     * Override the worker source. By default the worker is inlined into the bundle
     * and spawned from a Blob URL (no separate file, no URL to configure); set this
     * to load a hosted worker file instead — e.g. under a CSP that blocks `blob:`.
     */
    workerUrl?: string;
    /** Worker factory — tests inject a fake; defaults to the inlined Blob worker. */
    createWorker?: () => WorkerLike;
}

/**
 * Spawn the worker. Default: a Blob URL of the build-time-inlined worker source.
 * Pass `workerUrl` to load a hosted file instead.
 */
function spawnWorker(workerUrl?: string): WorkerLike {
    if (workerUrl) return new Worker(workerUrl) as unknown as WorkerLike;
    const url = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
    const worker = new Worker(url) as unknown as WorkerLike;
    URL.revokeObjectURL(url); // the Worker keeps the blob alive after construction
    return worker;
}

interface SessionEntry {
    handlers: ExecutionHandlers;
    req: ExecutionRequest;
    /** Session kind — LIVE sessions hold a persistent in-worker stream and bypass the run bookkeeping. */
    mode: 'static' | 'live';
    /** Worker runs in flight for this session (STATIC only: execute/update/setVisibleRange/notifyBars each trigger one). */
    pendingRuns: number;
    /** Bars changed while a run was in flight — re-run once (with a fresh snapshot) when it lands. STATIC only. */
    dirtyBars: boolean;
    /** LIVE only: newest bar time already shipped — a tick sends just the bars at/after it. */
    lastSentTime: number;
}

/**
 * A worker-backed PineTS engine: identical Pine semantics to `PineEngine`, but the
 * transpile + execution run on a Web Worker, keeping the main thread responsive.
 * Implements the same `ScriptingEngine` port, so the orchestrator never learns a
 * worker exists. Secondary fetches (request.security) round-trip back to the main
 * thread, where the cache + network live.
 *
 * Live charts stream: the worker holds ONE persistent PineTS streaming context per
 * live session, so a tick ships only the forming bar (a tiny `bars` delta) and the
 * script re-executes incrementally — never a full snapshot + full re-run per tick.
 * Static sessions (non-live charts, viewport-dependent scripts) run per poke with
 * the pending-run coalescing below; live messages NEVER enter that bookkeeping —
 * a live session acks nothing, so counting it would jam the coalescing forever.
 */
export class PineWorkerEngine implements ScriptingEngine {
    readonly language = 'pine';
    readonly capabilities: EngineCapabilities = { streaming: true, visibleRange: true, inputs: true };

    private worker: WorkerLike | null = null;
    private readonly spawn: () => WorkerLike;
    private readonly prepares = new Map<number, { resolve: (p: PreparedScript) => void; reject: (e: Error) => void }>();
    private readonly sessions = new Map<number, SessionEntry>();
    private reqId = 0;
    private readonly contextWaits = new Map<number, (snap: EngineContextSnapshot | null) => void>();
    private sessionId = 0;

    constructor(opts: PineWorkerOptions = {}) {
        this.spawn = opts.createWorker ?? ((): WorkerLike => spawnWorker(opts.workerUrl));
    }

    prepare(source: string, instanceId: string): Promise<PreparedScript> {
        const reqId = ++this.reqId;
        return new Promise<PreparedScript>((resolve, reject) => {
            this.prepares.set(reqId, { resolve, reject });
            this.post({ kind: 'prepare', reqId, source, instanceId });
        });
    }

    execute(req: ExecutionRequest, handlers: ExecutionHandlers): ExecutionSession {
        const sessionId = ++this.sessionId;
        const mode: 'static' | 'live' = req.mode === 'live' ? 'live' : 'static';
        const bars = this.barsOf(req);
        const entry: SessionEntry = { handlers, req, mode, pendingRuns: 0, dirtyBars: false, lastSentTime: bars[bars.length - 1]?.time ?? 0 };
        this.sessions.set(sessionId, entry);
        const msg: MainToWorker = {
            kind: 'execute',
            sessionId,
            prepared: req.prepared,
            market: req.market,
            bars,
            inputs: { ...(req.inputs ?? {}) },
            visibleRange: req.visibleRange,
            mode,
            historyState: req.historyState,
        };
        // Live messages never enter the pending-run bookkeeping — the stream acks nothing.
        if (mode === 'live') this.post(msg);
        else this.postRun(entry, msg);
        return {
            getContext: (select) =>
                new Promise<EngineContextSnapshot | null>((resolve) => {
                    const reqId = ++this.reqId;
                    this.contextWaits.set(reqId, resolve);
                    this.post({ kind: 'getContext', sessionId, reqId, select });
                }),
            stop: () => {
                this.post({ kind: 'stop', sessionId });
                this.sessions.delete(sessionId);
            },
            update: (inputs) => {
                if (mode === 'live') this.post({ kind: 'update', sessionId, inputs });
                else this.postRun(entry, { kind: 'update', sessionId, inputs });
            },
            setVisibleRange: (range) => {
                if (mode === 'live') this.post({ kind: 'setVisibleRange', sessionId, range });
                else this.postRun(entry, { kind: 'setVisibleRange', sessionId, range });
            },
            notifyBars: (reason) => this.notifyBars(sessionId, reason),
        };
    }

    /**
     * Coalesced bar-change notification: shipping a full bars snapshot + a complete re-run per
     * tick is wasteful when ticks burst (a gap heal, a fast market) — while ANY run is in flight
     * for the session, just mark it dirty and re-run ONCE (with a fresh snapshot) when the run
     * lands. The worker can't read the live bars array, hence the snapshot per posted run.
     *
     * `'backfill'` notifications never cross to the worker at all: every posted run ships a
     * FRESH full snapshot anyway, so intermediate partial-history snapshots buy nothing — the
     * worker sees the deepened history on the `'complete'` (or next tick) run. This also keeps
     * the pending-run bookkeeping honest (a posted-but-skipped run would jam the coalescing).
     */
    private notifyBars(sessionId: number, reason?: 'backfill' | 'complete'): void {
        if (reason === 'backfill') return;
        const s = this.sessions.get(sessionId);
        if (!s) return;
        if (s.mode === 'live') {
            const bars = this.barsOf(s.req);
            if (reason === 'complete') {
                // Backfill finished: (re)start the stream over the FULL history in one snapshot.
                this.post({ kind: 'bars', sessionId, bars, restart: true });
                s.lastSentTime = bars[bars.length - 1]?.time ?? 0;
                return;
            }
            // A tick: ship only the bars at/after the last sent one (>= — the forming bar
            // keeps its open time across updates; a heal's whole range arrives the same way).
            const tail = bars.filter((b) => b.time >= s.lastSentTime);
            if (tail.length === 0) return;
            this.post({ kind: 'bars', sessionId, bars: tail });
            s.lastSentTime = tail[tail.length - 1]!.time;
            return;
        }
        if (s.pendingRuns > 0) {
            s.dirtyBars = true;
            return;
        }
        this.postRun(s, { kind: 'notifyBars', sessionId, bars: this.barsOf(s.req) });
    }

    /** Post a message that triggers exactly one worker run (acked by one `done`/`error`). */
    private postRun(entry: SessionEntry, msg: MainToWorker): void {
        entry.pendingRuns += 1;
        this.post(msg);
    }

    /** A worker run finished (`done` or `error`): flush a coalesced bar notification, if any. */
    private runFinished(sessionId: number): void {
        const s = this.sessions.get(sessionId);
        if (!s || s.mode === 'live') return; // a live stream's 'error' is not a run ack
        s.pendingRuns = Math.max(0, s.pendingRuns - 1);
        if (s.pendingRuns === 0 && s.dirtyBars) {
            s.dirtyBars = false;
            this.postRun(s, { kind: 'notifyBars', sessionId, bars: this.barsOf(s.req) });
        }
    }

    /** Terminate the worker (no port hook calls this yet; exposed for host cleanup). */
    terminate(): void {
        this.worker?.terminate();
        this.worker = null;
    }

    private barsOf(req: ExecutionRequest): OHLCV[] {
        return (req.getBars ?? ((): OHLCV[] => req.bars))();
    }

    private workerInstance(): WorkerLike {
        if (!this.worker) {
            this.worker = this.spawn();
            this.worker.addEventListener('message', (e) => this.onMessage(e.data as WorkerToMain));
        }
        return this.worker;
    }

    private post(msg: MainToWorker): void {
        this.workerInstance().postMessage(msg);
    }

    private onMessage(msg: WorkerToMain): void {
        switch (msg.kind) {
            case 'prepared': {
                const p = this.prepares.get(msg.reqId);
                if (!p) return;
                this.prepares.delete(msg.reqId);
                if (msg.error) p.reject(new Error(msg.error));
                else if (msg.prepared) p.resolve(msg.prepared);
                return;
            }
            case 'model':
                this.sessions.get(msg.sessionId)?.handlers.onModel(msg.model);
                return;
            case 'alert':
                this.sessions.get(msg.sessionId)?.handlers.onAlert?.(msg.alert);
                return;
            case 'warning':
                this.sessions.get(msg.sessionId)?.handlers.onWarning?.(msg.warning);
                return;
            case 'error':
                this.sessions.get(msg.sessionId)?.handlers.onError?.(new Error(msg.message));
                this.runFinished(msg.sessionId);
                return;
            case 'done':
                this.sessions.get(msg.sessionId)?.handlers.onDone?.();
                this.runFinished(msg.sessionId);
                return;
            case 'reactsToViewport': {
                const s = this.sessions.get(msg.sessionId);
                if (s) s.req.prepared.reactsToViewport = msg.value; // refine in place, like PineEngine
                return;
            }
            case 'fetchSeries':
                void this.serveFetch(msg.reqId, msg.symbol, msg.timeframe, msg.range);
                return;
            case 'contextResult': {
                const waiter = this.contextWaits.get(msg.reqId);
                this.contextWaits.delete(msg.reqId);
                waiter?.(msg.snapshot);
                return;
            }
        }
    }

    /**
     * Answer a worker's secondary-fetch request via the orchestrator's gateway. Any
     * live session's `fetchSeries` works — they all route to the same chart-level
     * cache-backed gateway (same provider, neutral by (symbol, timeframe)).
     */
    private async serveFetch(reqId: number, symbol: string, timeframe: string, range: BarRange): Promise<void> {
        const fetchSeries = [...this.sessions.values()].find((s) => s.req.fetchSeries)?.req.fetchSeries;
        if (!fetchSeries) {
            this.post({ kind: 'fetchSeriesResult', reqId, bars: [] });
            return;
        }
        try {
            this.post({ kind: 'fetchSeriesResult', reqId, bars: await fetchSeries(symbol, timeframe, range) });
        } catch (err) {
            this.post({ kind: 'fetchSeriesResult', reqId, error: err instanceof Error ? err.message : String(err) });
        }
    }
}
