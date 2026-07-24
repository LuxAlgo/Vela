import type { PineRun, PinePlot, PinePlotPoint, PineRunMeta } from './PineRun';
import { asString, asNumber } from './PineRun';

/** Loose view of the raw PineTS Context (only what we read). */
interface RawContext {
    fullContext?: RawContext;
    plots?: Record<string, RawPlot | undefined>;
    indicator?: Record<string, unknown>;
}
interface RawPlot {
    title?: unknown;
    options?: Record<string, unknown>;
    data?: PinePlotPoint[];
    plot1?: unknown;
    plot2?: unknown;
}

/**
 * During streaming PineTS re-executes the forming/new bar each tick and
 * re-appends that bar's plot point WITHOUT rolling back regular plot data
 * (it rolls back drawings, not plots). So a streamed plot's `data` accumulates
 * duplicate timestamps at the tail. Keep the LAST point per timestamp (the
 * latest re-execution wins). Fast-path returns the input unchanged when there
 * are no duplicates, so first-run / static output is untouched.
 */
function dedupeByTime(data: PinePlotPoint[]): PinePlotPoint[] {
    const lastIdx = new Map<number, number>();
    let hasDup = false;
    for (let i = 0; i < data.length; i += 1) {
        const t = data[i]!.time;
        if (lastIdx.has(t)) hasDup = true;
        lastIdx.set(t, i);
    }
    if (!hasDup) return data;
    const keep = new Set(lastIdx.values());
    return data.filter((_, i) => keep.has(i));
}

/**
 * The ONE choke point for PineTS Context outer-shape drift. During streaming
 * the page `ctx.plots` is sliced and the full history lives on
 * `ctx.fullContext.plots` — so we read from `fullContext` when present.
 */
export function normalizeContext(ctx: unknown): PineRun {
    const c = (ctx ?? {}) as RawContext;
    const root = c.fullContext ?? c;
    const indicator = root.indicator ?? {};

    const meta: PineRunMeta = {
        title: asString(indicator.title) ?? 'Indicator',
        overlay: indicator.overlay === true,
        precision: asNumber(indicator.precision),
        shorttitle: asString(indicator.shorttitle),
        format: asString(indicator.format),
    };

    const plotsObj = root.plots ?? {};
    const plots: PinePlot[] = Object.entries(plotsObj).map(([key, raw]) => {
        const p = raw ?? {};
        const options = (p.options ?? {}) as Record<string, unknown>;
        return {
            key,
            title: asString(p.title),
            style: asString(options.style),
            options,
            data: Array.isArray(p.data) ? dedupeByTime(p.data) : [],
            plot1: asString(p.plot1) ?? asString(options.plot1),
            plot2: asString(p.plot2) ?? asString(options.plot2),
        };
    });

    return { meta, plots };
}
