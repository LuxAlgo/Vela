// The settings-dialog visibility policy (src/renderers/native/chrome/settings-visibility)
// — id derivation, subtree hiding, descriptor filtering, and the discovery catalog.
import { describe, it, expect, afterEach } from 'vitest';
import {
    BUILTIN_SETTINGS_IDS,
    filterHiddenHostRows,
    filterHiddenRows,
    hostRowId,
    hostSectionId,
    settingsIdCatalog,
    settingsIdHidden,
    settingsIdSlug,
    settingsRowId,
} from '../src/renderers/native/chrome/settings-visibility';
import { registerChartType, unregisterChartType, type SettingsRowDescriptor } from '../src/chart-types/registry';

afterEach(() => {
    unregisterChartType('viz-test');
});

describe('settingsIdSlug', () => {
    it('kebab-cases display labels', () => {
        expect(settingsIdSlug('Bars to fetch')).toBe('bars-to-fetch');
        expect(settingsIdSlug('Pre-market')).toBe('pre-market');
        expect(settingsIdSlug('  Base level % ')).toBe('base-level');
        expect(settingsIdSlug('OHLC values')).toBe('ohlc-values');
    });
});

describe('settingsIdHidden', () => {
    it('matches exact ids and dot-path ancestors (subtree semantics)', () => {
        const hidden = new Set(['advanced', 'canvas.grid', 'type:vp']);
        expect(settingsIdHidden('advanced', hidden)).toBe(true);
        expect(settingsIdHidden('advanced.bars', hidden)).toBe(true);
        expect(settingsIdHidden('canvas.grid.vertical', hidden)).toBe(true);
        expect(settingsIdHidden('canvas.background', hidden)).toBe(false);
        expect(settingsIdHidden('type:vp.levels', hidden)).toBe(true);
    });

    it('never matches by string prefix alone', () => {
        const hidden = new Set(['canvas']);
        expect(settingsIdHidden('canvas-extra', hidden)).toBe(false);
        expect(settingsIdHidden('canvas.grid', hidden)).toBe(true);
    });

    it('is a no-op on an empty policy', () => {
        expect(settingsIdHidden('anything', new Set())).toBe(false);
    });
});

describe('settingsRowId', () => {
    it('uses the stable bag key of value rows and the label slug of titles', () => {
        expect(settingsRowId({ kind: 'toggle', key: 'highlights', label: 'Highlights', defval: true })).toBe('highlights');
        expect(settingsRowId({ kind: 'number', key: 'levels', label: 'Max levels', defval: 20 })).toBe('levels');
        expect(settingsRowId({ kind: 'range', label: 'Volume', minKey: 'minVol', maxKey: 'maxVol', defval: 0 })).toBe('minVol');
        expect(settingsRowId({ kind: 'heading', label: 'My Group' })).toBe('my-group');
        expect(settingsRowId({
            kind: 'row',
            label: 'Imbalance',
            toggle: { key: 'imb', defval: false },
            controls: [{ kind: 'select', key: 'imbMode', label: 'Mode', options: ['a'], defval: 'a' }],
        })).toBe('imb');
    });
});

describe('filterHiddenRows', () => {
    const rows: readonly SettingsRowDescriptor[] = [
        { kind: 'heading', label: 'Levels' },
        { kind: 'toggle', key: 'highlights', label: 'Highlights', defval: true },
        { kind: 'header', label: 'Colors' },
        { kind: 'color', key: 'buyColor', label: 'Buy color', defval: '#fff' },
        { kind: 'heading', label: 'Display' },
        { kind: 'select', key: 'mode', label: 'Mode', options: ['a', 'b'], defval: 'a' },
    ];

    it('keeps everything under an empty policy', () => {
        expect(filterHiddenRows(rows, 'type:t', new Set())).toEqual([...rows]);
    });

    it('drops a single row by its key id', () => {
        const out = filterHiddenRows(rows, 'type:t', new Set(['type:t.buyColor']));
        expect(out.map((r) => r.kind)).toEqual(['heading', 'toggle', 'header', 'heading', 'select']);
    });

    it('a hidden heading takes its whole group, a hidden header its subgroup', () => {
        const group = filterHiddenRows(rows, 'type:t', new Set(['type:t.levels']));
        expect(group).toEqual(rows.slice(4)); // Display group only
        const sub = filterHiddenRows(rows, 'type:t', new Set(['type:t.colors']));
        expect(sub.map((r) => r.kind)).toEqual(['heading', 'toggle', 'heading', 'select']);
    });

    it('hiding the whole scope empties the section', () => {
        expect(filterHiddenRows(rows, 'type:t', new Set(['type:t']))).toEqual([]);
    });
});

describe('host section/row ids and filtering', () => {
    const section = {
        title: 'Status line',
        id: 'status-line',
        rows: [
            { kind: 'heading', label: 'Status line', id: 'parts' },
            { kind: 'toggle', label: 'Symbol name', id: 'name' },
            { kind: 'heading', label: 'Indicators', id: 'indicators' },
            { kind: 'toggle', label: 'Titles', id: 'indicator-titles' },
            { kind: 'toggle', label: 'Values', id: 'indicator-values' },
        ],
    };

    it('explicit ids win, label slugs are the fallback', () => {
        expect(hostSectionId(section)).toBe('status-line');
        expect(hostSectionId({ title: 'My Panel', rows: [] })).toBe('my-panel');
        expect(hostRowId({ kind: 'toggle', label: 'Bars to fetch' })).toBe('bars-to-fetch');
    });

    it('hides one row, and a heading with its group', () => {
        const one = filterHiddenHostRows(section.rows, 'status-line', new Set(['status-line.name']));
        expect(one.map((r) => r.id)).toEqual(['parts', 'indicators', 'indicator-titles', 'indicator-values']);
        const group = filterHiddenHostRows(section.rows, 'status-line', new Set(['status-line.indicators']));
        expect(group.map((r) => r.id)).toEqual(['parts', 'name']);
    });
});

describe('settingsIdCatalog', () => {
    it('lists the built-ins, host sections, and registered chart-type sections', () => {
        registerChartType({
            id: 'viz-test',
            settings: {
                title: 'Viz Test',
                rows: [
                    { kind: 'heading', label: 'Levels' },
                    { kind: 'number', key: 'levels', label: 'Max levels', defval: 20 },
                ],
                subsections: [
                    { title: 'Overlay', rows: [{ kind: 'toggle', key: 'ovl', label: 'Overlay', defval: false }] },
                ],
            },
        });
        const ids = settingsIdCatalog([
            { title: 'Advanced', id: 'advanced', rows: [{ kind: 'select', label: 'Bars to fetch', id: 'bars' }] },
        ]);
        for (const builtin of BUILTIN_SETTINGS_IDS) expect(ids).toContain(builtin);
        expect(ids).toContain('type:viz-test');
        expect(ids).toContain('type:viz-test.levels');
        expect(ids).toContain('type:viz-test.overlay');
        expect(ids).toContain('type:viz-test.ovl');
        expect(ids).toContain('advanced');
        expect(ids).toContain('advanced.bars');
    });

    it('built-in ids are unique and rows nest under their tab', () => {
        expect(new Set(BUILTIN_SETTINGS_IDS).size).toBe(BUILTIN_SETTINGS_IDS.length);
        const tabs = ['symbol', 'scales', 'canvas'];
        for (const id of BUILTIN_SETTINGS_IDS) {
            expect(tabs.some((t) => id === t || id.startsWith(`${t}.`))).toBe(true);
        }
    });
});
