// The chart-type SDK registry (src/chart-types) — registration semantics, the dynamic
// extended-ticker modifiers, and the dynamic price-style id list the renderer validates
// against. Heikin Ashi is registered through the SAME public API (builtins.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { registerChartType, unregisterChartType, chartType, chartTypes, tickerModifierIds, settingsRowVisible, normalizeSettingsRow, settingsRowValueKeys, type SettingsRowDescriptor } from '../src/chart-types/registry';
import { basePaintingOf } from '../src/renderers/native/core/chartConfig';
import { registerBuiltinChartTypes } from '../src/chart-types/builtins';
import { barTransformFor, parseExtendedTicker } from '../src/core/price-styles/BarTransform';
import { priceStyleIds } from '../src/renderers/native/core/chartConfig';
import { heikinAshiFull } from '../src/core/price-styles/heikin-ashi';
import type { OHLCV } from '../src/core/model/ohlcv';

registerBuiltinChartTypes(); // normally done by the Vela constructor

const identity = { full: (r: readonly OHLCV[]) => [...r], next: (r: OHLCV) => r };

afterEach(() => {
    unregisterChartType('renko-like');
    registerBuiltinChartTypes(); // restore in case a test replaced a built-in
});

describe('chart-type registry', () => {
    it('heikinashi is registered through the public registry and resolves its transform', () => {
        expect(chartType('heikinashi')?.label).toBe('Heikin Ashi');
        const t = barTransformFor('heikinashi')!;
        const raw: OHLCV[] = [
            { time: 0, open: 10, high: 12, low: 9, close: 11 },
            { time: 1, open: 11, high: 13, low: 10, close: 12 },
        ];
        expect(t.full(raw)).toEqual(heikinAshiFull(raw));
        expect(barTransformFor('heikinashi')).toBe(t); // singleton — identity-comparable
    });

    it('registration is id-keyed (last wins) and unregister removes it', () => {
        registerChartType({ id: 'renko-like', barTransform: identity });
        expect(chartType('renko-like')).toBeDefined();
        expect(chartTypes().some((d) => d.id === 'renko-like')).toBe(true);
        unregisterChartType('renko-like');
        expect(chartType('renko-like')).toBeUndefined();
        expect(barTransformFor('renko-like')).toBeNull();
    });

    it('ticker modifiers are dynamic: a transform type participates by default, an engine-only type does not', () => {
        expect(tickerModifierIds()).toContain('heikinashi');
        registerChartType({ id: 'renko-like', dataEngine: () => ({ start() {}, suspend() {}, resume() {}, stop() {} }) });
        expect(tickerModifierIds()).not.toContain('renko-like');

        registerChartType({ id: 'renko-like', barTransform: identity });
        expect(tickerModifierIds()).toContain('renko-like');
        expect(parseExtendedTicker('BTCUSDT;renko-like').modifier).toBe('renko-like');
        unregisterChartType('renko-like');
        // Unknown modifiers stay part of the symbol — never mangled.
        expect(parseExtendedTicker('BTCUSDT;renko-like')).toEqual({ symbol: 'BTCUSDT;renko-like', modifier: null, transform: null });
        expect(parseExtendedTicker('BTCUSDT;heikinashi').modifier).toBe('heikinashi');
        expect(parseExtendedTicker('SYM;standard').modifier).toBe('standard');
    });

    it('priceStyleIds() = built-ins + registered types; the settings/validation layers read it live', () => {
        const base = priceStyleIds();
        expect(base).toEqual(['candles', 'bars', 'line', 'area', 'baseline', 'heikinashi']);
        registerChartType({ id: 'renko-like', barTransform: identity });
        expect(priceStyleIds()).toContain('renko-like');
        unregisterChartType('renko-like');
        expect(priceStyleIds()).not.toContain('renko-like');
    });
});

describe('structured settings sections (instances + subsections)', () => {
    it('a section may declare an instance strip, subsections, and rail placement', () => {
        registerChartType({
            id: 'renko-like',
            settings: {
                title: 'Renko-like',
                placement: 'after-symbol',
                instances: [
                    { label: 'Block 1', rows: [{ kind: 'heading', label: 'Display' }, { kind: 'number', key: 'size', label: 'Size', defval: 4 }] },
                    { label: 'Block 2', enableKey: 'b2Enabled', rows: [{ kind: 'number', key: 'b2Size', label: 'Size', defval: 4 }] },
                ],
                subsections: [
                    { title: 'Overlay', rows: [{ kind: 'toggle', key: 'overlay', label: 'Show overlay', defval: false }] },
                ],
            },
        });
        const def = chartType('renko-like')!;
        expect(def.settings?.placement).toBe('after-symbol');
        expect(def.settings?.instances?.[1]?.enableKey).toBe('b2Enabled');
        expect(def.settings?.subsections?.[0]?.title).toBe('Overlay');
        unregisterChartType('renko-like');
    });

    it('toggle rows may carry inline swatches; range rows edit a min–max pair', () => {
        registerChartType({
            id: 'renko-like',
            settings: {
                title: 'Renko-like',
                rows: [
                    { kind: 'toggle', key: 'hl', label: 'Highlights', defval: false, colors: [
                        { key: 'hlAskColor', label: 'Ask color', defval: '#e0b400' },
                        { key: 'hlBidColor', label: 'Bid color', defval: '#e0b400' },
                    ] },
                    { kind: 'range', label: 'Volume', minKey: 'minVolume', maxKey: 'maxVolume', defval: 0, min: 0, max: 1e9, step: 1, placeholder: 'Off' },
                ],
            },
        });
        const rows = chartType('renko-like')!.settings!.rows!;
        const toggle = rows[0]!;
        const range = rows[1]!;
        expect(toggle.kind === 'toggle' && toggle.colors?.[1]?.key).toBe('hlBidColor');
        expect(range.kind === 'range' && range.placeholder).toBe('Off');
        unregisterChartType('renko-like');
    });
});

describe('composite settings rows (normalizeSettingsRow / settingsRowValueKeys)', () => {
    it('the sugar kinds reduce to the canonical composite shape', () => {
        expect(normalizeSettingsRow({ kind: 'number', key: 'n', label: 'N', defval: 3, min: 1, max: 9 })).toEqual({
            label: 'N',
            controls: [{ kind: 'number', key: 'n', label: 'N', defval: 3, min: 1, max: 9, step: undefined }],
            when: undefined,
        });
        expect(normalizeSettingsRow({ kind: 'color', key: 'c', label: 'C', defval: '#123456' }).controls)
            .toEqual([{ kind: 'color', key: 'c', label: 'C', defval: '#123456' }]);
        expect(normalizeSettingsRow({ kind: 'select', key: 's', label: 'S', options: ['a', 'b'], defval: 'a' }).controls)
            .toEqual([{ kind: 'select', key: 's', label: 'S', options: ['a', 'b'], defval: 'a' }]);
    });

    it('a toggle with attachments keeps the historical number → colors → width order', () => {
        const n = normalizeSettingsRow({
            kind: 'toggle', key: 'on', label: 'Line', defval: true,
            number: { key: 'pct', label: 'Percent', defval: 70 },
            colors: [{ key: 'ink', label: 'Ink', defval: '#fff' }],
            width: { key: 'w', label: 'Width', defval: 2 },
        });
        expect(n.toggle).toEqual({ key: 'on', defval: true });
        expect(n.controls.map((c) => c.kind)).toEqual(['number', 'color', 'width']);
    });

    it('a range becomes two placeholder-preserving number controls around a hint', () => {
        const n = normalizeSettingsRow({ kind: 'range', label: 'Volume', minKey: 'lo', maxKey: 'hi', defval: 0, placeholder: 'Off' });
        expect(n.controls.map((c) => c.kind)).toEqual(['number', 'hint', 'number']);
        const lo = n.controls[0]!;
        expect(lo.kind === 'number' && lo.key).toBe('lo');
        expect(lo.kind === 'number' && lo.placeholder).toBe('Off');
    });

    it('the composite `row` kind passes through unchanged', () => {
        const row: SettingsRowDescriptor = {
            kind: 'row', label: 'Mixed', toggle: { key: 'on', defval: false },
            controls: [
                { kind: 'select', key: 'mode', label: 'Mode', options: ['a', 'b'], defval: 'a' },
                { kind: 'number', key: 'n', label: 'N', defval: 1 },
                { kind: 'color', key: 'c', label: 'C', defval: '#000' },
            ],
        };
        const n = normalizeSettingsRow(row);
        expect(n.toggle?.key).toBe('on');
        expect(n.controls.map((c) => c.kind)).toEqual(['select', 'number', 'color']);
    });

    it('settingsRowValueKeys enumerates every stored key with type and default', () => {
        expect(settingsRowValueKeys({ kind: 'heading', label: 'G' })).toEqual([]);
        expect(settingsRowValueKeys({
            kind: 'toggle', key: 'on', label: 'Line', defval: true,
            number: { key: 'pct', label: 'Percent', defval: 70 },
            colors: [{ key: 'ink', label: 'Ink', defval: '#fff' }],
            width: { key: 'w', label: 'Width', defval: 2 },
        })).toEqual([
            { key: 'on', type: 'boolean', defval: true },
            { key: 'pct', type: 'number', defval: 70 },
            { key: 'ink', type: 'string', defval: '#fff' },
            { key: 'w', type: 'number', defval: 2 },
        ]);
        expect(settingsRowValueKeys({ kind: 'range', label: 'V', minKey: 'lo', maxKey: 'hi', defval: 0 }).map((k) => k.key))
            .toEqual(['lo', 'hi']);
        expect(settingsRowValueKeys({
            kind: 'row', label: 'Mixed', toggle: { key: 'on', defval: false },
            controls: [
                { kind: 'select', key: 'mode', label: 'Mode', options: ['a'], defval: 'a' },
                { kind: 'hint', text: '–' },
                { kind: 'width', key: 'w', label: 'W', defval: 1 },
            ],
        })).toEqual([
            { key: 'on', type: 'boolean', defval: false },
            { key: 'mode', type: 'string', defval: 'a' },
            { key: 'w', type: 'number', defval: 1 },
        ]);
    });
});

describe('settings row `when` conditions (settingsRowVisible)', () => {
    it('no gate is always visible', () => {
        expect(settingsRowVisible(undefined, {})).toBe(true);
    });

    it('equals matches the bag value strictly', () => {
        expect(settingsRowVisible({ key: 'mode', equals: 'volume' }, { mode: 'volume' })).toBe(true);
        expect(settingsRowVisible({ key: 'mode', equals: 'volume' }, { mode: 'delta' })).toBe(false);
        expect(settingsRowVisible({ key: 'on', equals: true }, { on: false })).toBe(false);
        expect(settingsRowVisible({ key: 'on', equals: true }, {})).toBe(false); // unset never matches
    });

    it('anyOf wins over equals and matches membership', () => {
        const when = { key: 'mode', equals: 'x', anyOf: ['delta', 'deltaAbs'] } as const;
        expect(settingsRowVisible(when, { mode: 'delta' })).toBe(true);
        expect(settingsRowVisible(when, { mode: 'x' })).toBe(false);
    });

    it('an array of conditions ANDs them', () => {
        const when = [{ key: 'mode', equals: 'volume' }, { key: 'dual', equals: false }] as const;
        expect(settingsRowVisible(when, { mode: 'volume', dual: false })).toBe(true);
        expect(settingsRowVisible(when, { mode: 'volume', dual: true })).toBe(false);
        expect(settingsRowVisible(when, { mode: 'delta', dual: false })).toBe(false);
    });
});

describe('basePainting (plugin styles replacing the price series)', () => {
    it("defaults to 'candles' for built-ins and undeclared plugin types, honors 'none'", () => {
        expect(basePaintingOf('candles')).toBe('candles');
        registerChartType({ id: 'bp-default' });
        registerChartType({ id: 'bp-none', basePainting: 'none' });
        expect(basePaintingOf('bp-default')).toBe('candles');
        expect(basePaintingOf('bp-none')).toBe('none');
        unregisterChartType('bp-default');
        unregisterChartType('bp-none');
        expect(basePaintingOf('bp-none')).toBe('candles'); // unregistered -> default
    });
});
