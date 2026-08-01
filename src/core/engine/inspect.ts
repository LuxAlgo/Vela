import type { IndicatorModel } from '../model/indicator';

/**
 * A renderer-agnostic count of the graphic elements one indicator generated — the
 * deterministic oracle signal. It confirms the core *produced* the elements (engine +
 * model mapping), independent of any renderer. Whether a renderer actually *drew* them
 * is a separate (visual) check.
 */
export interface IndicatorSummary {
    id: string;
    title: string;
    overlay: boolean;
    paneId?: string;
    /** A native (core-computed) indicator, and its type — absent/false for a Pine indicator. */
    native: boolean;
    nativeType?: string;
    /** Value-series counts keyed by kind (line/area/step/histogram/columns/circles/cross/candle/bar/markers). */
    series: Record<string, number>;
    fills: number;
    backgrounds: number;
    priceLines: number;
    lines: number;
    boxes: number;
    labels: number;
    polylines: number;
    linefills: number;
    tables: number;
    barColors: number;
    trades: number;
    inputs: number;
}

/** A snapshot of everything the Vela core has generated for the mounted indicators. */
export interface SceneInspection {
    indicators: IndicatorSummary[];
    /** Sums across all indicators, for convenient whole-scene assertions. */
    totals: {
        panes: number;
        series: number;
        fills: number;
        backgrounds: number;
        priceLines: number;
        lines: number;
        boxes: number;
        labels: number;
        polylines: number;
        linefills: number;
        tables: number;
        barColors: number;
        trades: number;
    };
}

/** Count the renderer-neutral elements of one indicator model. */
export function summarizeModel(model: IndicatorModel): IndicatorSummary {
    const series: Record<string, number> = {};
    for (const s of model.series) series[s.kind] = (series[s.kind] ?? 0) + 1;
    return {
        id: model.id,
        title: model.title,
        overlay: model.overlay,
        paneId: model.paneId,
        native: !!model.native,
        nativeType: model.native?.type,
        series,
        fills: model.fills.length,
        backgrounds: model.backgrounds.length,
        priceLines: model.priceLines.length,
        lines: model.lines?.length ?? 0,
        boxes: model.boxes?.length ?? 0,
        labels: model.labels?.length ?? 0,
        polylines: model.polylines?.length ?? 0,
        linefills: model.linefills?.length ?? 0,
        tables: model.tables?.length ?? 0,
        barColors: model.barColors?.length ?? 0,
        trades: model.trades?.length ?? 0,
        inputs: model.inputs.length,
    };
}

/** Aggregate indicator models into a full scene inspection. */
export function inspectModels(models: IndicatorModel[]): SceneInspection {
    const indicators = models.map(summarizeModel);
    const sum = (pick: (s: IndicatorSummary) => number): number => indicators.reduce((n, s) => n + pick(s), 0);
    return {
        indicators,
        totals: {
            panes: new Set(indicators.map((s) => s.paneId ?? 'price')).size,
            series: sum((s) => Object.values(s.series).reduce((a, b) => a + b, 0)),
            fills: sum((s) => s.fills),
            backgrounds: sum((s) => s.backgrounds),
            priceLines: sum((s) => s.priceLines),
            lines: sum((s) => s.lines),
            boxes: sum((s) => s.boxes),
            labels: sum((s) => s.labels),
            polylines: sum((s) => s.polylines),
            linefills: sum((s) => s.linefills),
            tables: sum((s) => s.tables),
            barColors: sum((s) => s.barColors),
            trades: sum((s) => s.trades),
        },
    };
}
