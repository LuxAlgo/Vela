import type { OHLCV } from '../../model/ohlcv';
import type { InputSchema, InputValue } from '../../model/inputs';
import type { LineLikeKind, LineStyle, MarkerPoint, SeriesPoint, SeriesSpec } from '../../model/series';
import type { Fill, PriceLine } from '../../model/scene';
import type { DrawingPolyline } from '../../model/drawings';
import { stableSeriesId } from '../../model/identity';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../NativeIndicator';

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
    title: string;
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
    /** Render on the price pane even when the indicator owns a study pane. */
    overlay?: boolean;
}

/** A soft band filled between two plots (referenced by plot key). */
export interface ClassicBand {
    key: string;
    from: string;
    to: string;
    color: string;
}

/** A fixed horizontal level on the indicator's pane. */
export interface ClassicLevel {
    key: string;
    price: number;
    color?: string;
    lineStyle?: LineStyle;
    title?: string;
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

/** A catalog entry: metadata + input schema + the pure compute. */
export interface ClassicIndicatorSpec {
    type: string;
    title: string;
    shortTitle?: string;
    /** true = draws over the price candles; false = its own pane below. */
    overlay: boolean;
    inputs: InputSchema[];
    compute(bars: readonly OHLCV[], inputs: Record<string, InputValue>): ClassicOutput;
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

function toPoints(bars: readonly OHLCV[], values: readonly number[], colors?: ReadonlyArray<string | null>): SeriesPoint[] {
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

class ClassicIndicator implements NativeIndicator {
    private ctx!: NativeIndicatorContext;
    private inputs: Record<string, InputValue> = {};

    constructor(private readonly spec: ClassicIndicatorSpec) {}

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = inputs;
        this.recompute();
    }

    onBars(): void {
        this.recompute();
    }

    onViewport(): void {}

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = inputs;
        this.recompute();
    }

    /** Nothing to free — the compute reads the live bar accessor on demand. */
    suspend(): void {}

    resume(): void {
        this.recompute();
    }

    stop(): void {}

    private recompute(): void {
        const bars = this.ctx.bars();
        const out = this.spec.compute(bars, this.inputs);
        const instanceId = this.spec.type;
        const series: SeriesSpec[] = [];
        const idsByKey = new Map<string, string>();
        out.plots.forEach((plot, ordinal) => {
            const kind = plot.kind ?? 'line';
            const id = stableSeriesId({ instanceId, kind, title: plot.title, ordinal });
            idsByKey.set(plot.key, id);
            series.push({
                id,
                title: plot.title,
                paneId: '', // stamped by the orchestrator
                kind,
                points: toPoints(bars, plot.values, plot.colors),
                style: {
                    color: plot.color,
                    width: plot.width ?? 1,
                    lineStyle: plot.lineStyle ?? 'solid',
                    ...(plot.base != null ? { base: plot.base } : {}),
                },
                ...(plot.overlay ? { overlay: true } : {}),
            });
        });
        if (out.markers && out.markers.length > 0) {
            series.push({
                id: stableSeriesId({ instanceId, kind: 'markers', title: 'markers', ordinal: 0 }),
                title: this.spec.shortTitle ?? this.spec.title,
                paneId: '',
                kind: 'markers',
                markers: out.markers,
            });
        }
        const fills: Fill[] = (out.bands ?? []).flatMap((band, ordinal) => {
            const from = idsByKey.get(band.from);
            const to = idsByKey.get(band.to);
            if (!from || !to) return [];
            return [
                {
                    id: stableSeriesId({ instanceId, kind: 'fill', title: band.key, ordinal }),
                    paneId: '',
                    fromSeriesId: from,
                    toSeriesId: to,
                    color: band.color,
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
            ...(level.title != null ? { title: level.title } : {}),
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
        this.ctx.setStatus('idle');
    }
}

/** Wrap a catalog entry into a registrable native-indicator descriptor. */
export function classicDescriptor(spec: ClassicIndicatorSpec): NativeIndicatorDescriptor {
    return {
        type: spec.type,
        title: spec.title,
        ...(spec.shortTitle != null ? { shortTitle: spec.shortTitle } : {}),
        paneHint: spec.overlay ? 'price' : 'new',
        overlay: spec.overlay,
        // Studies stack (a 20 and a 200 moving average side by side) — unlike the layer-backed natives.
        multiInstance: true,
        inputsSchema: () => spec.inputs,
        defaultInputs: () => Object.fromEntries(spec.inputs.map((i) => [i.key, i.defval])),
        create: () => new ClassicIndicator(spec),
    };
}
