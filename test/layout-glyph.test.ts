// The topbar's layout button draws the CURRENT layout: a 16px line glyph generated from the
// layout definition — the frame is the grid, seams only where neighboring tracks hold
// different slots, placed at the declared track weights.
import { describe, it, expect, beforeAll } from 'vitest';
import { layoutGlyph, layoutDefinition, layoutForGrid, registerBuiltinLayouts, type LayoutDefinition } from '../src/workspace/layouts';

beforeAll(() => registerBuiltinLayouts());

/** The seam path of a glyph (`''` when it draws the frame alone). */
function seams(svg: string): string {
    return /<path d="([^"]*)"/.exec(svg)?.[1] ?? '';
}

function builtin(id: string): LayoutDefinition {
    const def = layoutDefinition(id);
    if (!def) throw new Error(`no builtin layout ${id}`);
    return def;
}

describe('layoutGlyph', () => {
    it('speaks the topbar icon language: 16px box, currentColor stroke 1.2, round joins, no fill', () => {
        const svg = layoutGlyph(builtin('4'));
        expect(svg).toMatch(/^<svg /);
        expect(svg).toContain('viewBox="0 0 16 16"');
        expect(svg).toContain('stroke="currentColor"');
        expect(svg).toContain('stroke-width="1.2"');
        expect(svg).toContain('stroke-linejoin="round"');
        expect(svg).toContain('fill="none"');
        expect(svg).toContain('<rect x="1.5" y="1.5" width="13" height="13" rx="1.5"/>');
    });

    it('draws each built-in layout', () => {
        expect(seams(layoutGlyph(builtin('1')))).toBe('');
        expect(layoutGlyph(builtin('1'))).not.toContain('<path');
        expect(seams(layoutGlyph(builtin('2h')))).toBe('M8 1.5V14.5');
        expect(seams(layoutGlyph(builtin('2v')))).toBe('M1.5 8H14.5');
        expect(seams(layoutGlyph(builtin('4')))).toBe('M8 1.5V14.5M1.5 8H14.5');
        expect(seams(layoutGlyph(builtin('8')))).toBe('M4.75 1.5V14.5M8 1.5V14.5M11.25 1.5V14.5M1.5 8H14.5');
    });

    it('draws the picker-composed grids', () => {
        expect(seams(layoutGlyph(layoutForGrid(3, 3)))).toBe('M5.83 1.5V14.5M10.17 1.5V14.5M1.5 5.83H14.5M1.5 10.17H14.5');
        expect(seams(layoutGlyph(layoutForGrid(1, 3)))).toBe('M5.83 1.5V14.5M10.17 1.5V14.5');
    });

    it('keeps a spanning cell whole in an uneven arrangement (one big cell + two small)', () => {
        const bigLeft: LayoutDefinition = {
            id: 'big-left',
            label: 'Big left',
            cols: [2, 1],
            rows: [1, 1],
            areas: ['main a', 'main b'],
            cells: [
                { id: 'c1', area: 'main' },
                { id: 'c2', area: 'a' },
                { id: 'c3', area: 'b' },
            ],
        };
        // The vertical seam runs the full height at 2/3; the horizontal one only splits the right column.
        expect(seams(layoutGlyph(bigLeft))).toBe('M10.17 1.5V14.5M10.17 8H14.5');

        const wideTop: LayoutDefinition = {
            id: 'wide-top',
            label: 'Wide top',
            cols: [1, 1],
            rows: [1, 1],
            areas: ['top top', 'l r'],
            cells: [
                { id: 'c1', area: 'top' },
                { id: 'c2', area: 'l' },
                { id: 'c3', area: 'r' },
            ],
        };
        expect(seams(layoutGlyph(wideTop))).toBe('M8 8V14.5M1.5 8H14.5');
    });

    it('places seams at the declared track weights', () => {
        const weighted: LayoutDefinition = {
            id: 'wide-left',
            label: 'Wide left',
            cols: [3, 1],
            rows: [1],
            cells: [{ id: 'c1' }, { id: 'c2' }],
        };
        expect(seams(layoutGlyph(weighted))).toBe('M11.25 1.5V14.5');
    });
});
