import { describe, it, expect } from 'vitest';
import { Vela } from '../src/index';
import { PineEngine } from '../src/engines/pinets/PineEngine';
import { heikinAshiFull } from '../src/core/price-styles/heikin-ashi';
import type { MarketDataFeed, BarRange } from '../src/core/ports/MarketDataFeed';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { PriceStyle, VelaTheme } from '../src/core/options';
import type { Pane } from '../src/core/model/scene';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ScenePatch } from '../src/core/model/patch';
import type { InputValue } from '../src/core/model/inputs';
import type { Unsubscribe } from '../src/core/util/types';
import type { IndicatorRenderHandle, VisibleRange, InputChangeEvent, CrosshairEvent, ClickEvent } from '../src/core/ports/IChartRenderer';

/**
 * END-TO-END Heikin Ashi × request.security through the REAL PineTS engine:
 * on an HA chart, `syminfo.tickerid` carries the ";heikinashi" extended-ticker
 * modifier, so same-symbol security calls fetch the DERIVED series (on the
 * requested timeframe) while `ticker.standard()` opts back into raw data —
 * verified against both a higher ("240") and a lower ("15") timeframe.
 * The companion playground script lives at
 * playground/indicators/zz_compat/heikin-ashi-security.pine.
 */

const MIN = 60_000;
const BASE = 1_700_000_000_000 - (1_700_000_000_000 % (240 * MIN)); // 4h-aligned so all TFs nest

/** Deterministic bars for one timeframe; closes vary so HA differs from raw. */
function barsFor(tfMin: number, count: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < count; i += 1) {
        const open = 100 + i + Math.cos(i / 3) * 2;
        const close = 100 + i + Math.sin(i / 2) * 3;
        out.push({
            time: BASE + i * tfMin * MIN,
            open,
            high: Math.max(open, close) + 2,
            low: Math.min(open, close) - 2,
            close,
            volume: 10,
        });
    }
    return out;
}

const SERIES: Record<string, OHLCV[]> = {
    '60': barsFor(60, 96),
    '240': barsFor(240, 24),
    '15': barsFor(15, 384),
};

/** Feed serving the per-timeframe fixtures (ranged + limited like a real provider). */
class MultiTfFeed implements MarketDataFeed {
    load(cfg: { timeframe?: string; bars?: number }): Promise<OHLCV[]> {
        const all = SERIES[cfg.timeframe ?? '60'] ?? [];
        return Promise.resolve(cfg.bars ? all.slice(-cfg.bars) : all);
    }
    loadRange(cfg: { timeframe?: string }, range: BarRange): Promise<OHLCV[]> {
        let out = (SERIES[cfg.timeframe ?? '60'] ?? []).filter(
            (b) => (range.from == null || b.time >= range.from) && (range.to == null || b.time <= range.to),
        );
        if (range.limit && out.length > range.limit) out = out.slice(-range.limit);
        return Promise.resolve(out);
    }
    subscribe(): Unsubscribe { return () => {}; }
}

/** Minimal renderer fake: records mounted models + drives the price-style seam. */
class StyleFakeRenderer {
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    readonly capabilities = {
        panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
        barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
    } as const;
    mountedModels: IndicatorModel[] = [];
    bars: OHLCV[] = [];
    private priceStyleCb: ((s: PriceStyle) => void) | null = null;
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    applyFeature(): void {}
    readFeature(): unknown { return undefined; }
    setBars(bars: OHLCV[]): void { this.bars = bars; }
    updateBar(): void {}
    ensurePane(_p: Pane): void {}
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle { this.mountedModels.push(model); return { id: model.id }; }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe { return () => {}; }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe { return () => {}; }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe { return () => {}; }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe { return () => {}; }
    getVisibleRange(): VisibleRange | null { return null; }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe { return () => {}; }
    onPriceStyleChange(cb: (s: PriceStyle) => void): Unsubscribe { this.priceStyleCb = cb; return () => { this.priceStyleCb = null; }; }
    firePriceStyle(style: PriceStyle): void { this.priceStyleCb?.(style); }
}

const SOURCE = `//@version=5
indicator("HA security probe", overlay=false)
htf_ha  = request.security(syminfo.tickerid, "240", close)
htf_raw = request.security(ticker.standard(syminfo.tickerid), "240", close)
ltf_ha  = request.security(syminfo.tickerid, "15", close)
ltf_raw = request.security(ticker.standard(syminfo.tickerid), "15", close)
stf_ha  = request.security(syminfo.tickerid, "60", close)
stf_raw = request.security(ticker.standard(syminfo.tickerid), "60", close)
plot(htf_ha,  "htf_ha")
plot(htf_raw, "htf_raw")
plot(ltf_ha,  "ltf_ha")
plot(ltf_raw, "ltf_raw")
plot(stf_ha,  "stf_ha")
plot(stf_raw, "stf_raw")
plot(chart.is_heikinashi ? 1 : 0, "is_ha")
`;

/** The finite plotted values of a titled series in the LATEST mounted model. */
function values(renderer: StyleFakeRenderer, title: string): number[] {
    const model = renderer.mountedModels[renderer.mountedModels.length - 1]!;
    const s = model.series.find((x) => x.title === title);
    if (!s || !('points' in s)) return [];
    return s.points.map((p) => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** Distinct-value set with float noise flattened. */
function asSet(vals: number[]): Set<string> {
    return new Set(vals.map((v) => v.toFixed(9)));
}

function isSubset(sub: Set<string>, sup: Set<string>): boolean {
    for (const v of sub) if (!sup.has(v)) return false;
    return true;
}

async function waitFor(cond: () => boolean, ms = 20_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 50));
    }
}

describe('Heikin Ashi × request.security through the real PineTS engine', () => {
    it('routes chart-typed vs standard data by extended ticker, on higher AND lower timeframes', async () => {
        const renderer = new StyleFakeRenderer();
        const chart = new Vela(
            {} as unknown as HTMLElement,
            { symbol: 'TEST', timeframe: '60', live: false, volume: false },
            { renderer: renderer as never, engines: [new PineEngine()], dataFeed: new MultiTfFeed() },
        );
        const errors: string[] = [];
        chart.on('indicator:error', (e) => errors.push(e.error.message));
        chart.addIndicator(SOURCE);
        await chart.ready();
        await waitFor(() => renderer.mountedModels.some((m) => m.series.length >= 7) || errors.length > 0);
        expect(errors).toEqual([]);

        const rawHtfCloses = asSet(SERIES['240']!.map((b) => b.close));
        const haHtfCloses = asSet(heikinAshiFull(SERIES['240']!).map((b) => b.close));
        const rawLtfCloses = asSet(SERIES['15']!.map((b) => b.close));
        const haLtfCloses = asSet(heikinAshiFull(SERIES['15']!).map((b) => b.close));
        const rawStfCloses = asSet(SERIES['60']!.map((b) => b.close));
        const haStfCloses = asSet(heikinAshiFull(SERIES['60']!).map((b) => b.close));

        // ── Standard chart: is_ha = 0 and both security flavors serve the SAME raw data ──
        expect(new Set(values(renderer, 'is_ha'))).toEqual(new Set([0]));
        expect(values(renderer, 'htf_ha')).toEqual(values(renderer, 'htf_raw'));
        expect(isSubset(asSet(values(renderer, 'htf_raw')), rawHtfCloses)).toBe(true);
        expect(isSubset(asSet(values(renderer, 'ltf_raw')), rawLtfCloses)).toBe(true);

        // ── Switch to Heikin Ashi: the indicator re-executes with the modified tickerid ──
        const mountsBefore = renderer.mountedModels.length;
        renderer.firePriceStyle('heikinashi');
        await waitFor(() => renderer.mountedModels.length > mountsBefore || errors.length > 0);
        expect(errors).toEqual([]);

        expect(new Set(values(renderer, 'is_ha'))).toEqual(new Set([1])); // chart.is_heikinashi
        // Higher timeframe: syminfo.tickerid → HA-240 closes; ticker.standard() → raw-240 closes.
        const htfHa = values(renderer, 'htf_ha');
        const htfRaw = values(renderer, 'htf_raw');
        expect(htfHa.length).toBeGreaterThan(10);
        expect(isSubset(asSet(htfHa), haHtfCloses)).toBe(true);
        expect(isSubset(asSet(htfRaw), rawHtfCloses)).toBe(true);
        expect(htfHa).not.toEqual(htfRaw); // the transform actually changed the data
        // Lower timeframe: same routing on 15-minute data.
        const ltfHa = values(renderer, 'ltf_ha');
        const ltfRaw = values(renderer, 'ltf_raw');
        expect(ltfHa.length).toBeGreaterThan(10);
        expect(isSubset(asSet(ltfHa), haLtfCloses)).toBe(true);
        expect(isSubset(asSet(ltfRaw), rawLtfCloses)).toBe(true);
        expect(ltfHa).not.toEqual(ltfRaw);
        // SAME timeframe as the chart — the collision case: the chart series is addressed
        // by its EXTENDED ticker, so the tickerid flavor is the chart's own (HA) closes
        // while the plain ticker must fetch RAW data, never the in-memory view.
        const stfHa = values(renderer, 'stf_ha');
        const stfRaw = values(renderer, 'stf_raw');
        expect(stfHa.length).toBeGreaterThan(10);
        expect(isSubset(asSet(stfHa), haStfCloses)).toBe(true);
        expect(isSubset(asSet(stfRaw), rawStfCloses)).toBe(true);
        expect(stfHa).not.toEqual(stfRaw);

        // ── And back: standard chart semantics return ──
        const mountsBefore2 = renderer.mountedModels.length;
        renderer.firePriceStyle('candles');
        await waitFor(() => renderer.mountedModels.length > mountsBefore2 || errors.length > 0);
        expect(errors).toEqual([]);
        expect(new Set(values(renderer, 'is_ha'))).toEqual(new Set([0]));
        expect(values(renderer, 'htf_ha')).toEqual(values(renderer, 'htf_raw'));
    }, 60_000);
});
