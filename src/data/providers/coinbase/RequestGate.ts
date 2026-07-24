/** Wall-clock + sleep, injected so the gate is unit-testable without real timers. */
export interface RequestGateClock {
    now(): number;
    delay(ms: number): Promise<void>;
}

const REAL_CLOCK: RequestGateClock = {
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * A per-IP request gate for the Coinbase REST path. Coinbase Exchange throttles public
 * endpoints by request RATE (≈10 req/s sustained), not by a per-response weight header like
 * Binance — so this gate shapes throughput two ways:
 *
 *  - **Concurrency cap** — at most `maxConcurrent` requests in flight, so overlapping
 *    burst-prone backfills (initial + scroll + live poll) can't fan out at once.
 *  - **Min spacing** — request STARTS are spaced at least `minIntervalMs` apart, holding the
 *    sustained rate under the public limit even when several `getTrades` walks run at once.
 *  - **Pause** — a 429 sets a backoff ({@link pauseFor}); new work waits it out before starting.
 *
 * One instance is shared across every REST call on a provider. Pure of any HTTP or `console`,
 * so it can be driven by a fake clock in tests.
 */
export class RequestGate {
    private active = 0;
    private readonly waiters: Array<() => void> = [];
    /** Earliest time the next request may START (min-spacing reservation). */
    private nextStartAt = 0;
    /** Backoff deadline set by a 429 — new starts wait until then. */
    private pausedUntil = 0;

    constructor(
        private readonly maxConcurrent: number,
        private readonly minIntervalMs: number,
        private readonly clock: RequestGateClock = REAL_CLOCK,
    ) {}

    /** Acquire a slot, wait for the spacing/pause turn, run `fn`, release. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            await this.waitForTurn();
            return await fn();
        } finally {
            this.release();
        }
    }

    /** Pause new starts for `ms` (a 429 Retry-After / exponential backoff). */
    pauseFor(ms: number): void {
        if (ms > 0) this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
    }

    /** Block until the spacing window opens and any pause has elapsed, then reserve the next slot. */
    private async waitForTurn(): Promise<void> {
        for (;;) {
            const now = this.clock.now();
            const wait = Math.max(this.pausedUntil - now, this.nextStartAt - now);
            if (wait <= 0) break;
            await this.clock.delay(wait); // pausedUntil/nextStartAt may move while we sleep → re-check
        }
        // Reserve this start; the next request can't begin until a full interval later.
        this.nextStartAt = Math.max(this.clock.now(), this.nextStartAt) + this.minIntervalMs;
    }

    private acquire(): Promise<void> {
        if (this.active < this.maxConcurrent) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.waiters.push(() => {
                this.active += 1;
                resolve();
            });
        });
    }

    private release(): void {
        this.active -= 1;
        const next = this.waiters.shift();
        if (next) next();
    }
}
