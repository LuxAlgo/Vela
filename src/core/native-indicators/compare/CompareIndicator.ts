import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import type { LineStyle, SeriesPoint } from '../../model/series';
import { stableSeriesId } from '../../model/identity';
import { msg } from '../../i18n/message';
import { CATEGORICAL } from '../../palette';
import { timeframeToMs } from '../../../data/timeframe';
import { parseSymbol } from '../../../data/ProviderRegistry';
import type { Unsubscribe } from '../../util/types';
import { alignBars, SOURCES, sourceValues } from '../classics/math';
import { CLASSIC_INPUT_LABELS } from '../classics/labels';
import { localizeInput, type InputLabels } from '../localize';
import { registerNativeIndicator, type NativeIndicator, type NativeIndicatorContext, type NativeIndicatorDescriptor } from '../NativeIndicator';

/** Where a compared symbol is placed relative to the main chart. */
export type ComparePlacement = 'same' | 'new-scale' | 'new-pane';

const SETTINGS = 'Settings';
const STYLE = 'Style';
const PLACEMENTS: readonly ComparePlacement[] = ['same', 'new-scale', 'new-pane'];
const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

const LABELS: InputLabels = {
    groups: CLASSIC_INPUT_LABELS.groups,
    options: {
        ...CLASSIC_INPUT_LABELS.options,
        same: msg('indicator.compare.scale.same', 'Same % scale'),
        'new-scale': msg('indicator.compare.scale.newScale', 'New price scale'),
        'new-pane': msg('indicator.compare.scale.newPane', 'New pane'),
        solid: msg('indicator.compare.lineStyle.solid', 'Solid'),
        dashed: msg('indicator.compare.lineStyle.dashed', 'Dashed'),
        dotted: msg('indicator.compare.lineStyle.dotted', 'Dotted'),
    },
};

const SCHEMA: readonly InputSchema[] = [
    localizeInput(
        {
            key: 'symbol',
            title: msg('indicator.compare.symbol', 'Symbol'),
            type: 'symbol',
            defval: '',
            group: SETTINGS,
            tooltip: msg('indicator.compare.symbol.tooltip', 'Secondary symbol overlaid for comparison.'),
        },
        LABELS,
    ),
    localizeInput(
        {
            key: 'scale',
            title: msg('indicator.compare.scale', 'Scale'),
            type: 'string',
            defval: 'same',
            options: PLACEMENTS,
            group: SETTINGS,
            tooltip: msg('indicator.compare.scale.tooltip', 'Share the main percentage scale, use an independent price scale, or plot in a new pane.'),
        },
        LABELS,
    ),
    localizeInput(
        {
            key: 'source',
            title: msg('indicator.common.source', 'Source'),
            type: 'string',
            defval: 'Close',
            options: SOURCES,
            group: SETTINGS,
            tooltip: msg('indicator.compare.source.tooltip', 'Price value taken from each bar.'),
        },
        LABELS,
    ),
    localizeInput(
        {
            key: 'color',
            title: msg('indicator.common.color', 'Color'),
            type: 'color',
            defval: CATEGORICAL[0]!,
            group: STYLE,
            tooltip: msg('indicator.compare.color.tooltip', 'Color of the compared symbol line and price-axis badge.'),
        },
        LABELS,
    ),
    localizeInput(
        {
            key: 'lineWidth',
            title: msg('indicator.common.lineWidth', 'Line Width'),
            type: 'int',
            defval: 2,
            min: 1,
            max: 5,
            step: 1,
            group: STYLE,
            tooltip: msg('indicator.common.lineWidth.tooltip', 'Width of the plotted line, in pixels.'),
        },
        LABELS,
    ),
    localizeInput(
        {
            key: 'lineStyle',
            title: msg('indicator.compare.lineStyle', 'Style'),
            type: 'string',
            defval: 'solid',
            options: LINE_STYLES,
            group: STYLE,
            tooltip: msg('indicator.compare.lineStyle.tooltip', 'Stroke pattern of the compared symbol line.'),
        },
        LABELS,
    ),
];

function defaults(): Record<string, InputValue> {
    const out: Record<string, InputValue> = {};
    for (const s of SCHEMA) out[s.key] = s.defval;
    return out;
}

function asPlacement(v: InputValue | undefined): ComparePlacement {
    return v === 'new-scale' || v === 'new-pane' ? v : 'same';
}

function asLineStyle(v: InputValue | undefined): LineStyle {
    return v === 'dashed' || v === 'dotted' ? v : 'solid';
}

function asWidth(v: InputValue | undefined): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.max(1, Math.min(5, Math.round(n))) : 2;
}

function barStepMs(bars: readonly OHLCV[], timeframe: string): number {
    if (bars.length >= 2) {
        const dt = bars[bars.length - 1]!.time - bars[bars.length - 2]!.time;
        if (dt > 0) return dt;
    }
    return timeframeToMs(timeframe) ?? 60_000;
}

function mergeLiveBar(bars: OHLCV[], bar: OHLCV): void {
    const last = bars[bars.length - 1];
    if (!last || bar.time > last.time) bars.push(bar);
    else if (bar.time === last.time) bars[bars.length - 1] = bar;
}

/** Merge a freshly fetched history range with any newer live bars already accumulated. */
function mergeFetchedBars(fetched: readonly OHLCV[], existing: readonly OHLCV[]): OHLCV[] {
    if (existing.length === 0) return [...fetched];
    if (fetched.length === 0) return [...existing];
    const out = [...fetched];
    const tailTime = out[out.length - 1]!.time;
    for (const b of existing) {
        if (b.time > tailTime) out.push(b);
        else if (b.time === tailTime) out[out.length - 1] = b;
    }
    return out;
}

/**
 * Native indicator that fetches, streams, and aligns a secondary symbol onto the chart's
 * timeline as a line overlay. Uses `percentBaseline: 'own'` so percent/indexed mode rebases
 * it independently to its own first visible bar, and `priceAxisLabel: true` so the price
 * axis carries its colored name + value badge.
 */
class CompareIndicator implements NativeIndicator {
    private ctx: NativeIndicatorContext | null = null;
    private inputs: Record<string, InputValue> = defaults();
    private suspended = false;
    private extBars: OHLCV[] = [];
    private fetchedSymbol = '';
    private fetchedFrom = Infinity;
    private inFlightFrom: number | null = null;
    private needsCatchup = false;
    private fetchSeq = 0;
    private unsub: Unsubscribe | null = null;
    private subSymbol = '';

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = { ...defaults(), ...inputs };
        this.suspended = false;
        this.needsCatchup = false;
        this.syncAndCompute();
    }

    onBars(): void {
        if (!this.ctx || this.suspended) return;
        this.syncAndCompute();
    }

    onViewport(): void {
        /* percent rebasing runs per-frame in the renderer; no recompute needed */
    }

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = { ...defaults(), ...inputs };
        if (!this.ctx || this.suspended) return;
        this.syncAndCompute();
    }

    suspend(): void {
        this.suspended = true;
        this.fetchSeq += 1;
        this.inFlightFrom = null;
        this.needsCatchup = true;
        this.clearSub();
    }

    resume(): void {
        this.suspended = false;
        if (!this.ctx) return;
        this.syncAndCompute();
    }

    stop(): void {
        this.suspended = true;
        this.fetchSeq += 1;
        this.clearSub();
        this.extBars = [];
        this.fetchedSymbol = '';
        this.fetchedFrom = Infinity;
        this.inFlightFrom = null;
        this.needsCatchup = false;
        this.ctx = null;
    }

    private clearSub(): void {
        this.unsub?.();
        this.unsub = null;
        this.subSymbol = '';
    }

    private targetSymbol(): string {
        return typeof this.inputs.symbol === 'string' ? this.inputs.symbol.trim() : '';
    }

    private isOwnSymbol(sym: string): boolean {
        if (!this.ctx) return false;
        const canon = (s: string): string => (this.ctx!.data.canonicalSymbol?.(s) ?? s).trim().toUpperCase();
        return canon(sym) === canon(this.ctx.symbol);
    }

    private ensureSubscription(sym: string): void {
        const ctx = this.ctx;
        if (!ctx || !ctx.live || !ctx.subscribeSeries || this.suspended) return;
        if (this.subSymbol === sym && this.unsub) return;
        this.clearSub();
        this.subSymbol = sym;
        this.unsub = ctx.subscribeSeries(sym, ctx.timeframe, (bar) => {
            if (!this.ctx || this.suspended || this.targetSymbol() !== sym) return;
            mergeLiveBar(this.extBars, bar);
            this.emit(this.ctx.bars(), sym, this.extBars);
        });
    }

    private syncAndCompute(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const bars = ctx.bars();
        const sym = this.targetSymbol();

        if (!sym) {
            this.fetchSeq += 1;
            this.clearSub();
            this.extBars = [];
            this.fetchedSymbol = '';
            this.fetchedFrom = Infinity;
            this.inFlightFrom = null;
            this.needsCatchup = false;
            this.emit(bars, '', []);
            ctx.setStatus('idle');
            return;
        }

        if (this.isOwnSymbol(sym)) {
            this.fetchSeq += 1;
            this.clearSub();
            this.extBars = [];
            this.fetchedSymbol = '';
            this.fetchedFrom = Infinity;
            this.inFlightFrom = null;
            this.needsCatchup = false;
            this.emit(bars, sym, bars);
            ctx.setStatus('idle');
            return;
        }

        if (this.fetchedSymbol !== sym) {
            this.clearSub();
            this.extBars = [];
            this.fetchedSymbol = sym;
            this.fetchedFrom = Infinity;
            this.inFlightFrom = null;
            this.needsCatchup = false;
        }

        // Emit right away so the legend row appears immediately while the secondary series loads.
        this.emit(bars, sym, this.extBars);
        if (!ctx.fetchSeries || bars.length === 0) {
            ctx.setStatus('idle');
            return;
        }

        const earliest = bars[0]!.time;
        if (!this.needsCatchup && earliest >= this.fetchedFrom && this.fetchedFrom < Infinity) {
            this.ensureSubscription(sym);
            ctx.setStatus('idle');
            return;
        }
        // Style-only edits while a matching fetch is already in flight must not re-fetch.
        if (!this.needsCatchup && this.inFlightFrom !== null && earliest >= this.inFlightFrom) {
            return;
        }

        const seq = ++this.fetchSeq;
        this.inFlightFrom = earliest;
        this.needsCatchup = false;
        ctx.setStatus('loading');
        const step = barStepMs(bars, ctx.timeframe);
        const range = { from: earliest, to: bars[bars.length - 1]!.time + step, limit: bars.length + 64 };
        void ctx
            .fetchSeries(sym, ctx.timeframe, range)
            .then(
                (fetched) => ({ ok: true as const, fetched }),
                () => ({ ok: false as const, fetched: [] as OHLCV[] }),
            )
            .then(({ ok, fetched }) => {
                if (seq !== this.fetchSeq || !this.ctx || this.suspended || this.targetSymbol() !== sym) return;
                this.inFlightFrom = null;
                if (ok) {
                    this.extBars = mergeFetchedBars(fetched, this.extBars);
                    this.fetchedFrom = Math.min(this.fetchedFrom, earliest);
                    this.ensureSubscription(sym);
                    this.emit(this.ctx.bars(), sym, this.extBars);
                }
                this.ctx.setStatus('idle');
            });
    }

    private emit(chartBars: readonly OHLCV[], sym: string, secondary: readonly OHLCV[]): void {
        const ctx = this.ctx;
        if (!ctx) return;

        const placement = asPlacement(this.inputs.scale);
        const source = typeof this.inputs.source === 'string' ? this.inputs.source : 'Close';
        const color = typeof this.inputs.color === 'string' && this.inputs.color ? this.inputs.color : CATEGORICAL[0]!;
        const width = asWidth(this.inputs.lineWidth);
        const lineStyle = asLineStyle(this.inputs.lineStyle);

        const parsed = sym ? parseSymbol(sym) : null;
        const ticker = parsed?.ticker || sym;
        const rawVenue = sym ? (ctx.data.displayPrefix(sym) ?? parsed?.provider ?? undefined) : undefined;
        const venue = rawVenue ? rawVenue.toUpperCase() : undefined;
        const displayTitle = ticker ? (venue ? `${ticker} · ${venue}` : ticker) : undefined;

        const aligned = sym ? alignBars(chartBars, secondary) : [];
        const points: SeriesPoint[] = new Array<SeriesPoint>(chartBars.length);
        if (sym && aligned.length === chartBars.length) {
            // Compute source values on the aligned bars (null bars stay gaps).
            const nonNull: OHLCV[] = [];
            const indices: number[] = [];
            for (let i = 0; i < aligned.length; i += 1) {
                const b = aligned[i];
                if (b) {
                    nonNull.push(b);
                    indices.push(i);
                }
            }
            const vals = sourceValues(nonNull, source);
            for (let i = 0; i < chartBars.length; i += 1) {
                points[i] = { time: chartBars[i]!.time, value: null };
            }
            for (let k = 0; k < indices.length; k += 1) {
                const v = vals[k]!;
                const i = indices[k]!;
                points[i] = { time: chartBars[i]!.time, value: Number.isFinite(v) ? v : null };
            }
        } else {
            for (let i = 0; i < chartBars.length; i += 1) {
                points[i] = { time: chartBars[i]!.time, value: null };
            }
        }

        const seriesId = stableSeriesId({ instanceId: 'compare', kind: 'line', title: 'compare', ordinal: 0 });
        ctx.emit({
            ...(displayTitle ? { title: displayTitle } : {}),
            paneHint: placement === 'new-pane' ? 'new' : 'price',
            ownScale: placement === 'new-scale',
            percentBaseline: 'own',
            priceAxisLabel: true,
            series: [
                {
                    id: seriesId,
                    title: ticker || 'Compare',
                    paneId: '',
                    kind: 'line',
                    points,
                    style: { color, width, lineStyle },
                },
            ],
        });
    }
}

export const compareDescriptor: NativeIndicatorDescriptor = {
    type: 'compare',
    title: msg('indicator.compare.title', 'Compare symbol'),
    paneHint: 'price',
    overlay: true,
    multiInstance: true,
    catalog: false,
    inputsSchema: () => SCHEMA.map((s) => ({ ...s })),
    defaultInputs: () => defaults(),
    create: () => new CompareIndicator(),
};

/** Register the built-in Compare symbol native indicator (idempotent). */
export function registerCompare(): void {
    registerNativeIndicator(compareDescriptor);
}
