/** Wall-clock + sleep, injected so the gate is unit-testable without real timers. */
export interface RateGateClock {
    now(): number;
    delay(ms: number): Promise<void>;
}

const REAL_CLOCK: RateGateClock = {
    now: () => Date.now(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Thrown when a request is rate-limited (429) or the IP is banned (418, `banned=true`). */
export class RateLimitError extends Error {
    constructor(
        message: string,
        readonly banned: boolean,
    ) {
        super(message);
        this.name = 'RateLimitError';
    }
}

/**
 * A per-IP request gate for the Binance trade path. It does three things, all aimed at
 * never tripping a ban:
 *
 *  - **Concurrency cap** — at most `maxConcurrent` requests in flight, so overlapping
 *    burst-prone backfills (initial + scroll + live poll) can't fan out at once.
 *  - **Pause** — set from a 429 `Retry-After`/backoff ({@link pauseFor}) or pre-emptively
 *    when a response's `X-MBX-USED-WEIGHT-1M` nears the cap ({@link noteWeight}); new work
 *    waits it out before acquiring a slot.
 *  - **Ban** — a 418 marks the IP banned ({@link banFor}); subsequent `run`s fail fast with
 *    a {@link RateLimitError} instead of hammering the API (which only extends the ban).
 *
 * One instance is shared across every `getTrades` call on a provider. Pure of any HTTP or
 * `console` so it can be driven by a fake clock in tests.
 */
export class RateGate {
    private active = 0;
    private readonly waiters: Array<() => void> = [];
    private pausedUntil = 0;
    private bannedUntil = 0;

    constructor(
        private readonly maxConcurrent: number,
        /** Pause to the next window once a response reports ≥ this fraction of the weight cap. */
        private readonly throttleFraction = 0.8,
        private readonly clock: RateGateClock = REAL_CLOCK,
    ) {}

    /** Acquire a slot (after any pause), run `fn`, release. Throws a RateLimitError while banned. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        this.assertNotBanned();
        await this.waitForPause();
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }

    /** Note consumed request weight from a response; pause to the next minute window if near the cap. */
    noteWeight(used: number, limit: number): void {
        if (limit > 0 && used >= limit * this.throttleFraction) {
            const now = this.clock.now();
            const nextWindow = Math.ceil((now + 1) / 60_000) * 60_000; // the weight counter resets each minute
            this.pausedUntil = Math.max(this.pausedUntil, nextWindow);
        }
    }

    /** Pause new requests for `ms` (a 429 Retry-After / exponential backoff). */
    pauseFor(ms: number): void {
        if (ms > 0) this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
    }

    /** Mark the IP banned for `ms` (a 418) so further requests fail fast. */
    banFor(ms: number): void {
        if (ms > 0) this.bannedUntil = Math.max(this.bannedUntil, this.clock.now() + ms);
    }

    /** Remaining ban time in ms (0 if not banned) — for diagnostics/logging. */
    get banRemainingMs(): number {
        return Math.max(0, this.bannedUntil - this.clock.now());
    }

    private assertNotBanned(): void {
        if (this.clock.now() < this.bannedUntil) {
            throw new RateLimitError(`Binance IP banned for ~${Math.ceil(this.banRemainingMs / 1000)}s`, true);
        }
    }

    private async waitForPause(): Promise<void> {
        let wait = this.pausedUntil - this.clock.now();
        while (wait > 0) {
            await this.clock.delay(wait);
            wait = this.pausedUntil - this.clock.now(); // pausedUntil may have been extended while we slept
        }
        this.assertNotBanned();
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
