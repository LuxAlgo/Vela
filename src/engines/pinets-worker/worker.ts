import { preparePine, indicatorFor, runPineStatic, openLiveStream, type IndicatorCache, type PineToken, type LiveStreamHandle } from '../pinets/runtime';
import { snapshotFromCtx } from '../pinets/contextSnapshot';
import type { OHLCV } from '../../core/model/ohlcv';
import type { InputValue } from '../../core/model/inputs';
import type { PreparedScript, ExecutionMarket, VisibleBarRange, FetchSeries } from '../../core/ports/ScriptingEngine';
import type { MainToWorker, WorkerToMain } from './protocol';

/**
 * The worker entry: runs the shared PineTS `runtime` off the main thread. Built as
 * a self-contained IIFE bundle (`vela.pinets-worker.global.js`) and spawned by
 * `PineWorkerEngine`. Two session kinds:
 * - **static**: each `execute`/`update`/`setVisibleRange`/`notifyBars` triggers a
 *   fresh full run and posts the neutral model back;
 * - **live**: ONE persistent `pine.stream(...)` context polls a worker-local bar
 *   array that `bars` messages keep current — a tick sends one bar across and
 *   PineTS re-executes only the forming bar (true incremental streaming).
 */

/** Minimal worker-global surface (avoids needing the "webworker" tsconfig lib). */
interface WorkerScope {
    postMessage(message: unknown): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
const ctx = self as unknown as WorkerScope;
const post = (msg: WorkerToMain): void => ctx.postMessage(msg);

interface Session {
    id: number;
    mode: 'static' | 'live';
    prepared: PreparedScript;
    market: ExecutionMarket;
    bars: OHLCV[];
    inputs: Record<string, InputValue>;
    visibleRange?: VisibleBarRange;
    cache: IndicatorCache;
    stopped: boolean;
    /** Raw context of the most recent evaluation (static run or streamed tick). */
    lastCtx: unknown;
    /**
     * The chart's history backfill is still in progress (policy A): hold every run —
     * merging state changes meanwhile — until history completes. For a STATIC session
     * the first `notifyBars` releases it (the main thread posts one only for
     * `'complete'`/ticks, never for backfill chunks), and skipped runs still ack with
     * `done` so the main thread's pending-run bookkeeping balances. For a LIVE session
     * the `restart: true` bars message (the 'complete' snapshot) starts the stream.
     */
    deferred: boolean;
    /** Serializes a STATIC session's runs FIFO — see {@link enqueueRun}. */
    chain: Promise<void>;
    /** LIVE only: the persistent stream handle; null until started (deferred) and after stop. */
    stream: LiveStreamHandle | null;
}

const sessions = new Map<number, Session>();
const pendingFetch = new Map<number, { resolve: (bars: OHLCV[]) => void; reject: (err: Error) => void }>();
let fetchReqId = 0;

/**
 * Worker-side `fetchSeries`: the cache + network live on the main thread, so a
 * secondary fetch (request.security) round-trips there as a request/response pair.
 * PineTS awaits the provider's getMarketData, so awaiting this round-trip is fine.
 */
const fetchSeries: FetchSeries = (symbol, timeframe, range) =>
    new Promise<OHLCV[]>((resolve, reject) => {
        const reqId = ++fetchReqId;
        pendingFetch.set(reqId, { resolve, reject });
        post({ kind: 'fetchSeries', reqId, symbol, timeframe, range });
    });

/**
 * Enqueue a run on the session's FIFO chain instead of firing it loose. A run that awaits a
 * secondary fetch (request.security round-trips to the main thread) yields the event loop, so
 * two loose runs for the same session could complete OUT OF ORDER — the stale model would then
 * land last and overwrite the fresher one. Serializing per session makes the last-posted model
 * always the most recent. `runSession` never rejects (it posts `error` instead), so the chain
 * can't wedge.
 */
function enqueueRun(s: Session): void {
    s.chain = s.chain.then(() => runSession(s));
}

/** Reconcile one delta bar into a live session's local array (the applyBar pattern). */
function applyWorkerBar(s: Session, bar: OHLCV): void {
    const last = s.bars[s.bars.length - 1];
    if (last && bar.time === last.time) s.bars[s.bars.length - 1] = bar;
    else if (!last || bar.time > last.time) s.bars.push(bar);
    // older than the tip → stale duplicate from a tail overlap, drop
}

/**
 * (Re)start a live session's persistent stream over its CURRENT local array. PineTS
 * re-executes only the forming/new bars per poll from here on; the provider's
 * signature dedupe makes quiet polls free. Never starts on an empty array (the
 * stream would throw reading its last candle).
 */
function startStream(s: Session): void {
    s.stream?.stop();
    s.stream = null;
    if (s.stopped || s.bars.length === 0) return;
    s.stream = openLiveStream({
        token: s.prepared.token as PineToken,
        cache: s.cache,
        prepared: s.prepared,
        inputs: s.inputs,
        bars: () => s.bars,
        market: () => s.market,
        fetchSeries,
        visibleRange: s.visibleRange,
        onModel: (model) => {
            if (!s.stopped) post({ kind: 'model', sessionId: s.id, model });
        },
        onAlert: (alert) => post({ kind: 'alert', sessionId: s.id, alert }),
        onWarning: (warning) => post({ kind: 'warning', sessionId: s.id, warning }),
        onError: (e) => post({ kind: 'error', sessionId: s.id, message: e.message }),
    });
}

async function runSession(s: Session): Promise<void> {
    if (s.stopped) return;
    try {
        const token = s.prepared.token as PineToken;
        const outcome = await runPineStatic({
            ind: indicatorFor(s.cache, token.source, s.inputs),
            bars: s.bars,
            market: s.market,
            visibleRange: s.visibleRange,
            prepared: s.prepared,
            instanceId: token.instanceId,
            inputs: s.inputs,
            fetchSeries,
        });
        if (s.stopped) return;
        post({ kind: 'reactsToViewport', sessionId: s.id, value: outcome.reactsToViewport });
        for (const a of outcome.alerts) post({ kind: 'alert', sessionId: s.id, alert: a });
        for (const w of outcome.warnings) post({ kind: 'warning', sessionId: s.id, warning: w });
        s.lastCtx = outcome.ctx;
        post({ kind: 'model', sessionId: s.id, model: outcome.model });
        post({ kind: 'done', sessionId: s.id });
    } catch (err) {
        post({ kind: 'error', sessionId: s.id, message: err instanceof Error ? err.message : String(err) });
    }
}

ctx.addEventListener('message', (event) => {
    const msg = event.data as MainToWorker;
    switch (msg.kind) {
        case 'prepare':
            try {
                post({ kind: 'prepared', reqId: msg.reqId, prepared: preparePine(msg.source, msg.instanceId) });
            } catch (err) {
                post({ kind: 'prepared', reqId: msg.reqId, error: err instanceof Error ? err.message : String(err) });
            }
            return;
        case 'execute': {
            const s: Session = {
                id: msg.sessionId,
                mode: msg.mode ?? 'static',
                prepared: msg.prepared,
                market: msg.market,
                bars: msg.bars,
                inputs: msg.inputs,
                visibleRange: msg.visibleRange,
                cache: {},
                stopped: false,
                deferred: msg.historyState === 'backfill',
                chain: Promise.resolve(),
                stream: null,
                lastCtx: null,
            };
            sessions.set(s.id, s);
            if (s.mode === 'live') {
                if (!s.deferred) startStream(s); // deferred streams start on the 'complete' restart snapshot
                return; // live sessions never ack — the main thread doesn't count their runs
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // held run, acked
            else enqueueRun(s);
            return;
        }
        case 'update': {
            const s = sessions.get(msg.sessionId);
            if (!s) return;
            s.inputs = { ...s.inputs, ...msg.inputs };
            if (s.mode === 'live') {
                if (!s.deferred) startStream(s); // re-stream with the merged inputs baked in
                return;
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // merged; the deferred first run picks it up
            else enqueueRun(s);
            return;
        }
        case 'setVisibleRange': {
            const s = sessions.get(msg.sessionId);
            if (!s) return;
            s.visibleRange = msg.range;
            if (s.mode === 'live') {
                // Defensive — live mode excludes viewport-dependent scripts, but honor it.
                s.stream?.setVisibleRange(msg.range.left, msg.range.right);
                return;
            }
            if (s.deferred) post({ kind: 'done', sessionId: s.id }); // merged; the deferred first run picks it up
            else enqueueRun(s);
            return;
        }
        case 'notifyBars': {
            const s = sessions.get(msg.sessionId);
            if (!s || s.mode === 'live') return; // live bars travel via 'bars' deltas, never full snapshots
            s.bars = msg.bars;
            s.deferred = false; // only 'complete'/tick notifications reach the worker — run now
            enqueueRun(s);
            return;
        }
        case 'bars': {
            const s = sessions.get(msg.sessionId);
            if (!s || s.mode !== 'live') return;
            if (msg.restart) {
                // Full snapshot: history completed (or a restart) — stream over the whole depth.
                s.bars = msg.bars;
                s.deferred = false;
                startStream(s);
                return;
            }
            // Tail delta: the stream's own poll notices via the provider signature — no poke needed.
            for (const b of msg.bars) applyWorkerBar(s, b);
            return;
        }
        case 'getContext': {
            const s = sessions.get(msg.sessionId);
            const ctx = s ? (s.mode === 'live' ? (s.stream?.lastCtx() ?? null) : s.lastCtx) : null;
            const phase = !s || s.stopped ? 'idle' : s.mode === 'live' ? 'streaming' : 'idle';
            post({ kind: 'contextResult', reqId: msg.reqId, snapshot: ctx == null ? null : snapshotFromCtx(ctx, phase, msg.select) });
            return;
        }
        case 'stop': {
            const s = sessions.get(msg.sessionId);
            if (s) {
                s.stopped = true;
                s.stream?.stop(); // null-safe: a deferred live session never started
            }
            sessions.delete(msg.sessionId);
            return;
        }
        case 'fetchSeriesResult': {
            const p = pendingFetch.get(msg.reqId);
            if (!p) return;
            pendingFetch.delete(msg.reqId);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg.bars ?? []);
            return;
        }
    }
});
