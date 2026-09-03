import { afterEach, describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';
import { CHART_CONFIG_VERSION, defaultChartStyle, factoryResetConfig, mergeConfig, type ChartConfig } from '../src/renderers/native/core/chartConfig';

/** A known-good baseline config for the pure mergeConfig tests. */
function baseConfig(): ChartConfig {
    return new NativeRenderer().getConfig();
}

describe('mergeConfig — validating reducer (item 15)', () => {
    it('returns the base unchanged for an empty / non-object patch', () => {
        const base = baseConfig();
        expect(mergeConfig(base, {})).toEqual(base);
        expect(mergeConfig(base, null)).toEqual(base);
        expect(mergeConfig(base, 42)).toEqual(base);
    });

    it('applies only the named fields of a partial patch', () => {
        const base = baseConfig();
        const out = mergeConfig(base, { candles: { upColor: '#123456' } });
        expect(out.candles.upColor).toBe('#123456');
        expect(out.candles.downColor).toBe(base.candles.downColor); // untouched
        expect(out.layout).toEqual(base.layout); // untouched section
    });

    it('drops malformed fields (keeps the base value)', () => {
        const base = baseConfig();
        const out = mergeConfig(base, {
            layout: { background: 123, fontSize: 'big' },
            crosshair: { style: 'zigzag', width: -5 },
            priceScale: { mode: 'nope', log: 'yes' },
            series: { style: 'renko' },
        });
        expect(out.layout.background).toBe(base.layout.background);
        expect(out.layout.fontSize).toBe(base.layout.fontSize);
        expect(out.crosshair.style).toBe(base.crosshair.style);
        expect(out.priceScale.mode).toBe(base.priceScale.mode);
        expect(out.priceScale.log).toBe(base.priceScale.log);
        expect(out.series.style).toBe(base.series.style);
        // a valid-but-clamped value still applies
        expect(mergeConfig(base, { crosshair: { width: 4 } }).crosshair.width).toBe(4);
    });

    it('clamps opacity to 0–1 and font size to a sane range', () => {
        const base = baseConfig();
        expect(mergeConfig(base, { crosshair: { opacity: 5 } }).crosshair.opacity).toBe(1);
        expect(mergeConfig(base, { crosshair: { opacity: -1 } }).crosshair.opacity).toBe(0);
        expect(mergeConfig(base, { layout: { fontSize: 999 } }).layout.fontSize).toBe(32);
        expect(mergeConfig(base, { layout: { fontSize: 1 } }).layout.fontSize).toBe(6);
    });

    it('series.baseline accepts a number or explicit null', () => {
        const base = baseConfig();
        expect(mergeConfig(base, { series: { baseline: 100 } }).series.baseline).toBe(100);
        expect(mergeConfig(base, { series: { baseline: null } }).series.baseline).toBeNull();
        expect(mergeConfig(base, { series: { baseline: 'x' } }).series.baseline).toBe(base.series.baseline);
    });

    it('series.spacing defaults to 1, clamps to [0.1, 10], and drops non-numbers', () => {
        const base = baseConfig();
        expect(base.series.spacing).toBe(1);
        expect(mergeConfig(base, { series: { spacing: 2.5 } }).series.spacing).toBe(2.5);
        expect(mergeConfig(base, { series: { spacing: 0.5 } }).series.spacing).toBe(0.5);
        expect(mergeConfig(base, { series: { spacing: 0 } }).series.spacing).toBe(0.1); // floored above 0
        expect(mergeConfig(base, { series: { spacing: -3 } }).series.spacing).toBe(0.1);
        expect(mergeConfig(base, { series: { spacing: 999 } }).series.spacing).toBe(10);
        expect(mergeConfig(base, { series: { spacing: 'x' } }).series.spacing).toBe(base.series.spacing);
    });

    it('trades: applies valid fields, drops malformed ones', () => {
        const base = baseConfig();
        expect(base.trades).toEqual({ visible: true, labels: true, qty: true, longColor: '#2962ff', shortColor: '#f23645', exitColor: '#d500f9' });
        const out = mergeConfig(base, { trades: { qty: false, exitColor: '#111111', visible: 'yes', longColor: 7 } });
        expect(out.trades.qty).toBe(false);
        expect(out.trades.exitColor).toBe('#111111');
        expect(out.trades.visible).toBe(base.trades.visible); // malformed → base
        expect(out.trades.longColor).toBe(base.trades.longColor);
        expect(out.trades.labels).toBe(base.trades.labels); // unnamed → base
    });

    it('merges the pane separator color and drops a malformed one', () => {
        const base = baseConfig();
        expect(mergeConfig(base, { panes: { separatorColor: '#abcdef' } }).panes.separatorColor).toBe('#abcdef');
        expect(mergeConfig(base, { panes: { separatorColor: 42 } }).panes.separatorColor).toBe(base.panes.separatorColor);
    });

    it('always pins the current version', () => {
        const base = baseConfig();
        expect(mergeConfig(base, { version: 999 }).version).toBe(CHART_CONFIG_VERSION);
    });

    it('merges stacking additively — named ids apply, unnamed ones keep their keys', () => {
        const base = baseConfig();
        base.stacking = { candles: 0, series: { 'ind-1': -1, 'ind-2': -2 } };
        const out = mergeConfig(base, { stacking: { candles: 3, series: { 'ind-2': 5, 'ind-3': 'junk' } } });
        expect(out.stacking).toEqual({ candles: 3, series: { 'ind-1': -1, 'ind-2': 5 } });
        expect(mergeConfig(base, {}).stacking).toEqual(base.stacking);
    });
});

describe('defaultChartStyle', () => {
    it('reproduces current rendering (inherit defaults, no borders, visible wicks)', () => {
        const s = defaultChartStyle();
        expect(s.fontSize).toBe(11);
        expect(s.gridVert).toEqual({ visible: true, color: null });
        expect(s.gridHorz).toEqual({ visible: true, color: null });
        // Axis border + pane separator inherit the theme border, so a light theme
        // resolves light chrome lines instead of the dark constants.
        expect(s.borderColor).toBeNull();
        expect(s.separatorColor).toBeNull();
        expect(s.crosshair).toEqual({ color: '#9aa0ad', width: 1, style: 'dashed', opacity: 0.4, labelBackground: '#595959' });
        expect(s.candle.borderVisible).toBe(false);
        expect(s.candle.wickVisible).toBe(true);
    });
});

describe('NativeRenderer.getConfig — defaults resolve to concrete values', () => {
    it('emits a complete, versioned document from the dark theme', () => {
        const cfg = new NativeRenderer().getConfig();
        expect(cfg.version).toBe(CHART_CONFIG_VERSION);
        expect(cfg.layout).toEqual({ background: '#151619', textColor: '#b2b5be', fontFamily: 'sans-serif', fontSize: 11 });
        expect(cfg.grid.vertLines).toEqual({ visible: true, color: '#20222c' });
        expect(cfg.grid.horzLines).toEqual({ visible: true, color: '#20222c' });
        expect(cfg.crosshair).toEqual({ color: '#9aa0ad', width: 1, style: 'dashed', opacity: 0.4, labelBackground: '#595959' });
        expect(cfg.priceScale).toEqual({ mode: 'price', log: false, invert: false, borderColor: '#2a2b30', labelsVisible: true, currentPriceLine: true, priceLabel: true, countdown: true });
        expect(cfg.panes).toEqual({ separatorColor: '#2a2b30' }); // inherits the theme border
        expect(cfg.timeScale).toEqual({ timezone: 'UTC' });
        expect(cfg.candles.upColor).toBe('#089981');
        expect(cfg.candles.downColor).toBe('#f23645');
        expect(cfg.candles.borderUpColor).toBe('#089981'); // inherits the body color
        expect(cfg.candles.wickDownColor).toBe('#f23645');
        expect(cfg.series).toEqual({ style: 'candles', baseline: null, spacing: 1 });
    });

    it('is fully JSON-serializable (round-trips through stringify/parse)', () => {
        const cfg = new NativeRenderer().getConfig();
        expect(JSON.parse(JSON.stringify(cfg))).toEqual(cfg);
    });
});

describe('NativeRenderer.applyConfig — applies + syncs the live scene fields', () => {
    it('applies a partial config and reflects it in getConfig', () => {
        const r = new NativeRenderer();
        r.applyConfig({
            candles: { upColor: '#00ff00', borderVisible: true, wickVisible: false },
            grid: { vertLines: { visible: false }, horzLines: { color: '#222222' } },
            crosshair: { color: '#ff0000', opacity: 0.7, width: 2 },
        });
        const cfg = r.getConfig();
        expect(cfg.candles.upColor).toBe('#00ff00');
        expect(cfg.candles.borderVisible).toBe(true);
        expect(cfg.candles.wickVisible).toBe(false);
        expect(cfg.grid.vertLines.visible).toBe(false);
        expect(cfg.grid.horzLines.color).toBe('#222222');
        expect(cfg.crosshair).toMatchObject({ color: '#ff0000', opacity: 0.7, width: 2 });
    });

    it('applies the series spacing multiplier and reflects it in getConfig (clamped)', () => {
        const r = new NativeRenderer();
        expect(r.getConfig().series.spacing).toBe(1);
        r.applyConfig({ series: { spacing: 2 } });
        expect(r.getConfig().series.spacing).toBe(2);
        r.applyConfig({ series: { spacing: 0 } }); // floored above 0
        expect(r.getConfig().series.spacing).toBe(0.1);
    });

    it('candle body is visible by default and can be toggled off via config', () => {
        const r = new NativeRenderer();
        expect(r.getConfig().candles.bodyVisible).toBe(true);
        r.applyConfig({ candles: { bodyVisible: false } });
        expect(r.getConfig().candles.bodyVisible).toBe(false);
    });

    it('syncs existing scene-level features (log/scaleMode/timezone/priceStyle/labels)', () => {
        const r = new NativeRenderer();
        r.applyConfig({
            priceScale: { log: true, mode: 'percent', labelsVisible: false, currentPriceLine: false },
            timeScale: { timezone: 'America/New_York' },
            series: { style: 'area' },
        });
        expect(r.readFeature('logScale')).toBe(true);
        expect(r.readFeature('scaleMode')).toBe('percent');
        expect(r.readFeature('axisLabels')).toBe(false);
        expect(r.readFeature('currentPriceLine')).toBe(false);
        expect(r.readFeature('timezone')).toBe('America/New_York');
        expect(r.readFeature('priceStyle')).toBe('area');
    });

    it('round-trips: applyConfig(getConfig()) is idempotent', () => {
        const r = new NativeRenderer();
        r.applyConfig({ candles: { upColor: '#abcdef' }, layout: { fontSize: 14 }, priceScale: { mode: 'percent' } });
        const a = r.getConfig();
        r.applyConfig(a);
        expect(r.getConfig()).toEqual(a);
    });

    it('updating the candle color via config also updates the upColor feature', () => {
        const r = new NativeRenderer();
        r.applyConfig({ candles: { upColor: '#101010', downColor: '#202020' } });
        expect(r.readFeature('upColor')).toBe('#101010');
        expect(r.readFeature('downColor')).toBe('#202020');
    });

    it('re-bases the derived inks when the background flips luminance class', () => {
        const r = new NativeRenderer();
        // Dark theme + a white background typed alone (no textColor in the patch):
        // the light-gray dark-theme text would be unreadable → light-theme inks apply.
        r.applyConfig({ layout: { background: '#ffffff' } });
        let cfg = r.getConfig();
        expect(cfg.layout.background).toBe('#ffffff');
        expect(cfg.layout.textColor).toBe('#1e293b'); // LIGHT_THEME ink
        expect(cfg.grid.vertLines.color).toBe('#cccccc'); // grid inherits the re-based theme
        expect(cfg.priceScale.borderColor).toBe('#d4dae3'); // axis border follows too
        expect(cfg.panes.separatorColor).toBe('#d4dae3');
        // …and flipping back to a dark background restores the dark inks.
        r.applyConfig({ layout: { background: '#151619' } });
        cfg = r.getConfig();
        expect(cfg.layout.textColor).toBe('#b2b5be');
        expect(cfg.grid.vertLines.color).toBe('#20222c');
    });

    it('an explicit textColor in the same patch wins over the ink re-base', () => {
        const r = new NativeRenderer();
        r.applyConfig({ layout: { background: '#ffffff', textColor: '#fafafa' } });
        expect(r.getConfig().layout.textColor).toBe('#fafafa'); // user's choice, even if low-contrast
    });

    it('does not re-base inks for a same-class background edit', () => {
        const r = new NativeRenderer();
        r.applyConfig({ layout: { background: '#000000' } }); // still dark
        expect(r.getConfig().layout.textColor).toBe('#b2b5be'); // untouched
    });

    it('restores the stacking keys — and pre-seeds an indicator that has not mounted yet', () => {
        const r = new NativeRenderer();
        r.applyConfig({ stacking: { candles: 2, series: { 'ind-1': 3 } } });
        const cfg = r.getConfig();
        expect(cfg.stacking.candles).toBe(2);
        expect(cfg.stacking.series['ind-1']).toBe(3); // held for the indicator's (later) mount
        expect(r.readFeature('candleZOrder')).toBe(2);
    });
});

describe('factoryResetConfig — "Reset defaults" restores chart-type SDK settings', () => {
    afterEach(() => unregisterChartType('sdktype'));

    function registerSdkType(): void {
        registerChartType({
            id: 'sdktype',
            settings: {
                title: 'SDK Type',
                rows: [
                    { kind: 'number', key: 'rows', label: 'Rows', defval: 10 },
                    { kind: 'toggle', key: 'shade', label: 'Shade', defval: true },
                ],
            },
        });
    }

    it('the factory snapshot alone cannot undo SDK settings (additive chartTypes merge)', () => {
        registerSdkType();
        const r = new NativeRenderer();
        const factory = r.getConfig();
        expect(factory.chartTypes).toEqual({}); // nothing stored until a value is edited
        r.applyConfig({ chartTypes: { sdktype: { rows: 25, shade: false } } });
        r.applyConfig(factory); // the raw snapshot names no type ids → values survive
        expect(r.getConfig().chartTypes.sdktype).toEqual({ rows: 25, shade: false });
    });

    it('names every registered type at its registry-declared row defaults', () => {
        registerSdkType();
        const r = new NativeRenderer();
        const factory = r.getConfig();
        r.applyConfig({ chartTypes: { sdktype: { rows: 25, shade: false } } });
        const pushed: Array<[string, Record<string, unknown>]> = [];
        r.onChartTypeSettingsChange((typeId, values) => pushed.push([typeId, values]));
        r.applyConfig(factoryResetConfig(factory));
        expect(r.getConfig().chartTypes.sdktype).toEqual({ rows: 10, shade: true });
        // the change is announced (settings channel + data engine), not just stored
        expect(pushed).toContainEqual(['sdktype', { rows: 10, shade: true }]);
    });

    it('keeps values the factory snapshot itself pinned (pre-mount edits win over defvals)', () => {
        registerSdkType();
        const r = new NativeRenderer();
        r.applyConfig({ chartTypes: { sdktype: { rows: 40 } } });
        const factory = r.getConfig(); // snapshot taken AFTER a value was stored
        r.applyConfig({ chartTypes: { sdktype: { rows: 99, shade: false } } });
        r.applyConfig(factoryResetConfig(factory));
        expect(r.getConfig().chartTypes.sdktype).toEqual({ rows: 40, shade: true });
    });

    it('covers a type registered after the snapshot was taken', () => {
        const r = new NativeRenderer();
        const factory = r.getConfig(); // 'sdktype' not registered yet
        registerSdkType();
        r.applyConfig({ chartTypes: { sdktype: { rows: 25 } } });
        r.applyConfig(factoryResetConfig(factory)); // registry is read at reset time
        expect(r.getConfig().chartTypes.sdktype).toEqual({ rows: 10, shade: true });
    });

    it('covers structured sections: instances, subsections, ranges, and toggle swatches', () => {
        registerChartType({
            id: 'sdktype',
            settings: {
                title: 'SDK Type',
                instances: [
                    { label: 'One', rows: [{ kind: 'number', key: 'size', label: 'Size', defval: 5 }] },
                    {
                        label: 'Two',
                        enableKey: 'twoEnabled',
                        rows: [
                            { kind: 'toggle', key: 'shade', label: 'Shade', defval: false, colors: [{ key: 'shadeColor', label: 'Shade color', defval: '#111111' }] },
                            { kind: 'range', label: 'Filter', minKey: 'filterMin', maxKey: 'filterMax', defval: 0 },
                        ],
                    },
                ],
                subsections: [
                    {
                        title: 'Extra',
                        enableKey: 'extraOn',
                        rows: [
                            { kind: 'toggle', key: 'extraOn', label: 'Extra', defval: true },
                            { kind: 'heading', label: 'Group' },
                            { kind: 'select', key: 'flavor', label: 'Flavor', options: ['a', 'b'], defval: 'a' },
                        ],
                    },
                ],
            },
        });
        const r = new NativeRenderer();
        const factory = r.getConfig();
        r.applyConfig({ chartTypes: { sdktype: { size: 9, twoEnabled: true, shade: true, shadeColor: '#ff0000', filterMin: 3, filterMax: 8, extraOn: false, flavor: 'b' } } });
        r.applyConfig(factoryResetConfig(factory));
        expect(r.getConfig().chartTypes.sdktype).toEqual({
            size: 5,
            twoEnabled: false, // enable key without a row — instance presence resets to off
            shade: false,
            shadeColor: '#111111',
            filterMin: 0,
            filterMax: 0,
            extraOn: true, // enable key WITH a row — the row's defval wins over the off seed
            flavor: 'a',
        });
    });

    it('covers a toggle row\'s inline number/width keys and composite `row` controls', () => {
        registerChartType({
            id: 'sdktype',
            settings: {
                title: 'SDK Type',
                rows: [
                    { kind: 'toggle', key: 'poc', label: 'POC', defval: true,
                        number: { key: 'pocPct', label: 'Percent', defval: 70 },
                        width: { key: 'pocWidth', label: 'Line width', defval: 2 } },
                    { kind: 'row', label: 'Mixed', toggle: { key: 'mixOn', defval: false },
                        controls: [
                            { kind: 'select', key: 'mixMode', label: 'Mode', options: ['a', 'b'], defval: 'a' },
                            { kind: 'color', key: 'mixInk', label: 'Ink', defval: '#111111' },
                        ] },
                ],
            },
        });
        const r = new NativeRenderer();
        const factory = r.getConfig();
        r.applyConfig({ chartTypes: { sdktype: { poc: false, pocPct: 40, pocWidth: 5, mixOn: true, mixMode: 'b', mixInk: '#ff0000' } } });
        r.applyConfig(factoryResetConfig(factory));
        expect(r.getConfig().chartTypes.sdktype).toEqual({
            poc: true,
            pocPct: 70,
            pocWidth: 2,
            mixOn: false,
            mixMode: 'a',
            mixInk: '#111111',
        });
    });
});

describe('per-price-style colors — each style is independent (item 15)', () => {
    it('getConfig resolves each style to concrete colors (default = the candle palette)', () => {
        const cfg = new NativeRenderer().getConfig();
        // untouched styles default to the chart up/down so rendering is unchanged…
        expect(cfg.bars).toEqual({ upColor: '#089981', downColor: '#f23645' });
        expect(cfg.line).toEqual({ color: '#3b82f6', width: 2 });
        expect(cfg.area).toEqual({ lineColor: '#3b82f6', width: 2, topColor: 'rgba(59,130,246,0.28)', bottomColor: 'rgba(59,130,246,0.02)' });
        // baseline owns its palette (independent of the candle colors); each area is a
        // two-stop wash of the line color — stronger near the line, fainter at the baseline.
        expect(cfg.baseline).toEqual({
            topLineColor: '#089981',
            bottomLineColor: '#f23645',
            topFillColor: 'rgba(8,153,129,0.25)',
            topFillColor2: 'rgba(8,153,129,0.05)',
            bottomFillColor: 'rgba(242,54,69,0.25)',
            bottomFillColor2: 'rgba(242,54,69,0.05)',
            width: 2,
            baselineLevel: 50,
        });
    });

    it('styling one chart type does NOT bleed into the others or the candles', () => {
        const r = new NativeRenderer();
        r.applyConfig({ line: { color: '#ff00ff', width: 4 } });
        const cfg = r.getConfig();
        expect(cfg.line).toEqual({ color: '#ff00ff', width: 4 });
        // candles + every other style keep their own (default) colors
        expect(cfg.candles.upColor).toBe('#089981');
        expect(cfg.bars.upColor).toBe('#089981');
        expect(cfg.area.lineColor).toBe('#3b82f6'); // area keeps its own brand default
        expect(cfg.baseline.topLineColor).toBe('#089981'); // baseline keeps its own default palette
    });

    it('changing the candle body color leaves an explicitly-set style color alone', () => {
        const r = new NativeRenderer();
        r.applyConfig({ bars: { upColor: '#aabbcc' }, candles: { upColor: '#111111' } });
        const cfg = r.getConfig();
        expect(cfg.bars.upColor).toBe('#aabbcc'); // independent, not following the candle color
        expect(cfg.candles.upColor).toBe('#111111');
    });

    it('merges per-style fields and ignores malformed ones; widths clamp to 1–10', () => {
        const base = new NativeRenderer().getConfig();
        const out = mergeConfig(base, {
            area: { lineColor: '#010203', topColor: 7, width: 99 },
            baseline: { topLineColor: '#040506', width: -3 },
        });
        expect(out.area.lineColor).toBe('#010203');
        expect(out.area.topColor).toBe(base.area.topColor); // malformed (number) dropped
        expect(out.area.width).toBe(10); // clamped
        expect(out.baseline.topLineColor).toBe('#040506');
        expect(out.baseline.width).toBe(1); // clamped
    });

    it('accepts rgba fill colors (templating supports alpha the picker cannot)', () => {
        const r = new NativeRenderer();
        r.applyConfig({ area: { topColor: 'rgba(13,152,198,0.35)', bottomColor: 'rgba(13,152,198,0)' } });
        const cfg = r.getConfig();
        expect(cfg.area.topColor).toBe('rgba(13,152,198,0.35)');
        expect(cfg.area.bottomColor).toBe('rgba(13,152,198,0)');
    });

    it('keeps the second baseline fill stops and clamps the base level to 0–100', () => {
        const r = new NativeRenderer();
        r.applyConfig({ baseline: { topFillColor2: 'rgba(1,2,3,0.4)', bottomFillColor2: 'rgba(4,5,6,0.4)', baselineLevel: 250 } });
        const cfg = r.getConfig();
        expect(cfg.baseline.topFillColor2).toBe('rgba(1,2,3,0.4)');
        expect(cfg.baseline.bottomFillColor2).toBe('rgba(4,5,6,0.4)');
        expect(cfg.baseline.baselineLevel).toBe(100); // clamped
        r.applyConfig({ baseline: { baselineLevel: -10 } });
        expect(r.getConfig().baseline.baselineLevel).toBe(0); // clamped
    });
});

describe('NativeRenderer settings feature (item 15)', () => {
    it('exposes the settings feature, default off, and is settable', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('settings');
        expect(r.readFeature('settings')).toBe(false);
        r.applyFeature('settings', true);
        expect(r.readFeature('settings')).toBe(true);
    });
});
