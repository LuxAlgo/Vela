import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, getDrawingType, GlyphStamp, type DrawingTypeKey } from '../src/core/drawings';

const mk = (type: DrawingTypeKey) => createDrawing(type, { paneId: 'price', anchors: [{ time: 0, price: 100 }] })! as GlyphStamp;

describe('drawings/glyph stamps (Wave 15)', () => {
    it('registers flag + icon stamps in the stamps group', () => {
        expect(getDrawingType('flagmark')?.group).toBe('stamps');
        expect(getDrawingType('iconstamp')?.group).toBe('stamps');
    });

    it('seeds the per-tool default glyph', () => {
        expect(mk('flagmark').glyph).toBe('⚑');
        expect(mk('iconstamp').glyph).toBe('★');
    });

    it('is a one-anchor stamp with glyph + size pickers in its schema', () => {
        const d = mk('iconstamp');
        expect(d.anchorSchema()).toMatchObject({ min: 1, max: 1 });
        const paths = d.schema().fields.map((f) => f.path);
        expect(paths).toContain('glyph');
        expect(paths).toContain('size');
        expect(d).toBeInstanceOf(GlyphStamp);
    });

    it('defaults to normal size; bigger named sizes render larger px', () => {
        const d = mk('iconstamp');
        expect(d.size).toBe('normal');
        const small = d.sizePx();
        d.applySettings({ size: 'huge' });
        expect(d.size).toBe('huge');
        expect(d.sizePx()).toBeGreaterThan(small);
    });

    it('round-trips the chosen glyph + size through props', () => {
        const d = mk('iconstamp');
        d.applySettings({ glyph: '❤', size: 'large' });
        expect(d.glyph).toBe('❤');
        const ser = d.serialize();
        expect(ser.props).toMatchObject({ glyph: '❤', size: 'large' });
        const round = deserializeDrawing(ser) as GlyphStamp;
        expect(round.glyph).toBe('❤');
        expect(round.size).toBe('large');
    });
});
