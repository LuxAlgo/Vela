import { describe, it, expect } from 'vitest';
import { RequestGate, type RequestGateClock } from '../src/data/providers/coinbase/RequestGate';

/** A fake clock whose `delay(ms)` advances virtual time, so spacing is deterministic. */
function fakeClock(): RequestGateClock & { t: number } {
    const c = {
        t: 1000,
        now: () => c.t,
        delay: (ms: number) => { c.t += ms; return Promise.resolve(); },
    };
    return c;
}

/** Flush pending microtasks + the macrotask queue. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('Coinbase RequestGate', () => {
    it('spaces consecutive request starts by minIntervalMs', async () => {
        const clock = fakeClock();
        const gate = new RequestGate(10, 100, clock);
        const starts: number[] = [];
        await gate.run(async () => { starts.push(clock.now()); });
        await gate.run(async () => { starts.push(clock.now()); });
        await gate.run(async () => { starts.push(clock.now()); });
        expect(starts[1]! - starts[0]!).toBe(100);
        expect(starts[2]! - starts[1]!).toBe(100); // each consecutive start spaced one interval
    });

    it('caps concurrency at maxConcurrent (excess work queues)', async () => {
        const clock = fakeClock();
        const gate = new RequestGate(2, 0, clock); // no spacing → isolate the concurrency cap
        let active = 0;
        let peak = 0;
        const resolvers: Array<() => void> = [];
        const make = (): Promise<void> => gate.run(() => new Promise<void>((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            resolvers.push(() => { active -= 1; resolve(); });
        }));
        const all = [make(), make(), make(), make()];
        await flush();
        expect(peak).toBe(2); // only two ran; the other two are queued at the gate

        // drain: each completion frees a slot for a queued task
        while (resolvers.length) { resolvers.shift()!(); await flush(); }
        await Promise.all(all);
        expect(peak).toBe(2);
    });

    it('pauseFor holds the next start until the backoff elapses', async () => {
        const clock = fakeClock();
        const gate = new RequestGate(10, 0, clock);
        const starts: number[] = [];
        await gate.run(async () => { starts.push(clock.now()); });
        gate.pauseFor(500);
        await gate.run(async () => { starts.push(clock.now()); });
        expect(starts[1]! - starts[0]!).toBe(500);
    });
});
