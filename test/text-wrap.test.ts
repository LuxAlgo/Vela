// Text drawn on the chart (a note, a box label) wraps between words in every script: at
// spaces, and between the words of scripts written without them, never inside a word.
import { describe, expect, it } from 'vitest';
import { wrapTextLines } from '../src/renderers/shared/text-wrap';

/** Ten pixels per character: easy widths to reason about. */
const measure = (text: string): number => [...text].length * 10;

describe('wrapping text on the chart', () => {
    it('Thai text in a label wraps between its words instead of running off the box', () => {
        const thai = 'ราคาปิดสูงกว่าค่าเฉลี่ยเคลื่อนที่'; // "the close is above the moving average"
        const lines = wrapTextLines(thai, 100, measure);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).toBe(thai);
        for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(100);
    });

    it('Japanese wraps between words, and a line never starts with a full stop', () => {
        const japanese = '価格が移動平均を上回りました。買いシグナルです。';
        const lines = wrapTextLines(japanese, 80, measure);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join('')).toBe(japanese);
        for (const line of lines.slice(1)) expect(line.startsWith('。')).toBe(false);
    });

    it('text with spaces wraps at the spaces, as it always has', () => {
        expect(wrapTextLines('Close above the moving average', 120, measure)).toEqual(['Close above', 'the moving', 'average']);
        expect(wrapTextLines('Short', 120, measure)).toEqual(['Short']);
        expect(wrapTextLines('Two\nlines', 120, measure)).toEqual(['Two', 'lines']);
    });
});
