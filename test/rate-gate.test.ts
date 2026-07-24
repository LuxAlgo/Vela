import { describe, it, expect } from 'vitest';
import { RateGate, RateLimitError } from '../src/data/providers/binance/RateGate';

/** A clock whose `delay` advances virtual time instantly — pauses are resolved without real waiting. */
class FakeClock {
    t = 0;
    now(): number {
        return this.t;
    }
    delay(ms: number): Promise<void> {
        this.t += ms;
        return Promise.resolve();
    }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
}

describe('RateGate', () => {
    it('never runs more than maxConcurrent tasks at once', async () => {
        const gate = new RateGate(2, 0.8, new FakeClock());
        let active = 0;
        let peak = 0;
        const blocks = [deferred(), deferred(), deferred(), deferred()];
        const runs = blocks.map((b) =>
            gate.run(async () => {
                active += 1;
                peak = Math.max(peak, active);
                await b.promise;
                active -= 1;
            }),
        );
        await flush();
        expect(active).toBe(2); // only two acquired; the other two are queued
        blocks[0]!.resolve();
        blocks[1]!.resolve();
        await flush();
        expect(active).toBe(2); // the two queued tasks took the freed slots
        blocks[2]!.resolve();
        blocks[3]!.resolve();
        await Promise.all(runs);
        expect(peak).toBe(2);
    });

    it('waits out a pauseFor before running the task', async () => {
        const clock = new FakeClock();
        const gate = new RateGate(4, 0.8, clock);
        gate.pauseFor(5000);
        let ranAt = -1;
        await gate.run(async () => {
            ranAt = clock.now();
        });
        expect(ranAt).toBe(5000);
    });

    it('noteWeight throttles to the next minute window when a response nears the cap', async () => {
        const clock = new FakeClock();
        clock.t = 10_000; // 10s into a minute
        const gate = new RateGate(4, 0.8, clock);
        gate.noteWeight(5000, 6000); // 5000 ≥ 0.8·6000 = 4800 → throttle to the window reset
        let ranAt = -1;
        await gate.run(async () => {
            ranAt = clock.now();
        });
        expect(ranAt).toBe(60_000); // next minute boundary
    });

    it('noteWeight does not throttle below the threshold', async () => {
        const clock = new FakeClock();
        clock.t = 10_000;
        const gate = new RateGate(4, 0.8, clock);
        gate.noteWeight(1000, 6000); // well under 4800
        let ranAt = -1;
        await gate.run(async () => {
            ranAt = clock.now();
        });
        expect(ranAt).toBe(10_000); // ran immediately, no wait
    });

    it('fails fast while banned, then runs again once the ban elapses', async () => {
        const clock = new FakeClock();
        const gate = new RateGate(4, 0.8, clock);
        gate.banFor(30_000);
        await expect(gate.run(async () => 1)).rejects.toBeInstanceOf(RateLimitError);
        await expect(gate.run(async () => 1)).rejects.toMatchObject({ banned: true });
        expect(gate.banRemainingMs).toBe(30_000);
        clock.t = 30_000; // ban window elapsed
        await expect(gate.run(async () => 42)).resolves.toBe(42);
        expect(gate.banRemainingMs).toBe(0);
    });

    it('releases the slot even when the task throws', async () => {
        const gate = new RateGate(1, 0.8, new FakeClock());
        await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        // If the slot leaked, this second task would hang; it must resolve.
        await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
    });
});
