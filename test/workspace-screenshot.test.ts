import { describe, it, expect, afterEach } from 'vitest';
import {
    compositeLayoutScreenshot,
    destRect,
    tilesFromCellRects,
    type LayoutShotTile,
} from '../src/workspace/screenshot';

/**
 * The workspace screenshot button composites every visible cell onto one PNG.
 * These tests guard the geometry: hidden cells drop out, adjacent tiles share an
 * edge after DPR rounding, and every contributed raster is blitted in place.
 *
 * The vitest env is `node` (no DOM/canvas), so `document.createElement('canvas')`
 * is stubbed with a recording canvas — same technique as native-screenshot.test.ts.
 */

interface FakeSource { __id: string }
const src = (id: string): CanvasImageSource => ({ __id: id }) as unknown as CanvasImageSource;

const originalDocument = (globalThis as { document?: unknown }).document;
afterEach(() => { (globalThis as { document?: unknown }).document = originalDocument; });

function setupComposite(): { drawn: Array<{ id: string; dx: number; dy: number; dw: number; dh: number }>; filled: { color: string; w: number; h: number } | null } {
    const drawn: Array<{ id: string; dx: number; dy: number; dw: number; dh: number }> = [];
    let filled: { color: string; w: number; h: number } | null = null;
    const ctx = {
        fillStyle: '',
        fillRect(_x: number, _y: number, w: number, h: number) {
            filled = { color: this.fillStyle as string, w, h };
        },
        drawImage(source: FakeSource, dx: number, dy: number, dw: number, dh: number) {
            drawn.push({ id: source.__id, dx, dy, dw, dh });
        },
    };
    const out = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,LAYOUT' };
    (globalThis as { document?: unknown }).document = { createElement: () => out };
    return { drawn, get filled() { return filled; } } as { drawn: typeof drawn; filled: { color: string; w: number; h: number } | null };
}

describe('tilesFromCellRects', () => {
    const grid = { left: 10, top: 20, width: 200, height: 100 };

    it('maps each cell into grid-local CSS pixels', () => {
        expect(tilesFromCellRects(grid, [
            { left: 10, top: 20, width: 99, height: 100 },
            { left: 111, top: 20, width: 99, height: 100 },
        ])).toEqual([
            { x: 0, y: 0, width: 99, height: 100 },
            { x: 101, y: 0, width: 99, height: 100 },
        ]);
    });

    it('drops hidden cells and zero-size boxes (maximized siblings, collapsed slots)', () => {
        expect(tilesFromCellRects(grid, [
            { hidden: true, left: 10, top: 20, width: 99, height: 100 },
            { left: 111, top: 20, width: 99, height: 100 },
            { left: 10, top: 20, width: 0, height: 100 },
        ])).toEqual([{ x: 101, y: 0, width: 99, height: 100 }]);
    });

    it('returns nothing for a zero-size grid', () => {
        expect(tilesFromCellRects({ left: 0, top: 0, width: 0, height: 100 }, [
            { left: 0, top: 0, width: 50, height: 100 },
        ])).toEqual([]);
    });
});

describe('destRect rounding', () => {
    it('makes adjacent tiles share an edge so DPR rounding cannot open a 1px gap', () => {
        const dpr = 1.5;
        const a = destRect({ x: 0, y: 0, width: 99, height: 100 }, dpr);
        const b = destRect({ x: 101, y: 0, width: 99, height: 100 }, dpr);
        // 2px CSS seam at x=99..101 → the tiles must not overlap and must not
        // leave a hole besides that seam.
        expect(a.dx + a.dw).toBe(Math.round(99 * dpr));
        expect(b.dx).toBe(Math.round(101 * dpr));
        expect(a.dx + a.dw).toBeLessThanOrEqual(b.dx);
    });
});

describe('compositeLayoutScreenshot', () => {
    it('fills the seam color first, then blits every tile at its dest rect', () => {
        const rec = setupComposite();
        const tiles: LayoutShotTile[] = [
            { source: src('a'), x: 0, y: 0, width: 99, height: 100 },
            { source: src('b'), x: 101, y: 0, width: 99, height: 100 },
        ];
        const url = compositeLayoutScreenshot(document as Document, { width: 200, height: 100, dpr: 2, gapColor: 'rgb(40, 40, 40)' }, tiles);

        expect(url).toBe('data:image/png;base64,LAYOUT');
        expect(rec.filled).toEqual({ color: 'rgb(40, 40, 40)', w: 400, h: 200 });
        expect(rec.drawn.map((d) => d.id)).toEqual(['a', 'b']);
        expect(rec.drawn[0]).toMatchObject(destRect(tiles[0]!, 2));
        expect(rec.drawn[1]).toMatchObject(destRect(tiles[1]!, 2));
    });

    it('returns null when the frame is empty or no tile paints', () => {
        setupComposite();
        expect(compositeLayoutScreenshot(document as Document, { width: 0, height: 100, dpr: 1, gapColor: '#000' }, [
            { source: src('a'), x: 0, y: 0, width: 10, height: 10 },
        ])).toBeNull();
        expect(compositeLayoutScreenshot(document as Document, { width: 200, height: 100, dpr: 1, gapColor: '#000' }, [])).toBeNull();
        expect(compositeLayoutScreenshot(document as Document, { width: 200, height: 100, dpr: 1, gapColor: '#000' }, [
            { source: src('a'), x: 0, y: 0, width: 0, height: 10 },
        ])).toBeNull();
    });
});
