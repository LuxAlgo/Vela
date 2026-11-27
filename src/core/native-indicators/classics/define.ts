import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import type { LineLikeKind, LineStyle, MarkerPoint, SeriesDisplay, SeriesPoint, SeriesSpec } from '../../model/series';
import type { Fill, FillGradientStop, PriceLine } from '../../model/scene';
import type { DrawingPolyline } from '../../model/drawings';
import { stableSeriesId } from '../../model/identity';
import type { Unsubscribe } from '../../util/types';
import { timeframeToMs } from '../../../data/timeframe';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../NativeIndicator';
import type { MessageLike } from '../../i18n/types';
import { sourceText } from '../../i18n/text';
import { localizeInput, messageOnly, type LocalizableInput } from '../localize';
import { CLASSIC_INPUT_LABELS } from './labels';

/**
 * The classic-indicator adapter: each catalog entry is metadata plus a PURE
 * `compute(bars, inputs)` returning bar-aligned value arrays, and this module
 * wraps it into a {@link NativeIndicatorDescriptor} — lifecycle, stable ids,
 * SeriesPoint conversion and fills all handled once. Keeping the computes pure
 * is what makes the whole catalog testable without a chart.
 */

/** One plotted value series; `values` align to bars by index, NaN = whitespace. */
export interface ClassicPlot {
    /** Stable identity of the plot within the indicator (drives the series id). */
    key: string;
    /** The plot's name. Its English text is the series' identity (its id, its output
     *  key); a message shows translated wherever the chart names the plot. */
    title: MessageLike;
    /** Shown instead of {@link title} where the chart names the plot, for a plot whose
     *  shown name differs from its English identity. */
    displayTitle?: MessageLike;
    /** Series kind; default `'line'`. */
    kind?: LineLikeKind;
    values: readonly number[];
    color: string;
    width?: number;
    lineStyle?: LineStyle;
    /** Baseline for histogram/area kinds. */
    base?: number;
    /** Per-bar color override, aligned to bars by index. */
    colors?: ReadonlyArray<string | null>;
    /** Horizontal shift in bars: positive projects forward past the last bar into right
     *  whitespace; negative pulls backward onto earlier bars (leaving trailing gaps). */
    offset?: number;
    /** Render on the price pane even when the indicator owns a study pane. */
    overlay?: boolean;
    /**
     * Per-surface visibility. A plot shown nowhere still anchors a {@link ClassicBand} —
     * that is how a zone shaded against a constant (an overbought level, the 0/100 rails)
     * is expressed without a line in the pane or a row in the legend.
     */
    display?: SeriesDisplay;
}

/** A soft band filled between two plots (referenced by plot key). */
export interface ClassicBand {
    key: string;
    from: string;
    to: string;
    color: string;
    /** Per-bar solid color, aligned to bars by index; overrides {@link color} where set. */
    colors?: ReadonlyArray<string | null>;
    /** Per-bar vertical gradient (a two-tone wash across the band), aligned by index. */
    gradient?: ReadonlyArray<FillGradientStop | null>;
}

/** A fixed horizontal level on the indicator's pane. */
export interface ClassicLevel {
    key: string;
    price: number;
    color?: string;
    lineStyle?: LineStyle;
    title?: MessageLike;
}

/** What one compute pass yields. */
export interface ClassicOutput {
    plots: ClassicPlot[];
    bands?: ClassicBand[];
    levels?: ClassicLevel[];
    markers?: MarkerPoint[];
    /** Free-form paths (e.g. a zigzag's pivot-to-pivot legs). */
    polylines?: Array<Omit<DrawingPolyline, 'id' | 'paneId'> & { key: string }>;
}

/** One input of a catalog entry: an input schema whose title and tooltip may be messages. */
export type ClassicInput = LocalizableInput;

/** A catalog entry: metadata + input schema + the pure compute. */
export interface ClassicIndicatorSpec {
    type: string;
    title: MessageLike;
    shortTitle?: MessageLike;
    /** true = draws over the price candles; false = its own pane below. */
    overlay: boolean;
    inputs: ClassicInput[];
    /**
     * Secondary symbols required for the current inputs (beyond the chart's own bars).
     * When non-empty, the adapter fetches and live-subscribes each symbol on the chart's
     * timeframe and passes the raw external bar arrays in `compute`'s third argument.
     */
    externalSymbols?(inputs: Record<string, InputValue>): readonly string[];
    compute(
        bars: readonly OHLCV[],
        inputs: Record<string, InputValue>,
        external?: ReadonlyMap<string, readonly OHLCV[]>,
    ): ClassicOutput;
}

export function num(inputs: Record<string, InputValue>, key: string, fallback: number): number {
    const v = inputs[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function str(inputs: Record<string, InputValue>, key: string, fallback: string): string {
    const v = inputs[key];
    return typeof v === 'string' && v !== '' ? v : fallback;
}

export function bool(inputs: Record<string, InputValue>, key: string, fallback: boolean): boolean {
    const v = inputs[key];
    return typeof v === 'boolean' ? v : fallback;
}

/** Typical spacing between bars in ms — used to timestamp future slots past the last bar. */
function barStepMs(bars: readonly OHLCV[], timeframe: string): number {
    if (bars.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < bars.length; i++) {
            const g = bars[i]!.time - bars[i - 1]!.time;
            if (g > 0) gaps.push(g);
        }
        if (gaps.length > 0) {
            gaps.sort((a, b) => a - b);
            return gaps[Math.floor(gaps.length / 2)]!;
        }
    }
    return timeframeToMs(timeframe) || 60_000;
}

function toPoints(
    bars: readonly OHLCV[],
    values: readonly number[],
    colors?: ReadonlyArray<string | null>,
    offset = 0,
    stepMs = 60_000,
): SeriesPoint[] {
    const shift = Math.trunc(offset);
    if (shift === 0) {
        const pts = new Array<SeriesPoint>(bars.length);
        for (let i = 0; i < bars.length; i++) {
            const v = values[i];
            const p: SeriesPoint = { time: bars[i]!.time, value: v != null && Number.isFinite(v) ? v : null };
            const c = colors?.[i];
            if (c != null) p.color = c;
            pts[i] = p;
        }
        return pts;
    }
    if (bars.length === 0) return [];
    if (shift < 0) {
        const back = -shift;
        const pts = new Array<SeriesPoint>(bars.length);
        for (let i = 0; i < bars.length; i++) {
            const src = i + back;
            const v = src < values.length ? values[src] : undefined;
            const p: SeriesPoint = { time: bars[i]!.time, value: v != null && Number.isFinite(v) ? v : null };
            const c = src < values.length ? colors?.[src] : undefined;
            if (c != null) p.color = c;
            pts[i] = p;
        }
        return pts;
    }
    // Positive shift: extend past the last bar so the renderer paints into right whitespace.
    const total = bars.length + shift;
    const lastTime = bars[bars.length - 1]!.time;
    const pts = new Array<SeriesPoint>(total);
    for (let i = 0; i < total; i++) {
        const time = i < bars.length ? bars[i]!.time : lastTime + (i - (bars.length - 1)) * stepMs;
        const src = i - shift;
        const v = src >= 0 && src < values.length ? values[src] : undefined;
        const p: SeriesPoint = { time, value: v != null && Number.isFinite(v) ? v : null };
        const c = src >= 0 && src < values.length ? colors?.[src] : undefined;
        if (c != null) p.color = c;
        pts[i] = p;
    }
    return pts;
}

/** Shift a bar-aligned per-column band array (`colors` or `gradient`) to match a displaced pair of plots. */
function shiftBandArray<T>(arr: ReadonlyArray<T | null>, offset: number): Array<T | null> {
    const shift = Math.trunc(offset);
    if (shift === 0) return [...arr];
    if (shift > 0) return [...new Array<T | null>(shift).fill(null), ...arr];
    const back = -shift;
    const out = new Array<T | null>(arr.length).fill(null);
    for (let i = 0; i + back < arr.length; i++) out[i] = arr[i + back]!;
    return out;
}

/** Merge a live secondary bar into an ascending bar cache (replace same open-time, append newer). */
function mergeLiveBar(bars: OHLCV[], incoming: OHLCV): void {
    const last = bars[bars.length - 1];
    if (last && last.time === incoming.time) bars[bars.length - 1] = incoming;
    else if (!last || incoming.time > last.time) bars.push(incoming);
}

class ClassicIndicator implements NativeIndicator {
    /** Null until start() — a pre-start setInputs must record without computing. */
    private ctx: NativeIndicatorContext | null = null;
    private inputs: Record<string, InputValue> = {};
    private extBars = new Map<string, OHLCV[]>();
    private extFetchedFrom = new Map<string, number>();
    private extSubs = new Map<string, Unsubscribe>();
    private fetchSeq = 0;
    private suspended = false;

    constructor(private readonly spec: ClassicIndicatorSpec) {}

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = inputs;
        this.suspended = false;
        this.syncAndCompute();
    }

    onBars(): void {
        if (!this.ctx || this.suspended) return;
        this.syncAndCompute();
    }

    onViewport(): void {}

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = inputs;
        // Pre-start edits (a workspace restore applies stored inputs the moment the
        // handle exists) just record: `ctx` lands at start(), which recomputes with
        // the orchestrator's replayed values — computing here would read no bars.
        if (!this.ctx || this.suspended) return;
        this.syncAndCompute();
    }

    suspend(): void {
        this.suspended = true;
        this.fetchSeq++;
        this.clearSubs();
    }

    resume(): void {
        this.suspended = false;
        if (!this.ctx) return;
        this.syncAndCompute();
    }

    stop(): void {
        this.suspended = true;
        this.fetchSeq++;
        this.clearSubs();
        this.extBars.clear();
        this.extFetchedFrom.clear();
        this.ctx = null;
    }

    private clearSubs(): void {
        for (const off of this.extSubs.values()) off();
        this.extSubs.clear();
    }

    private wantedExternalSymbols(): string[] {
        const raw = this.spec.externalSymbols?.(this.inputs);
        if (!raw || raw.length === 0) return [];
        const out: string[] = [];
        const seen = new Set<string>();
        for (const s of raw) {
            const trimmed = s.trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            out.push(trimmed);
        }
        return out;
    }

    private isOwnSymbol(sym: string): boolean {
        if (!this.ctx) return false;
        const canon = (s: string): string => (this.ctx!.data.canonicalSymbol?.(s) ?? s).trim().toUpperCase();
        return canon(sym) === canon(this.ctx.symbol);
    }

    private buildExternalMap(bars: readonly OHLCV[], wanted: readonly string[]): Map<string, readonly OHLCV[]> | undefined {
        if (wanted.length === 0) return undefined;
        const map = new Map<string, readonly OHLCV[]>();
        for (const sym of wanted) {
            map.set(sym, this.isOwnSymbol(sym) ? bars : (this.extBars.get(sym) ?? []));
        }
        return map;
    }

    private ensureSubscriptions(remote: readonly string[]): void {
        const ctx = this.ctx;
        if (!ctx || !ctx.live || !ctx.subscribeSeries || this.suspended) return;
        for (const sym of remote) {
            if (this.extSubs.has(sym)) continue;
            const off = ctx.subscribeSeries(sym, ctx.timeframe, (bar) => {
                if (!this.ctx || this.suspended) return;
                let arr = this.extBars.get(sym);
                if (!arr) {
                    arr = [];
                    this.extBars.set(sym, arr);
                }
                mergeLiveBar(arr, bar);
                this.emitCompute(this.ctx.bars(), this.wantedExternalSymbols());
            });
            this.extSubs.set(sym, off);
        }
    }

    private syncAndCompute(): void {
        const ctx = this.ctx;
        if (!ctx) return;
        const bars = ctx.bars();
        const wanted = this.wantedExternalSymbols();
        const wantedSet = new Set(wanted);
        // Drop caches and live subscriptions for symbols no longer requested by the inputs.
        for (const sym of [...this.extSubs.keys()]) {
            if (!wantedSet.has(sym) || this.isOwnSymbol(sym)) {
                this.extSubs.get(sym)?.();
                this.extSubs.delete(sym);
            }
        }
        for (const sym of [...this.extBars.keys()]) {
            if (!wantedSet.has(sym) || this.isOwnSymbol(sym)) {
                this.extBars.delete(sym);
                this.extFetchedFrom.delete(sym);
            }
        }
        const remote = wanted.filter((s) => !this.isOwnSymbol(s));
        if (remote.length === 0) {
            this.fetchSeq++;
            this.emitCompute(bars, wanted);
            ctx.setStatus('idle');
            return;
        }
        // Emit immediately (with cached data or gaps) so the indicator mounts right away
        // instead of blocking on network I/O (needed for loading status and confirm dialogs).
        this.emitCompute(bars, wanted);
        if (!ctx.fetchSeries || bars.length === 0) {
            ctx.setStatus('idle');
            return;
        }
        const earliest = bars[0]!.time;
        const needFetch = remote.filter((sym) => !this.extBars.has(sym) || earliest < (this.extFetchedFrom.get(sym) ?? Infinity));
        if (needFetch.length === 0) {
            this.ensureSubscriptions(remote);
            ctx.setStatus('idle');
            return;
        }
        const seq = ++this.fetchSeq;
        ctx.setStatus('loading');
        const step = barStepMs(bars, ctx.timeframe);
        const range = { from: earliest, to: bars[bars.length - 1]!.time + step, limit: bars.length + 64 };
        void Promise.all(
            needFetch.map(async (sym) => {
                try {
                    const fetched = await ctx.fetchSeries!(sym, ctx.timeframe, range);
                    return [sym, fetched] as const;
                } catch {
                    return [sym, [] as OHLCV[]] as const;
                }
            }),
        ).then((results) => {
            if (seq !== this.fetchSeq || !this.ctx || this.suspended) return;
            for (const [sym, fetched] of results) {
                this.extBars.set(sym, [...fetched]);
                this.extFetchedFrom.set(sym, earliest);
            }
            this.ensureSubscriptions(remote);
            this.emitCompute(this.ctx.bars(), this.wantedExternalSymbols());
            this.ctx.setStatus('idle');
        });
    }

    private emitCompute(bars: readonly OHLCV[], wanted: readonly string[]): void {
        if (!this.ctx) return;
        const external = this.buildExternalMap(bars, wanted);
        const out = this.spec.compute(bars, this.inputs, external);
        const step = barStepMs(bars, this.ctx.timeframe);
        const instanceId = this.spec.type;
        const series: SeriesSpec[] = [];
        const idsByKey = new Map<string, string>();
        const offsetsByKey = new Map<string, number>();
        out.plots.forEach((plot, ordinal) => {
            const kind = plot.kind ?? 'line';
            const title = sourceText(plot.title);
            const id = stableSeriesId({ instanceId, kind, title, ordinal });
            const offset = Math.trunc(plot.offset ?? 0);
            idsByKey.set(plot.key, id);
            offsetsByKey.set(plot.key, offset);
            const displayTitle = plot.displayTitle ?? messageOnly(plot.title);
            series.push({
                id,
                title,
                ...(displayTitle ? { displayTitle } : {}),
                paneId: '', // stamped by the orchestrator
                kind,
                points: toPoints(bars, plot.values, plot.colors, offset, step),
                style: {
                    color: plot.color,
                    width: plot.width ?? 1,
                    lineStyle: plot.lineStyle ?? 'solid',
                    ...(plot.base != null ? { base: plot.base } : {}),
                },
                ...(plot.overlay ? { overlay: true } : {}),
                ...(plot.display ? { display: plot.display } : {}),
            });
        });
        if (out.markers && out.markers.length > 0) {
            const name = this.spec.shortTitle ?? this.spec.title;
            const displayTitle = messageOnly(name);
            series.push({
                id: stableSeriesId({ instanceId, kind: 'markers', title: 'markers', ordinal: 0 }),
                title: sourceText(name),
                ...(displayTitle ? { displayTitle } : {}),
                paneId: '',
                kind: 'markers',
                markers: out.markers,
            });
        }
        const fills: Fill[] = (out.bands ?? []).flatMap((band, ordinal) => {
            const from = idsByKey.get(band.from);
            const to = idsByKey.get(band.to);
            if (!from || !to) return [];
            const fromOff = offsetsByKey.get(band.from) ?? 0;
            const toOff = offsetsByKey.get(band.to) ?? 0;
            const bandOff = fromOff === toOff ? fromOff : 0;
            return [
                {
                    id: stableSeriesId({ instanceId, kind: 'fill', title: band.key, ordinal }),
                    paneId: '',
                    fromSeriesId: from,
                    toSeriesId: to,
                    color: band.color,
                    ...(band.colors ? { colors: shiftBandArray(band.colors, bandOff) } : {}),
                    ...(band.gradient ? { gradient: shiftBandArray(band.gradient, bandOff) } : {}),
                },
            ];
        });
        const priceLines: PriceLine[] = (out.levels ?? []).map((level, ordinal) => ({
            id: stableSeriesId({ instanceId, kind: 'hline', title: level.key, ordinal }),
            paneId: '',
            price: level.price,
            ...(level.color != null ? { color: level.color } : {}),
            lineStyle: level.lineStyle ?? 'dashed',
            width: 1,
            ...(level.title != null ? { title: sourceText(level.title) } : {}),
            ...(messageOnly(level.title) ? { displayTitle: level.title } : {}),
        }));
        const polylines: DrawingPolyline[] = (out.polylines ?? []).map((poly, ordinal) => {
            const { key, ...rest } = poly;
            return {
                id: stableSeriesId({ instanceId, kind: 'polyline', title: key, ordinal }),
                paneId: '',
                ...rest,
            };
        });
        this.ctx.emit({ series, fills, priceLines, polylines });
    }
}

/** Wrap a catalog entry into a registrable native-indicator descriptor. */
export function classicDescriptor(spec: ClassicIndicatorSpec): NativeIndicatorDescriptor {
    let schema: InputSchema[] | null = null;
    const inputs = (): InputSchema[] => (schema ??= spec.inputs.map((i) => localizeInput(i, CLASSIC_INPUT_LABELS)));
    return {
        type: spec.type,
        title: spec.title,
        ...(spec.shortTitle != null ? { shortTitle: spec.shortTitle } : {}),
        paneHint: spec.overlay ? 'price' : 'new',
        overlay: spec.overlay,
        // Studies stack (a 20 and a 200 moving average side by side) — unlike the layer-backed natives.
        multiInstance: true,
        // A study's values depend on every bar before them (an EMA's seed, an RSI's
        // smoothing), so it computes once over the whole history, as script indicators do.
        waitsForHistory: true,
        inputsSchema: () => inputs(),
        defaultInputs: () => Object.fromEntries(spec.inputs.map((i) => [i.key, i.defval])),
        create: () => new ClassicIndicator(spec),
    };
}
