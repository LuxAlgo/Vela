// The workspace's pure modules: the layout registry/grid math and the splitter track
// math (src/workspace/layouts.ts, splitters.ts). DOM-free — node env; the VelaWorkspace
// shell itself is verified in the browser (playground probes).
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    registerBuiltinLayouts,
    registerLayout,
    unregisterLayout,
    layoutDefinition,
    layouts,
    gridStyles,
    activeAfterLayout,
    orderAfterLayout,
    layoutForGrid,
    ensureLayout,
    layoutShape,
    occupancyGrid,
    type LayoutDefinition,
} from '../src/workspace/layouts';
import { evenTracks, resizeTracks, trackOffsets, seamSegments, segmentSpanPx } from '../src/workspace/splitters';
import { seedDefaults, cellChartDefaults, cellDrawings } from '../src/workspace/ChartCell';
import { declaredOrder, nextAutoCellId, resolveTyping } from '../src/workspace/VelaWorkspace';
import { parseSymbol } from '../src/data/ProviderRegistry';

registerBuiltinLayouts();

afterEach(() => {
    unregisterLayout('custom-16');
    unregisterLayout('one-plus-two');
});

describe('layout registry + presets', () => {
    it('ships the decided v1 presets with canonical slot ids c1..cN', () => {
        expect(layouts().map((l) => l.id)).toEqual(expect.arrayContaining(['1', '2h', '2v', '4', '8']));
        expect(layoutDefinition('4')!.cells.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
        expect(layoutDefinition('8')!.cells.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
        // Slot ids are SHARED across layouts — the pool restores by id on 4 → 2 → 4.
        expect(layoutDefinition('2h')!.cells.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('registerLayout is the SDK seam: adds, lists, last-wins, unregisters', () => {
        const grid16: LayoutDefinition = {
            id: 'custom-16',
            label: '16 grid',
            cols: [1, 1, 1, 1],
            rows: [1, 1, 1, 1],
            cells: Array.from({ length: 16 }, (_, i) => ({ id: `c${i + 1}` })),
        };
        registerLayout(grid16);
        expect(layoutDefinition('custom-16')).toBe(grid16);
        expect(layouts().some((l) => l.id === 'custom-16')).toBe(true);
        const replaced = { ...grid16, label: 'Sixteen' };
        registerLayout(replaced);
        expect(layoutDefinition('custom-16')!.label).toBe('Sixteen'); // last registration wins
        unregisterLayout('custom-16');
        expect(layoutDefinition('custom-16')).toBeUndefined();
    });
});

describe('dynamic picker layouts (pure)', () => {
    it('layoutForGrid lands on the classic presets when the geometry matches', () => {
        expect(layoutForGrid(1, 1).id).toBe('1');
        expect(layoutForGrid(1, 2).id).toBe('2h');
        expect(layoutForGrid(2, 1).id).toBe('2v');
        expect(layoutForGrid(2, 2).id).toBe('4');
        expect(layoutForGrid(2, 4).id).toBe('8');
    });

    it('layoutForGrid synthesizes other geometries WITHOUT registering them', () => {
        const def = layoutForGrid(3, 2);
        expect(def.id).toBe('g3x2');
        expect(def.rows).toEqual([1, 1, 1]);
        expect(def.cols).toEqual([1, 1]);
        expect(def.areas).toBeUndefined();
        expect(def.cells.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
        expect(layoutDefinition('g3x2')).toBeUndefined(); // the registry stays presets-only
    });

    it('layoutForGrid clamps to the picker canvas (1..4 per axis)', () => {
        expect(layoutForGrid(9, 0).id).toBe('g4x1');
        expect(layoutForGrid(4, 4).cells).toHaveLength(16);
    });

    it('ensureLayout: registered ids win; dynamic ids re-synthesize; junk stays undefined', () => {
        expect(ensureLayout('4')).toBe(layoutDefinition('4'));
        expect(ensureLayout('g3x3')?.cells).toHaveLength(9);
        expect(ensureLayout('g5x5')).toBeUndefined(); // beyond the canvas — not a picker id
        expect(ensureLayout('nope')).toBeUndefined();
    });

    it('layoutShape reads grids back; bespoke areas stay null', () => {
        expect(layoutShape(layoutDefinition('1')!)).toEqual({ rows: 1, cols: 1 });
        expect(layoutShape(layoutDefinition('8')!)).toEqual({ rows: 2, cols: 4 });
        expect(layoutShape(layoutForGrid(3, 2))).toEqual({ rows: 3, cols: 2 });
        expect(
            layoutShape({
                id: 'bespoke',
                label: 'Bespoke',
                cols: [2, 1],
                rows: [1, 1],
                areas: ['main a', 'main b'],
                cells: [{ id: 'c1', area: 'main' }, { id: 'c2', area: 'a' }, { id: 'c3', area: 'b' }],
            }),
        ).toBeNull();
    });
});

describe('gridStyles (pure)', () => {
    it('maps track weights to fr templates', () => {
        const { container } = gridStyles(layoutDefinition('4')!);
        expect(container.gridTemplateColumns).toBe('1fr 1fr');
        expect(container.gridTemplateRows).toBe('1fr 1fr');
        expect(container.gridTemplateAreas).toBeUndefined();
        const two = gridStyles(layoutDefinition('2h')!).container;
        expect(two.gridTemplateColumns).toBe('1fr 1fr');
        expect(two.gridTemplateRows).toBe('1fr');
    });

    it('honors trackSizes overrides only when the length matches', () => {
        const def = layoutDefinition('4')!;
        expect(gridStyles(def, { cols: [2, 1] }).container.gridTemplateColumns).toBe('2fr 1fr');
        expect(gridStyles(def, { cols: [2, 1, 1] }).container.gridTemplateColumns).toBe('1fr 1fr'); // stale sizes ignored
    });

    it('asymmetric layouts: areas template + per-cell gridArea', () => {
        registerLayout({
            id: 'one-plus-two',
            label: '1 + 2',
            cols: [2, 1],
            rows: [1, 1],
            areas: ['main a', 'main b'],
            cells: [{ id: 'c1', area: 'main' }, { id: 'c2', area: 'a' }, { id: 'c3', area: 'b' }],
        });
        const { container, perCell } = gridStyles(layoutDefinition('one-plus-two')!);
        expect(container.gridTemplateAreas).toBe('"main a" "main b"');
        expect(perCell.c1).toEqual({ gridArea: 'main' });
        expect(perCell.c3).toEqual({ gridArea: 'b' });
    });
});

describe('activeAfterLayout (pure reducer)', () => {
    it('keeps a surviving active slot, falls back to the first, null when empty', () => {
        expect(activeAfterLayout('c3', ['c1', 'c2', 'c3', 'c4'])).toBe('c3');
        expect(activeAfterLayout('c3', ['c1', 'c2'])).toBe('c1'); // its slot left with the layout
        expect(activeAfterLayout(null, ['c1', 'c2'])).toBe('c1');
        expect(activeAfterLayout('c1', [])).toBe(null);
    });
});

describe('orderAfterLayout (pure reducer)', () => {
    it('moves an active identity that would pool into the last surviving slot', () => {
        // 2×2 → single: the active chart becomes the one remaining chart.
        expect(orderAfterLayout(['a', 'b', 'c', 'd'], 1, 'c')).toEqual(['c', 'a', 'b', 'd']);
        // 2×2 → 2 side by side: the first chart keeps its slot, active takes the second.
        expect(orderAfterLayout(['a', 'b', 'c', 'd'], 2, 'd')).toEqual(['a', 'd', 'b', 'c']);
    });

    it('leaves the order alone when the active chart already survives (or is unknown)', () => {
        expect(orderAfterLayout(['a', 'b', 'c', 'd'], 2, 'b')).toEqual(['a', 'b', 'c', 'd']);
        expect(orderAfterLayout(['a', 'b', 'c', 'd'], 8, 'd')).toEqual(['a', 'b', 'c', 'd']);
        expect(orderAfterLayout(['a', 'b'], 1, null)).toEqual(['a', 'b']);
        expect(orderAfterLayout(['a', 'b'], 1, 'nope')).toEqual(['a', 'b']);
        expect(orderAfterLayout(['a', 'b'], 0, 'b')).toEqual(['a', 'b']);
    });
});

describe('splitter track math (pure)', () => {
    it('evenTracks resets to a uniform split', () => {
        expect(evenTracks(3)).toEqual([1, 1, 1]);
    });

    it('resizeTracks trades weight between the two neighbors, sum preserved', () => {
        const next = resizeTracks([1, 1], 0, 200, 800); // +25% of the content to track 0
        expect(next[0]! + next[1]!).toBeCloseTo(2);
        expect(next[0]!).toBeCloseTo(1.5);
        expect(next[1]!).toBeCloseTo(0.5);
        // Other tracks untouched.
        const four = resizeTracks([1, 1, 1, 1], 1, 100, 400);
        expect(four[0]).toBe(1);
        expect(four[3]).toBe(1);
        expect(four[1]! + four[2]!).toBeCloseTo(2);
    });

    it('clamps so neither neighbor drops under 10% of the total', () => {
        const shrunk = resizeTracks([1, 1], 0, -10_000, 800);
        expect(shrunk[0]!).toBeCloseTo(0.2); // 10% of total (2)
        expect(shrunk[1]!).toBeCloseTo(1.8);
        const grown = resizeTracks([1, 1], 0, 10_000, 800);
        expect(grown[1]!).toBeCloseTo(0.2);
    });

    it('trackOffsets returns internal boundary centers (gap-aware)', () => {
        // Two even tracks, 800px, 4px gap: content 796 → first track 398, boundary at 400.
        expect(trackOffsets([1, 1], 800, 4)).toEqual([400]);
        // Four even tracks, 800px, no gap: 200/400/600.
        expect(trackOffsets([1, 1, 1, 1], 800, 0)).toEqual([200, 400, 600]);
        expect(trackOffsets([1], 800, 4)).toEqual([]); // no internal boundary
    });
});

describe('seam segmentation (strips never cross a spanning cell)', () => {
    // An area layout with spanning cells: 3 charts stacked left, 2 stacked right,
    // bound through 6 LCM row tracks (left cells span 2 each, right cells span 3).
    const stacked32: LayoutDefinition = {
        id: 'stacked-3-2',
        label: 'Stacked 3·2',
        cols: [1, 1],
        rows: [1, 1, 1, 1, 1, 1],
        areas: ['c1 c4', 'c1 c4', 'c2 c4', 'c2 c5', 'c3 c5', 'c3 c5'],
        cells: Array.from({ length: 5 }, (_, i) => ({ id: `c${i + 1}`, area: `c${i + 1}` })),
    };

    it('occupancyGrid reads area layouts and auto-flows plain grids', () => {
        const grid = occupancyGrid(stacked32);
        expect(grid).toHaveLength(6);
        expect(grid[0]).toEqual(['c1', 'c4']);
        expect(grid[2]).toEqual(['c2', 'c4']);
        expect(grid[5]).toEqual(['c3', 'c5']);
        // Auto-flow 2×2 grid: row-major cells order.
        expect(occupancyGrid(layoutDefinition('4')!)).toEqual([
            ['c1', 'c2'],
            ['c3', 'c4'],
        ]);
    });

    it('a uniform grid boundary is one full-length seam', () => {
        const grid = occupancyGrid(layoutDefinition('4')!);
        expect(seamSegments(grid, 'cols', 0)).toEqual([[0, 1]]);
        expect(seamSegments(grid, 'rows', 0)).toEqual([[0, 1]]);
    });

    it('a row boundary inside one stack never covers the neighboring spanning cell', () => {
        // Stacked 3·2: left column stacked 3 (c1..c3), right stacked 2 (c4, c5).
        const grid = occupancyGrid(stacked32);
        // Row-track boundary 1 (between tracks 1|2) separates c1/c2 on the left ONLY —
        // the right column's c4 spans it, so the seam stops at column 0.
        expect(seamSegments(grid, 'rows', 1)).toEqual([[0, 0]]);
        // Boundary 2 (tracks 2|3) is the right column's c4/c5 seam only.
        expect(seamSegments(grid, 'rows', 2)).toEqual([[1, 1]]);
        // Boundary 0 (tracks 0|1) crosses NO cell edge at all — no strip anywhere.
        expect(seamSegments(grid, 'rows', 0)).toEqual([]);
        // The single column boundary separates different cells over every row track.
        expect(seamSegments(grid, 'cols', 0)).toEqual([[0, 5]]);
    });

    it('a spanning tall cell splits a boundary into disjoint segments', () => {
        // ['a b', 'c b', 'd e']: the col boundary is a seam everywhere; row boundary 1
        // (c|d and b|e) is full, row boundary 0 (a|c, b spans) is left-only.
        const grid = [
            ['a', 'b'],
            ['c', 'b'],
            ['d', 'e'],
        ];
        expect(seamSegments(grid, 'rows', 0)).toEqual([[0, 0]]);
        expect(seamSegments(grid, 'rows', 1)).toEqual([[0, 1]]);
        expect(seamSegments(grid, 'cols', 0)).toEqual([[0, 2]]);
    });

    it('segmentSpanPx runs flush at container edges and half a gap into interior gaps', () => {
        // Six even tracks, 602px, 2px gap: content 592, each track 98.666…
        const full = segmentSpanPx([1, 1, 1, 1, 1, 1], 602, 2, 0, 5);
        expect(full.start).toBe(0);
        expect(full.end).toBe(602);
        const first = segmentSpanPx([1, 1, 1, 1, 1, 1], 602, 2, 0, 0);
        expect(first.start).toBe(0);
        expect(first.end).toBeCloseTo(98.666 + 1, 1); // track end + half the gap
        const inner = segmentSpanPx([1, 1, 1, 1, 1, 1], 602, 2, 2, 3);
        expect(inner.start).toBeCloseTo(2 * (98.666 + 2) - 1, 1);
        expect(inner.end).toBeCloseTo(4 * (98.666 + 2) - 1, 1);
    });
});

describe('sync model (pure)', () => {
    const IDS = ['c1', 'c2', 'c3', 'c4'];

    it('off/absent settings follow nothing', async () => {
        const { syncTargets } = await import('../src/workspace/sync');
        expect(syncTargets('c1', undefined, IDS)).toEqual([]);
        expect(syncTargets('c1', false, IDS)).toEqual([]);
    });

    it('true links every cell into one implicit group (origin excluded)', async () => {
        const { syncTargets } = await import('../src/workspace/sync');
        expect(syncTargets('c1', true, IDS)).toEqual(['c2', 'c3', 'c4']);
        expect(syncTargets('c3', true, IDS)).toEqual(['c1', 'c2', 'c4']);
    });

    it('a record links same-group cells only; unlisted cells are unlinked', async () => {
        const { syncTargets } = await import('../src/workspace/sync');
        const groups = { c1: 'a', c2: 'a', c3: 'b' };
        expect(syncTargets('c1', groups, IDS)).toEqual(['c2']); // c3 other group, c4 unlisted
        expect(syncTargets('c3', groups, IDS)).toEqual([]); // alone in its group
        expect(syncTargets('c4', groups, IDS)).toEqual([]); // an unlisted origin follows nothing
    });

    it('rangesWithin: the epsilon short-circuit on both edges', async () => {
        const { rangesWithin } = await import('../src/workspace/sync');
        const a = { from: 1000, to: 2000 };
        expect(rangesWithin(a, { from: 1400, to: 1600 }, 500)).toBe(true);
        expect(rangesWithin(a, { from: 1600, to: 2000 }, 500)).toBe(false); // from drifted past eps
        expect(rangesWithin(a, { from: 1000, to: 2601 }, 500)).toBe(false); // to drifted past eps
        expect(rangesWithin(a, a, 0)).toBe(true);
    });

    it('styleConfigSlice keeps exactly the Canvas + Scales-and-lines keys', async () => {
        const { styleConfigSlice } = await import('../src/workspace/sync');
        const slice = styleConfigSlice({
            version: 1,
            layout: { background: '#000' },
            panes: { separatorColor: '#111' },
            grid: { vertLines: { visible: false } },
            priceScale: { invert: true },
            crosshair: { style: 'dotted' },
            // Per-style/series cosmetics stay per cell; the timezone is workspace-global.
            candles: { upColor: '#0f0' },
            series: { style: 'line' },
            timeScale: { timezone: 'Europe/Paris' },
        });
        expect(slice).toEqual({
            layout: { background: '#000' },
            panes: { separatorColor: '#111' },
            grid: { vertLines: { visible: false } },
            priceScale: { invert: true },
            crosshair: { style: 'dotted' },
        });
    });

    it('styleConfigSlice is null on shapeless or sliceless documents', async () => {
        const { styleConfigSlice } = await import('../src/workspace/sync');
        expect(styleConfigSlice(null)).toBeNull();
        expect(styleConfigSlice('nope')).toBeNull();
        expect(styleConfigSlice({ candles: { upColor: '#0f0' } })).toBeNull();
        expect(styleConfigSlice({ layout: 'not-an-object' })).toBeNull();
    });
});

describe('unified options — the cell seed/defaults merge (pure)', () => {
    it('seedDefaults picks exactly the widget market/view vocabulary', () => {
        const seed = seedDefaults({
            symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500,
            priceStyle: 'footprint', data: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
            visibleRange: '1M',
        });
        expect(seed).toEqual({
            symbol: 'binance:BTCUSDT', timeframe: '60', bars: 500,
            priceStyle: 'footprint', data: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
            visibleRange: '1M',
        });
    });

    it('a per-cell entry overrides the top-level default, same words', () => {
        const opts = { symbol: 'BTCUSDT', timeframe: '60', cells: { c2: { symbol: 'ETHUSDT', timeframe: '15' } } };
        const c1 = { ...seedDefaults(opts), ...(opts.cells['c1' as 'c2'] ?? {}) };
        const c2 = { ...seedDefaults(opts), ...opts.cells.c2 };
        expect(c1.symbol).toBe('BTCUSDT');
        expect(c2.symbol).toBe('ETHUSDT');
        expect(c2.timeframe).toBe('15');
        expect(c2.bars).toBeUndefined(); // untouched keys stay the (absent) default
    });

    it('cellChartDefaults forwards the renderer-config vocabulary and nothing else', () => {
        const defaults = cellChartDefaults({
            upColor: '#0a0', downColor: '#a00', glow: 0.5, logScale: true, currentPriceLine: false,
            animations: { zoom: false, pan: true }, defaultLanguage: 'pine', drawings: true,
            settings: { hidden: ['advanced'] },
            // extra keys a caller might hold — must NOT pass through:
            ...( { symbol: 'BTCUSDT', height: 400, nativeBackend: 'webgl2' } as object),
        });
        expect(defaults).toEqual({
            renderer: undefined, defaultLanguage: 'pine', currentPriceLine: false, logScale: true,
            animations: { zoom: false, pan: true }, glow: 0.5, upColor: '#0a0', downColor: '#a00', drawings: true,
            settings: { hidden: ['advanced'] },
        });
        expect('symbol' in defaults).toBe(false);
        expect('height' in defaults).toBe(false);
        expect('nativeBackend' in defaults).toBe(false);
    });

    it('cellDrawings passes everything through EXCEPT the toolbar', () => {
        expect(cellDrawings(undefined)).toEqual({ toolbar: false }); // today's default, preserved
        expect(cellDrawings(true)).toEqual({ toolbar: false });
        expect(cellDrawings(false)).toBe(false); // explicit opt-out respected
        expect(cellDrawings({ tools: ['line'], toolbar: true } as never)).toEqual({ tools: ['line'], toolbar: false });
    });
});

describe('cell identity ↔ slot position (declaredOrder / nextAutoCellId)', () => {
    it('declaration order IS the slot order — names never encode position', () => {
        expect(declaredOrder({ btc: {}, eth: {}, sol: {} })).toEqual(['btc', 'eth', 'sol']);
        expect(declaredOrder(undefined)).toEqual([]);
    });

    it('purely-numeric names are rejected with a warning (JS would reorder them)', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(declaredOrder({ btc: {}, '2': {}, eth: {} })).toEqual(['btc', 'eth']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"2"'));
        warn.mockRestore();
    });

    it('auto identities pick the first free canonical name', () => {
        expect(nextAutoCellId(new Set())).toBe('c1');
        expect(nextAutoCellId(new Set(['c1', 'c2']))).toBe('c3');
        expect(nextAutoCellId(new Set(['btc', 'c1', 'c3']))).toBe('c2'); // holes fill first
    });
});

describe('resolveTyping — bare keystrokes on the workspace root', () => {
    const idle = { dialogs: 0, symbolSearch: false, timeframeEntry: false };

    it('with nothing open: a letter seeds symbol search, a digit the timeframe entry', () => {
        expect(resolveTyping('n', idle)).toEqual({ target: 'symbol', text: 'N' });
        expect(resolveTyping('Q', idle)).toEqual({ target: 'symbol', text: 'Q' });
        expect(resolveTyping('1', idle)).toEqual({ target: 'timeframe', text: '1' });
        expect(resolveTyping('Escape', idle)).toBeNull();
        expect(resolveTyping(' ', idle)).toBeNull();
    });

    it('hands the next keystroke to the entry dialog that just opened (fast typing `NQ`, `15`)', () => {
        // The dialog reports open before its field takes focus; the second key lands
        // on the root in that gap and must extend the query, not vanish.
        expect(resolveTyping('q', { dialogs: 1, symbolSearch: true, timeframeEntry: false })).toEqual({ target: 'symbol', text: 'Q' });
        expect(resolveTyping('2', { dialogs: 1, symbolSearch: true, timeframeEntry: false })).toEqual({ target: 'symbol', text: '2' });
        expect(resolveTyping('5', { dialogs: 1, symbolSearch: false, timeframeEntry: true })).toEqual({ target: 'timeframe', text: '5' });
        expect(resolveTyping('m', { dialogs: 1, symbolSearch: false, timeframeEntry: true })).toEqual({ target: 'timeframe', text: 'm' });
        expect(resolveTyping('Enter', { dialogs: 1, symbolSearch: true, timeframeEntry: false })).toBeNull();
    });

    it('any other open dialog swallows bare typing', () => {
        expect(resolveTyping('n', { dialogs: 1, symbolSearch: false, timeframeEntry: false })).toBeNull();
        expect(resolveTyping('1', { dialogs: 2, symbolSearch: false, timeframeEntry: false })).toBeNull();
    });
});

describe('parseSymbol — the one symbol grammar', () => {
    it('splits an EXCHANGE: prefix case-insensitively and keeps regional variants', () => {
        expect(parseSymbol('Binance:BTCUSDT')).toEqual({ provider: 'binance', ticker: 'BTCUSDT', ext: undefined });
        expect(parseSymbol('BINANCE.US:BTCUSDT')).toEqual({ provider: 'binance.us', ticker: 'BTCUSDT', ext: undefined });
        expect(parseSymbol('coinbase:BTC-USD')).toEqual({ provider: 'coinbase', ticker: 'BTC-USD', ext: undefined });
    });

    it('a bare symbol has no provider; a dotted tail is a best-effort ext token', () => {
        expect(parseSymbol('BTCUSDT')).toEqual({ provider: null, ticker: 'BTCUSDT', ext: undefined });
        expect(parseSymbol('nyse:BRK.B')).toEqual({ provider: 'nyse', ticker: 'BRK.B', ext: 'B' });
    });
});
