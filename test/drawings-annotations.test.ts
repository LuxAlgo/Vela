import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, getDrawingType, CalloutBase, PinnedLabel, type DrawingTypeKey } from '../src/core/drawings';

const mk = (type: DrawingTypeKey, n: number) =>
    createDrawing(type, { paneId: 'price', anchors: Array.from({ length: n }, (_, i) => ({ time: i * 10, price: 100 + i })) })!;

describe('drawings/annotations (Wave 13)', () => {
    it('registers all five new annotation tools in the annotations group', () => {
        for (const t of ['note', 'pricenote', 'comment', 'pricelabel', 'signpost'] as const) {
            expect(getDrawingType(t)?.group).toBe('annotations');
        }
    });

    it('Note + Price Label are one-anchor pinned labels', () => {
        expect(mk('note', 1).anchorSchema()).toMatchObject({ min: 1, max: 1 });
        expect(mk('pricelabel', 1).anchorSchema()).toMatchObject({ min: 1, max: 1 });
        expect(mk('note', 1)).toBeInstanceOf(PinnedLabel);
        expect(mk('pricelabel', 1)).toBeInstanceOf(PinnedLabel);
    });

    it('Price Note / Comment / Signpost share the two-anchor CalloutBase rig', () => {
        for (const t of ['pricenote', 'comment', 'signpost'] as const) {
            const d = mk(t, 2);
            expect(d.anchorSchema()).toMatchObject({ min: 2, max: 2 });
            expect(d).toBeInstanceOf(CalloutBase); // siblings of Callout, each with its own painter branch
        }
    });

    it('Price Label + Price Note show the auto price — no text.value field, styling kept', () => {
        for (const [t, n] of [['pricelabel', 1], ['pricenote', 2]] as const) {
            const paths = mk(t, n).schema().fields.map((f) => f.path);
            expect(paths).not.toContain('text.value');
            expect(paths).toContain('text.color');
            expect(paths).toContain('style.fillColor');
        }
    });

    it('Note exposes free text + fill', () => {
        const paths = mk('note', 1).schema().fields.map((f) => f.path);
        expect(paths).toContain('text.value');
        expect(paths).toContain('style.fillColor');
    });

    it('seeds distinct placeholder text per free-text tool', () => {
        expect(mk('note', 1).text?.value).toBe('Note');
        expect(mk('comment', 2).text?.value).toBe('Comment');
        expect(mk('signpost', 2).text?.value).toBe('Signpost');
    });

    it('round-trips through serialize', () => {
        for (const [t, n] of [['note', 1], ['pricenote', 2], ['comment', 2], ['pricelabel', 1], ['signpost', 2]] as const) {
            const a = mk(t, n).serialize();
            expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        }
    });
});
