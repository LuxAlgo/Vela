import { describe, it, expect } from 'vitest';
import { PineWorkerEngine } from '../src/engines/pinets-worker/PineWorkerEngine';
import type { MainToWorker, WorkerToMain, WorkerLike } from '../src/engines/pinets-worker/protocol';
import type { PreparedScript, ExecutionRequest, ExecutionHandlers } from '../src/core/ports/ScriptingEngine';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { OHLCV } from '../src/core/model/ohlcv';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A fake Worker: records what the proxy posts, and lets the test drive replies. */
class FakeWorker implements WorkerLike {
    posted: MainToWorker[] = [];
    private listener: ((e: { data: unknown }) => void) | null = null;
    postMessage(msg: unknown): void {
        this.posted.push(msg as MainToWorker);
    }
    addEventListener(_t: 'message', cb: (e: { data: unknown }) => void): void {
        this.listener = cb;
    }
    terminate(): void {}
    /** Simulate the worker posting a message back to the main thread. */
    reply(msg: WorkerToMain): void {
        this.listener?.({ data: msg });
    }
    last<K extends MainToWorker['kind']>(kind: K): Extract<MainToWorker, { kind: K }> | undefined {
        for (let i = this.posted.length - 1; i >= 0; i -= 1) {
            const m = this.posted[i];
            if (m && m.kind === kind) return m as Extract<MainToWorker, { kind: K }>;
        }
        return undefined;
    }
}

const PREPARED: PreparedScript = {
    language: 'pine',
    inputs: [],
    meta: { title: 'EMA', overlay: true },
    reactsToViewport: false,
    token: { source: '//src', instanceId: 'ind-1' },
};

const bar = (t: number): OHLCV => ({ time: t, open: 1, high: 2, low: 0, close: 1, volume: 1 });

const MODEL: IndicatorModel = {
    id: 'ind-1',
    title: 'EMA',
    overlay: true,
    paneHint: 'price',
    series: [],
    fills: [],
    backgrounds: [],
    priceLines: [],
    inputs: [],
    inputValues: {},
};

function makeReq(extra: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return { prepared: PREPARED, market: { symbol: 'BTCUSDT', timeframe: '60' }, bars: [bar(1), bar(2)], inputs: {}, mode: 'static', ...extra };
}

describe('PineWorkerEngine (proxy)', () => {
    it('prepare round-trips to the worker', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const p = engine.prepare('//src', 'ind-1');

        const sent = fake.last('prepare');
        expect(sent).toMatchObject({ kind: 'prepare', source: '//src', instanceId: 'ind-1' });

        fake.reply({ kind: 'prepared', reqId: sent!.reqId, prepared: PREPARED });
        await expect(p).resolves.toMatchObject({ meta: { title: 'EMA' } });
    });

    it('execute ships bars + routes the worker model to onModel; session methods post', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const models: IndicatorModel[] = [];
        const handlers: ExecutionHandlers = { onModel: (m) => models.push(m) };
        const session = engine.execute(makeReq(), handlers);

        const exec = fake.last('execute');
        expect(exec!.bars).toHaveLength(2);

        fake.reply({ kind: 'model', sessionId: exec!.sessionId, model: MODEL });
        expect(models).toHaveLength(1);
        expect(models[0]!.id).toBe('ind-1');

        session.update({ Length: 50 });
        expect(fake.last('update')).toMatchObject({ inputs: { Length: 50 } });
        session.setVisibleRange({ left: 1, right: 2 });
        expect(fake.last('setVisibleRange')).toMatchObject({ range: { left: 1, right: 2 } });
        // Three runs (execute/update/setVisibleRange) are in flight — ack them so a bar tick
        // posts straight through instead of coalescing behind them.
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        session.notifyBars();
        expect(fake.last('notifyBars')!.bars).toHaveLength(2);
        session.stop();
        expect(fake.last('stop')).toBeDefined();
    });

    it('coalesces notifyBars bursts: dirty while a run is in flight, ONE re-run when it lands', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;
        const notifies = (): number => fake.posted.filter((m) => m.kind === 'notifyBars').length;

        // The initial execute run is still in flight → a tick burst (e.g. a gap heal) coalesces.
        session.notifyBars();
        session.notifyBars();
        session.notifyBars();
        expect(notifies()).toBe(0);

        // The run lands → exactly one coalesced notifyBars posts (a fresh snapshot).
        fake.reply({ kind: 'done', sessionId: sid });
        expect(notifies()).toBe(1);

        // That flushed run completes with nothing dirty → no further posts.
        fake.reply({ kind: 'done', sessionId: sid });
        expect(notifies()).toBe(1);

        // Idle session → a tick posts immediately.
        session.notifyBars();
        expect(notifies()).toBe(2);

        // An 'error' also acks a run: a tick during it goes dirty, then flushes on the error.
        session.notifyBars();
        expect(notifies()).toBe(2);
        fake.reply({ kind: 'error', sessionId: sid, message: 'boom' });
        expect(notifies()).toBe(3);
    });

    it('backfill notifications never reach the worker; complete ships a fresh snapshot', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, historyState: 'backfill' }), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;

        // The execute message carries the history state (the worker defers the first run).
        expect(fake.last('execute')!.historyState).toBe('backfill');
        fake.reply({ kind: 'done', sessionId: sid }); // the worker acks the held run

        // Chunk prepends: nothing posts — not even a dirty flag for later.
        session.notifyBars('backfill');
        session.notifyBars('backfill');
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);

        // Backfill finished: one notifyBars with the current full snapshot.
        bars.push(bar(3));
        session.notifyBars('complete');
        const complete = fake.last('notifyBars')!;
        expect(complete.bars).toHaveLength(3);
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(1);
    });

    it("a 'complete' arriving while a run is in flight is not lost to coalescing", () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq({ historyState: 'backfill' }), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;

        // The held execute run has NOT been acked yet → 'complete' coalesces to dirty…
        session.notifyBars('complete');
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);
        // …and flushes as a real run the moment the ack lands.
        fake.reply({ kind: 'done', sessionId: sid });
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(1);
    });

    it('live sessions stream: ticks post 1-bar tails, never full snapshots or run bookkeeping', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2), bar(3)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live' }), { onModel: () => {} });
        const exec = fake.last('execute')!;
        expect(exec.mode).toBe('live');
        expect(exec.bars).toHaveLength(3);

        // A tick: the forming bar changed — only IT crosses (time >= lastSentTime).
        bars[2] = { ...bars[2]!, close: 42 };
        session.notifyBars();
        const tick = fake.last('bars')!;
        expect(tick.restart).toBeUndefined();
        expect(tick.bars).toHaveLength(1);
        expect(tick.bars[0]!.close).toBe(42);

        // A new bar: forming + new travel together.
        bars.push(bar(4));
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(2);

        // The live session never acked anything, yet every message went straight out —
        // no pendingRuns coalescing ever held a live post back.
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);
        expect(fake.posted.filter((m) => m.kind === 'done' as never)).toHaveLength(0);

        session.update({ Length: 9 });
        expect(fake.last('update')).toMatchObject({ inputs: { Length: 9 } });
        session.notifyBars(); // still flows after an un-acked update
        bars[3] = { ...bars[3]!, close: 7 };
        session.notifyBars();
        expect(fake.last('bars')!.bars[fake.last('bars')!.bars.length - 1]!.close).toBe(7);
        session.stop();
        expect(fake.last('stop')).toBeDefined();
    });

    it('a live session under backfill stays silent until complete restarts the stream over the full depth', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(10), bar(11)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live', historyState: 'backfill' }), { onModel: () => {} });
        expect(fake.last('execute')!.historyState).toBe('backfill');

        session.notifyBars('backfill'); // chunks land — nothing crosses
        session.notifyBars('backfill');
        expect(fake.posted.filter((m) => m.kind === 'bars')).toHaveLength(0);

        bars.unshift(bar(1), bar(2)); // history deepened
        session.notifyBars('complete');
        const restart = fake.last('bars')!;
        expect(restart.restart).toBe(true);
        expect(restart.bars).toHaveLength(4); // the FULL snapshot

        // lastSentTime was reset by the restart: the next tick ships only the forming bar.
        bars[3] = { ...bars[3]!, close: 5 };
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(1);
    });

    it("a live stream 'error' routes to onError without corrupting the static run bookkeeping", () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2)];
        const errs: Error[] = [];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live' }), { onModel: () => {}, onError: (e) => errs.push(e) });
        const sid = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'error', sessionId: sid, message: 'stream boom' });
        expect(errs[0]?.message).toBe('stream boom');

        // Still fully live afterward: a tick posts immediately.
        bars[1] = { ...bars[1]!, close: 11 };
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(1);
    });

    it('serves a worker fetchSeries request via the request gateway', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const secBars = [bar(10), bar(11)];
        let asked: { sym: string; tf: string } | null = null;
        engine.execute(makeReq({ fetchSeries: async (sym, tf) => ((asked = { sym, tf }), secBars) }), { onModel: () => {} });

        fake.reply({ kind: 'fetchSeries', reqId: 7, symbol: 'ETHUSDT', timeframe: '240', range: { limit: 100 } });
        await flush();

        expect(asked).toEqual({ sym: 'ETHUSDT', tf: '240' });
        expect(fake.last('fetchSeriesResult')).toMatchObject({ reqId: 7, bars: secBars });
    });

    it('refines reactsToViewport in place and routes errors', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const req = makeReq();
        const errs: Error[] = [];
        engine.execute(req, { onModel: () => {}, onError: (e) => errs.push(e) });
        const sid = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'reactsToViewport', sessionId: sid, value: true });
        expect(req.prepared.reactsToViewport).toBe(true);

        fake.reply({ kind: 'error', sessionId: sid, message: 'boom' });
        expect(errs[0]?.message).toBe('boom');
    });
});
