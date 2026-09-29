// The lifecycle every tape-driven native indicator shares: lease the chart's shared tape,
// ask it to cover what is on screen, re-render when prints land, and report honestly in the
// legend whether the reading is still filling in. Subclasses only decide what to draw.
import type { InputSchema, InputValue } from '../../model/inputs';
import type { VisibleRange } from '../../ports/IChartRenderer';
import type { OHLCV } from '../../model/ohlcv';
import type { Millis } from '../../model/time';
import type { Unsubscribe } from '../../util/types';
import type { TapeLease } from '../../../data/tape/shared';
import { acquireTapeSource } from '../../../data/tape/shared';
import type { TapeSource } from '../../../data/tape/TapeSource';
import type { DataControl } from '../../DataControl';
import type { NativeIndicator, NativeIndicatorContext } from '../NativeIndicator';

/** Bars covered on a first render, before any viewport poke says what is actually on screen. */
const INITIAL_BARS = 120;

/**
 * Whether `symbol` can feed an order-flow reading at all: either its venue serves trade
 * history, or it streams a live tape to accumulate from. Used by every tape indicator's
 * `isSupported`, so a venue without a tape never offers one that could only draw nothing.
 */
export function tapeAvailable(symbol: string, data: DataControl): boolean {
    return data.tradeDepth(symbol) !== 'none' || data.tradeStream(symbol);
}

export abstract class TapeIndicator implements NativeIndicator {
    protected ctx: NativeIndicatorContext | null = null;
    protected inputs: Record<string, InputValue> = {};
    private lease: TapeLease | null = null;
    private off: Unsubscribe | null = null;
    private view: VisibleRange | null = null;

    /** Paint the current book. Called on every fold, viewport change and settings edit. */
    protected abstract draw(source: TapeSource, bars: readonly OHLCV[]): void;

    /**
     * How far back this indicator needs the tape covered, given what is on screen. The base
     * asks only for the visible bars; a cumulative reading widens it (see `CvdIndicator`).
     */
    protected coverageFrom(visibleFrom: Millis, _bars: readonly OHLCV[]): Millis {
        return visibleFrom;
    }

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = inputs;
        this.attach();
        this.cover();
        this.render();
    }

    onBars(): void {
        this.cover();
        this.render();
    }

    onViewport(range: VisibleRange): void {
        this.view = range;
        this.cover();
        this.render();
    }

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = inputs;
        // A pre-start edit (a restored workspace applies stored inputs before start) only
        // records: start() renders with the values the orchestrator replays.
        if (this.ctx) {
            this.cover();
            this.render();
        }
    }

    /** Hidden: drop the lease so the shared tape can stop when nothing is watching it. */
    suspend(): void {
        this.detach();
    }

    resume(): void {
        if (!this.ctx || this.lease) return;
        this.attach();
        this.cover();
        this.render();
    }

    stop(): void {
        this.detach();
        this.ctx = null;
    }

    private attach(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        this.lease = acquireTapeSource(ctx.data, {
            symbol: ctx.symbol,
            timeframe: ctx.timeframe,
            bars: () => ctx.bars(),
            live: ctx.live,
        });
        this.off = this.lease.source.onChange(() => this.render());
    }

    private detach(): void {
        this.off?.();
        this.off = null;
        this.lease?.release();
        this.lease = null;
    }

    /** Ask the shared tape to cover what this indicator needs for the current view. */
    private cover(): void {
        const source = this.lease?.source;
        const ctx = this.ctx;
        if (!source || !ctx) return;
        const bars = ctx.bars();
        if (bars.length === 0) return;
        const last = bars[bars.length - 1]!.time;
        const visibleFrom = this.view?.from ?? bars[Math.max(0, bars.length - INITIAL_BARS)]!.time;
        const to = Math.min(this.view?.to ?? last, last);
        source.prune();
        source.request(this.coverageFrom(visibleFrom, bars), to);
    }

    private render(): void {
        const source = this.lease?.source;
        const ctx = this.ctx;
        if (!source || !ctx) return;
        this.draw(source, ctx.bars());
        // The legend says what the reading is doing: still filling in, following the live
        // tape, or done. A view that reads as finished while windows are still landing
        // invites a trader to act on a half-summed number.
        ctx.setStatus(source.pending().length > 0 ? 'loading' : ctx.live && ctx.data.tradeStream(ctx.symbol) ? 'live' : 'idle');
    }
}

/** The colour pair every signed order-flow reading is drawn with. */
export function sideColorInputs(up: string, down: string): InputSchema[] {
    return [
        { key: 'upColor', title: 'Buying color', type: 'color', defval: up },
        { key: 'downColor', title: 'Selling color', type: 'color', defval: down },
    ];
}

export function num(v: InputValue | undefined, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(v: InputValue | undefined, fallback: string): string {
    return typeof v === 'string' && v !== '' ? v : fallback;
}
