import type { OHLCV } from './model/ohlcv';

/** Where a bar replay stands (`chart.replay.state`). */
export interface ReplayState {
    /** Replay mode is on: the chart shows history up to the cursor, live updates are paused.
     *  Stays on through a timeframe/session switch while the new bars load (`cursorTime`
     *  is null until the replay resumes on them). */
    active: boolean;
    /** Bars are being revealed on a timer (`play`), as opposed to paused / stepped by hand. */
    playing: boolean;
    /** Open time (epoch ms) of the newest bar on screen; null when replay is off. */
    cursorTime: number | null;
    /** Bars still hidden to the right of the cursor. */
    remaining: number;
    /** Delay between two updates while playing (ms) — two bars, or two ticks with {@link ReplayControl.setTicks}. */
    intervalMs: number;
}

/** Options for {@link ReplayControl.start}. */
export interface ReplayStartOptions {
    /**
     * Epoch ms. The chart keeps every bar that opened at or before it and hides the rest.
     * Older than the loaded history ⇒ the history is deepened first (clamped to the
     * oldest bar the source serves).
     */
    from: number;
}

/** Why a replay ended (`replay:end`). */
export type ReplayEndReason = 'stopped' | 'finished' | 'market';

/** One intrabar update of a replayed bar ({@link ReplayControl.setTicks}). */
export interface ReplayTick {
    /** The price the forming candle closes at after this update. */
    price: number;
    /** The extremes traded since the previous update (default: `price`) — lets one update
     *  stand for a whole span, e.g. a lower-timeframe bar. */
    high?: number;
    low?: number;
    /** Where the candle opens — read on a bar's first update only (default: `price`). */
    open?: number;
    /** Volume traded by this update. When no tick of a bar carries one, the bar's volume
     *  is spread evenly across its ticks. */
    volume?: number;
}

/**
 * Where a replay gets the intrabar prices of a bar it is about to reveal: `bar` is the
 * stored bar, `end` the open time of the bar after it (the span the ticks cover is
 * `[bar.time, end)`), `signal` aborts when the replay moves on (seek, stop, new source).
 * Prices come oldest first. An empty list — or a failure — reveals the bar whole.
 */
export type ReplayTickSource = (
    bar: OHLCV,
    opts: { end: number; signal: AbortSignal },
) => readonly ReplayTick[] | Promise<readonly ReplayTick[]>;

/** What the chart implements behind {@link ReplayControl}. */
export interface ReplayController {
    replayStart(opts: ReplayStartOptions): Promise<void>;
    replayStep(): boolean;
    replayStepUpdate(): boolean;
    replayPlay(intervalMs?: number): void;
    replayPause(): void;
    replayStop(): void;
    replayState(): ReplayState;
    replayBounds(): ReplayBounds | null;
    replaySetTicks(source: ReplayTickSource | null): void;
}

/** The open times of the oldest and newest bar a replay can start from (`chart.replay.bounds`). */
export interface ReplayBounds {
    first: number;
    last: number;
}

/**
 * The chart's bar-replay control surface (`chart.replay`) — sibling of `chart.data` /
 * `chart.marks`. Rewinds the chart to a past bar and reveals the following bars one at a
 * time, by hand or on a timer, from the history already in memory (nothing is refetched).
 * Revealed bars travel the exact path of a live bar: indicators, chart-type engines and
 * the `bar` event see them as new bars. Live updates pause for the duration; `stop()` (or
 * revealing the last bar) restores the full history and resumes them. A timeframe or
 * session switch carries the replay over to the new bars at the same point in time; a
 * symbol switch ends it.
 */
export class ReplayControl {
    constructor(private readonly ctrl: ReplayController) {}

    /**
     * Enter replay (or seek, when already replaying) at `opts.from`. Resolves once the
     * chart shows the rewound history — after any in-flight history load has finished.
     * Starts paused; call {@link play} or {@link step}.
     */
    start(opts: ReplayStartOptions): Promise<void> {
        return this.ctrl.replayStart(opts);
    }

    /** Reveal the next bar — or, mid-way through a bar played tick by tick, complete it.
     *  Returns false when replay is off or nothing is left. */
    step(): boolean {
        return this.ctrl.replayStep();
    }

    /** Reveal the next UPDATE: with {@link setTicks}, the next tick of the forming bar — or
     *  the next bar opened at its first tick (once its ticks are in, if still loading);
     *  otherwise the next whole bar, like {@link step}. Returns false when nothing is left. */
    stepUpdate(): boolean {
        return this.ctrl.replayStepUpdate();
    }

    /** Reveal one bar (one tick, with {@link setTicks}) every `intervalMs` (default: the last
     *  interval used, else 1000). Calling it again while playing changes the pace. */
    play(intervalMs?: number): this {
        this.ctrl.replayPlay(intervalMs);
        return this;
    }

    pause(): this {
        this.ctrl.replayPause();
        return this;
    }

    /** Leave replay: the full history comes back and live updates resume. Also cancels a
     *  `start()` still loading older history (the chart returns to its previous depth). */
    stop(): this {
        this.ctrl.replayStop();
        return this;
    }

    get state(): ReplayState {
        return this.ctrl.replayState();
    }

    /** The loaded history a replay can walk — hidden bars included while replaying. Null
     *  before any bar loaded. A start older than `first` deepens the history first. */
    get bounds(): ReplayBounds | null {
        return this.ctrl.replayBounds();
    }

    /**
     * Play each revealed bar as a series of intrabar updates instead of whole: while
     * playing, the forming candle opens at the first tick, then every tick moves its close
     * and stretches its high and low, exactly like a live tick — indicators, chart types
     * and the `bar` event follow — and the last one settles it on the stored bar. The play
     * interval is then the time between two TICKS: a bar lasts as many intervals as it
     * has ticks (below ~16 ms, ticks are batched per frame). The next bar's ticks are
     * requested while the current one plays; playback waits for them. `null` goes back to
     * whole bars. Takes effect from the next bar; a bar forming when the source changes
     * completes at once.
     */
    setTicks(source: ReplayTickSource | null): this {
        this.ctrl.replaySetTicks(source);
        return this;
    }
}
