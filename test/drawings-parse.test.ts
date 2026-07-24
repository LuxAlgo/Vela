import { describe, it, expect } from 'vitest';
import { toLines, toBoxes, toLabels, toPolylines, toLinefills, toTables } from '../src/engines/pinets/drawings';
import { IdentityMap } from '../src/engines/pinets/identityMap';
import type { PinePlot } from '../src/engines/pinets/PineRun';

/** Build a drawing container plot whose last point's value is the object array. */
function container(key: string, style: string, objects: Array<Record<string, unknown>>): PinePlot {
    return {
        key,
        style,
        options: { style },
        data: [{ time: 0, value: objects as unknown as number[], options: {} }],
    };
}

const ids = (): IdentityMap => new IdentityMap();

describe('pine/drawings · toLines', () => {
    const base = { id: 0, x1: 10, y1: 100, x2: 20, y2: 110, xloc: 'bi', extend: 'none', color: '#F23645', style: 'style_solid', width: 1, _deleted: false };

    it('maps coordinates, xloc, extend, width and solid style', () => {
        const [ln] = toLines(container('__lines__', 'drawing_line', [{ ...base, extend: 'both', width: 3 }]), 'ind', ids());
        expect(ln).toMatchObject({ xloc: 'bar_index', x1: 10, y1: 100, x2: 20, y2: 110, extend: 'both', width: 3, style: 'solid', color: '#F23645', invisible: false });
    });

    it('decodes short xloc/extend forms defensively', () => {
        const [ln] = toLines(container('__lines__', 'drawing_line', [{ ...base, xloc: 'bt', extend: 'r' }]), 'ind', ids());
        expect(ln!.xloc).toBe('bar_time');
        expect(ln!.extend).toBe('right');
    });

    it('maps dotted/dashed and arrow styles', () => {
        const dotted = toLines(container('__lines__', 'drawing_line', [{ ...base, style: 'style_dotted' }]), 'ind', ids())[0]!;
        expect(dotted.style).toBe('dotted');
        const both = toLines(container('__lines__', 'drawing_line', [{ ...base, style: 'style_arrow_both' }]), 'ind', ids())[0]!;
        expect([both.style, both.arrowLeft, both.arrowRight]).toEqual(['solid', true, true]);
        const right = toLines(container('__lines__', 'drawing_line', [{ ...base, style: 'style_arrow_right' }]), 'ind', ids())[0]!;
        expect([right.arrowLeft, right.arrowRight]).toEqual([false, true]);
    });

    it('treats na color as invisible but empty/omitted as foreground default', () => {
        const naNull = toLines(container('__lines__', 'drawing_line', [{ ...base, color: null }]), 'ind', ids())[0]!;
        expect([naNull.invisible, naNull.color]).toEqual([true, undefined]);
        const naNum = toLines(container('__lines__', 'drawing_line', [{ ...base, color: NaN }]), 'ind', ids())[0]!;
        expect(naNum.invisible).toBe(true);
        const empty = toLines(container('__lines__', 'drawing_line', [{ ...base, color: '' }]), 'ind', ids())[0]!;
        expect([empty.invisible, empty.color]).toEqual([false, undefined]); // → renderer foreground
        const transparent = toLines(container('__lines__', 'drawing_line', [{ ...base, color: '#00000000' }]), 'ind', ids())[0]!;
        expect(transparent.invisible).toBe(true);
    });

    it('skips deleted and coordinate-less lines', () => {
        const out = toLines(container('__lines__', 'drawing_line', [
            { ...base, _deleted: true },
            { ...base, x1: undefined },
        ]), 'ind', ids());
        expect(out).toHaveLength(0);
    });

    it('coerces a stray Series-object coordinate to its current value', () => {
        const seriesX = { data: [0, 1, 2, 3, 4], offset: 0 }; // current value = last = 4
        const [ln] = toLines(container('__lines__', 'drawing_line', [{ ...base, x1: seriesX }]), 'ind', ids());
        expect(ln!.x1).toBe(4);
    });
});

describe('pine/drawings · toBoxes', () => {
    const base = {
        id: 0, left: 10, top: 110, right: 20, bottom: 90, xloc: 'bi', extend: 'none',
        border_color: '#4CAF50', border_style: 'style_solid', border_width: 1, bgcolor: '#4CAF5033',
        text: '', text_color: '#000000', text_size: 'auto', text_halign: 'center', text_valign: 'center',
        text_wrap: 'wrap_none', text_font_family: 'default', text_formatting: 'format_none', _deleted: false,
    };

    it('maps geometry, colors, border and text defaults', () => {
        const [bx] = toBoxes(container('__boxes__', 'drawing_box', [base]), 'ind', ids());
        expect(bx).toMatchObject({
            xloc: 'bar_index', left: 10, top: 110, right: 20, bottom: 90, extend: 'none',
            bgColor: '#4CAF5033', borderColor: '#4CAF50', borderWidth: 1, borderStyle: 'solid',
            text: undefined, textSize: 'auto', hAlign: 'center', vAlign: 'center', wrap: false,
            fontFamily: 'default', bold: false, italic: false,
        });
    });

    it('na bgcolor/border → no fill/border; full text options decode', () => {
        const [bx] = toBoxes(container('__boxes__', 'drawing_box', [{
            ...base, bgcolor: null, border_color: NaN, text: 'Hi', text_color: '#ffffff',
            text_size: 'large', text_halign: 'left', text_valign: 'top', text_wrap: 'wrap_auto',
            text_font_family: 'monospace', text_formatting: 'format_bold',
        }]), 'ind', ids());
        expect(bx).toMatchObject({
            bgColor: undefined, borderColor: undefined, text: 'Hi', textColor: '#ffffff',
            textSize: 'large', hAlign: 'left', vAlign: 'top', wrap: true, fontFamily: 'monospace', bold: true,
        });
    });

    it('decodes italic formatting and short xloc/extend', () => {
        const [bx] = toBoxes(container('__boxes__', 'drawing_box', [{ ...base, xloc: 'bt', extend: 'b', text_formatting: 'format_italic' }]), 'ind', ids());
        expect([bx!.xloc, bx!.extend, bx!.italic]).toEqual(['bar_time', 'both', true]);
    });
});

describe('pine/drawings · toLabels', () => {
    const base = { id: 0, x: 10, y: 100, text: 'hi', xloc: 'bi', yloc: 'pr', color: '#2196F3', style: 'style_label_down', textcolor: '#FFFFFF', size: 'small', textalign: 'center', tooltip: 'tip', text_font_family: 'default', _deleted: false };

    it('maps core fields and strips the style_ prefix', () => {
        const [lb] = toLabels(container('__labels__', 'label', [base]), 'ind', ids());
        expect(lb).toMatchObject({ xloc: 'bar_index', x: 10, y: 100, yloc: 'price', text: 'hi', style: 'label_down', color: '#2196F3', textColor: '#FFFFFF', size: 'small', textAlign: 'center', tooltip: 'tip' });
    });

    it('decodes point-shape styles and yloc above/below (short + long)', () => {
        expect(toLabels(container('__labels__', 'label', [{ ...base, style: 'style_triangleup' }]), 'ind', ids())[0]!.style).toBe('triangleup');
        expect(toLabels(container('__labels__', 'label', [{ ...base, yloc: 'ab' }]), 'ind', ids())[0]!.yloc).toBe('abovebar');
        expect(toLabels(container('__labels__', 'label', [{ ...base, yloc: 'belowbar' }]), 'ind', ids())[0]!.yloc).toBe('belowbar');
    });

    it('keeps above/below labels even when y is na (anchored to the bar)', () => {
        const [lb] = toLabels(container('__labels__', 'label', [{ ...base, yloc: 'ab', y: NaN }]), 'ind', ids());
        expect(lb).toBeDefined();
        expect(lb!.y).toBe(0);
    });

    it('drops a price-anchored label with na y, and unknown style falls back', () => {
        expect(toLabels(container('__labels__', 'label', [{ ...base, yloc: 'pr', y: NaN }]), 'ind', ids())).toHaveLength(0);
        expect(toLabels(container('__labels__', 'label', [{ ...base, style: 'whatever' }]), 'ind', ids())[0]!.style).toBe('label_down');
    });

    it('na bubble color → noFill (text-only); a real color keeps the bubble', () => {
        const na = toLabels(container('__labels__', 'label', [{ ...base, color: null }]), 'ind', ids())[0]!;
        expect([na.noFill, na.color]).toEqual([true, undefined]);
        const solid = toLabels(container('__labels__', 'label', [base]), 'ind', ids())[0]!;
        expect([solid.noFill, solid.color]).toEqual([false, '#2196F3']);
    });

    it('maps a numeric text_size to the nearest named bucket', () => {
        expect(toLabels(container('__labels__', 'label', [{ ...base, size: 20 }]), 'ind', ids())[0]!.size).toBe('large');
        expect(toLabels(container('__labels__', 'label', [{ ...base, size: 8 }]), 'ind', ids())[0]!.size).toBe('tiny');
    });
});

describe('pine/drawings · toPolylines', () => {
    const pt = (index: number, price: number) => ({ index, price });
    const base = { id: 0, points: [pt(10, 100), pt(20, 110), pt(30, 105)], curved: false, closed: false, xloc: 'bi', line_color: '#2196F3', fill_color: '', line_style: 'style_solid', line_width: 2, _deleted: false };

    it('maps points (per-point xloc), flags and colors', () => {
        const [pl] = toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, curved: true, closed: true, fill_color: '#FF000033' }]), 'ind', ids());
        expect(pl!.points).toEqual([
            { xloc: 'bar_index', x: 10, price: 100 },
            { xloc: 'bar_index', x: 20, price: 110 },
            { xloc: 'bar_index', x: 30, price: 105 },
        ]);
        expect([pl!.curved, pl!.closed, pl!.lineColor, pl!.fillColor]).toEqual([true, true, '#2196F3', '#FF000033']);
    });

    it('uses each point time when it carries one (from_time)', () => {
        const [pl] = toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, points: [{ time: 1000 }, { time: 2000 }] }]), 'ind', ids());
        // points lacked price → dropped → <2 points → polyline skipped
        expect(pl).toBeUndefined();
        const [pl2] = toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, points: [{ time: 1000, price: 5 }, { time: 2000, price: 6 }] }]), 'ind', ids());
        expect(pl2!.points).toEqual([{ xloc: 'bar_time', x: 1000, price: 5 }, { xloc: 'bar_time', x: 2000, price: 6 }]);
    });

    it('skips polylines with fewer than 2 valid points', () => {
        expect(toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, points: [pt(1, 1)] }]), 'ind', ids())).toHaveLength(0);
    });

    it('honors the object-level xloc=bar_time even when points also carry an index', () => {
        const pts = [{ index: 10, time: 1000, price: 5 }, { index: 20, time: 2000, price: 6 }];
        const [pl] = toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, xloc: 'bt', points: pts }]), 'ind', ids());
        expect(pl!.points).toEqual([{ xloc: 'bar_time', x: 1000, price: 5 }, { xloc: 'bar_time', x: 2000, price: 6 }]);
    });

    it('decodes arrow line styles into arrow flags', () => {
        const [pl] = toPolylines(container('__polylines__', 'drawing_polyline', [{ ...base, line_style: 'style_arrow_both' }]), 'ind', ids());
        expect([pl!.arrowLeft, pl!.arrowRight]).toEqual([true, true]);
    });
});

describe('pine/drawings · toLinefills', () => {
    const ln = (y1: number, y2: number) => ({ x1: 10, y1, x2: 20, y2, xloc: 'bi', extend: 'none', color: '#089981', style: 'style_solid', width: 1 });

    it('parses both inlined lines + fill color', () => {
        const [lf] = toLinefills(container('__linefills__', 'linefill', [{ id: 0, line1: ln(100, 101), line2: ln(90, 91), color: '#08998133', _deleted: false }]), 'ind', ids());
        expect(lf!.color).toBe('#08998133');
        expect([lf!.line1.y1, lf!.line1.y2]).toEqual([100, 101]);
        expect([lf!.line2.y1, lf!.line2.y2]).toEqual([90, 91]);
    });

    it('skips when a referenced line is missing or malformed', () => {
        expect(toLinefills(container('__linefills__', 'linefill', [{ id: 0, line1: ln(1, 2), color: '#fff', _deleted: false }]), 'ind', ids())).toHaveLength(0);
    });
});

describe('pine/drawings · toTables', () => {
    const cell = (text: string, over: Record<string, unknown> = {}) => ({ text, text_color: '#fff', bgcolor: '', text_halign: 'center', text_valign: 'center', text_size: 'normal', text_font_family: 'default', ...over });

    it('maps grid, frame/border and row-major cells with nulls', () => {
        const [t] = toTables(container('__tables__', 'table', [{
            id: 0, position: 'top_right', columns: 2, rows: 2, bgcolor: '#000000', frame_color: '#787B86', frame_width: 1, border_color: '#787B86', border_width: 1,
            cells: [[cell('A', { text_halign: 'left' }), cell('B')], [null, cell('D')]], _deleted: false,
        }]), 'ind', ids());
        expect([t!.position, t!.columns, t!.rows, t!.frameWidth]).toEqual(['top_right', 2, 2, 1]);
        expect(t!.cells[0]![0]).toMatchObject({ text: 'A', textColor: '#fff', hAlign: 'left' });
        expect(t!.cells[1]![0]).toBeNull();
        expect(t!.cells[1]![1]!.text).toBe('D');
    });

    it('falls back to top_right for an unknown position', () => {
        const [t] = toTables(container('__tables__', 'table', [{ id: 0, position: 'somewhere', columns: 1, rows: 1, frame_width: 0, border_width: 0, cells: [[cell('X')]], _deleted: false }]), 'ind', ids());
        expect(t!.position).toBe('top_right');
    });

    it('parses merge regions and cell bold/italic + merged flags', () => {
        const [t] = toTables(container('__tables__', 'table', [{
            id: 0, position: 'top_right', columns: 2, rows: 2, frame_width: 0, border_width: 0,
            cells: [[cell('Title', { text_formatting: 'format_bold' }), cell('', {})], [cell('a'), cell('b')]],
            merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
            _deleted: false,
        }]), 'ind', ids());
        expect(t!.merges).toEqual([{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }]);
        expect(t!.cells[0]![0]!.bold).toBe(true);
    });
});
