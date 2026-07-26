// The workspace's pure modules: the layout registry/grid math and the splitter track
// math (src/workspace/layouts.ts, splitters.ts). DOM-free — node env; the VelaWorkspace
// shell itself is verified in the browser (playground probes).
import { describe, it, expect, afterEach } from 'vitest';
import {
    registerBuiltinLayouts,
    registerLayout,
    unregisterLayout,
    layoutDefinition,
    layouts,
    gridStyles,
    activeAfterLayout,
    type LayoutDefinition,
} from '../src/workspace/layouts';
import { evenTracks, resizeTracks, trackOffsets } from '../src/workspace/splitters';

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
});
