import { describe, it, expect } from 'vitest';
import { PineEngine } from '../src/engines/pinets/PineEngine';
import type { ExecutionRequest, ExecutionHandlers } from '../src/core/ports/ScriptingEngine';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { OHLCV } from '../src/core/model/ohlcv';

/**
 * Policy-A gating of the IN-PROCESS engine (the worker engine shares the same
 * policy; its main-thread half is covered in pine-worker-engine.test.ts): a
 * session started during a history backfill holds every run — merging state
 * changes meanwhile — until the `'complete'` notification, then runs ONCE over
 * the full history.
 */

const SOURCE = `//@version=5
indicator("Gate probe", overlay=true)
plot(close, "c")
`;

function makeBars(n: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        out.push({ time: 1_700_000_000_000 + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1 });
    }
    return out;
}

async function waitFor(cond: () => boolean, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 20));
    }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

async function prepared(engine: PineEngine): Promise<ExecutionRequest['prepared']> {
    return engine.prepare(SOURCE, 'gate-1');
}

function makeReq(p: ExecutionRequest['prepared'], bars: OHLCV[], extra: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return { prepared: p, market: { symbol: 'TEST', timeframe: '60' }, bars, getBars: () => bars, inputs: {}, mode: 'static', ...extra };
}

describe('PineEngine policy-A gating (static)', () => {
    it('runs immediately when no historyState is given (regression: today’s behavior)', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const models: IndicatorModel[] = [];
        engine.execute(makeReq(p, makeBars(10)), { onModel: (m) => models.push(m) });
        await waitFor(() => models.length === 1);
    });

    it('defers under backfill: no run on start/update/setVisibleRange/tick — ONE run on complete', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const bars = makeBars(10);
        const models: IndicatorModel[] = [];
        const errors: Error[] = [];
        const handlers: ExecutionHandlers = { onModel: (m) => models.push(m), onError: (e) => errors.push(e) };
        const session = engine.execute(makeReq(p, bars, { historyState: 'backfill' }), handlers);

        session.update({ anything: 1 });
        session.setVisibleRange({ left: bars[0]!.time, right: bars[9]!.time });
        session.notifyBars('backfill'); // chunk prepended
        session.notifyBars(); // live tick during backfill — still held (policy A)
        await settle();
        expect(models).toHaveLength(0);
        expect(errors).toHaveLength(0);

        bars.unshift(...makeBars(5).map((b) => ({ ...b, time: b.time - 5 * 60_000 }))); // history deepened
        session.notifyBars('complete');
        await waitFor(() => models.length === 1);
        // The single run saw the FULL deepened history (15 bars → 15 plotted points).
        const series = models[0]!.series.find((s) => 'points' in s) as { points: unknown[] } | undefined;
        expect(series?.points).toHaveLength(15);

        // After completion the session behaves normally: a tick re-runs.
        session.notifyBars();
        await waitFor(() => models.length === 2);
        session.stop();
    });

    it('backfill pokes on a NON-deferred session are ignored; complete is just a run', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, makeBars(10)), { onModel: (m) => models.push(m) });
        await waitFor(() => models.length === 1);

        session.notifyBars('backfill'); // a mid-life backfill started — hold further runs? No:
        await settle(); // policy A only DEFERS; an already-produced model stays, backfill pokes are skipped
        expect(models).toHaveLength(1);

        session.notifyBars('complete');
        await waitFor(() => models.length === 2);
        session.stop();
    });
});
