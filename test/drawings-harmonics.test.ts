import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, type DrawingTypeKey, type HarmonicPattern, type PatternDrawing } from '../src/core/drawings';

const HARM = (type: DrawingTypeKey, prices: number[]) =>
    createDrawing(type, { paneId: 'price', anchors: prices.map((p, i) => ({ time: i * 10, price: p })) })! as HarmonicPattern;

describe('drawings/harmonic patterns', () => {
    it('validates a Gartley when all four ratios are in band', () => {
        // X0 A100 B40 C70 D22 → AB/XA 0.6, BC/AB 0.5, CD/BC 1.6, AD/XA 0.78 (all in band)
        const g = HARM('gartley', [0, 100, 40, 70, 22]);
        expect(g.patternName()).toBe('Gartley');
        expect(g.valid()).toBe(true);
        expect(g.ratioOk(2)).toBe(true); // AB/XA
        expect(g.ratioOk(3)).toBe(true); // BC/AB
        expect(g.ratioOk(4)).toBe(true); // CD/BC
        expect(g.anchorSchema().min).toBe(5);
    });

    it('flags a Gartley invalid when a leg is out of band', () => {
        // B10 → AB/XA 0.9, outside Gartley's [0.55, 0.68]
        const g = HARM('gartley', [0, 100, 10, 70, 22]);
        expect(g.ratioOk(2)).toBe(false);
        expect(g.valid()).toBe(false);
    });

    it('distinguishes the patterns by their bands — the same shape is a Gartley, not a Bat', () => {
        const shape = [0, 100, 40, 70, 22]; // AD/XA 0.78
        expect(HARM('gartley', shape).valid()).toBe(true); // AD 0.78 ∈ Gartley [0.74, 0.83]
        expect(HARM('bat', shape).valid()).toBe(false); // Bat needs AD ≈ 0.886 + AB ≤ 0.5
    });

    it('validates a Crab (extreme CD + AD≈1.618)', () => {
        // X0 A100 B50 C93 D-61.8 → AB/XA 0.5, BC/AB 0.86, CD/BC 154.8/43=3.6, AD/XA 1.618 (all in band)
        const c = HARM('crab', [0, 100, 50, 93, -61.8]);
        expect(c.valid()).toBe(true);
    });

    it('Cypher uses its non-adjacent rules (XC/XA, CD/XC), not the consecutive legs', () => {
        // X0 A100 B50 C130 D28 → AB/XA .5, XC/XA 1.3, CD/XC 102/130=0.785
        const cy = HARM('cypher', [0, 100, 50, 130, 28]);
        expect(cy.patternName()).toBe('Cypher');
        expect(cy.valid()).toBe(true);
        expect(cy.ratioOk(2)).toBe(true); // AB/XA is a Cypher constraint
        expect(cy.ratioOk(3)).toBeNull(); // BC/AB is NOT a Cypher constraint
    });

    it('a plain XABCD is not a validated harmonic', () => {
        const x = createDrawing('xabcd', { paneId: 'price', anchors: [0, 100, 40, 70, 22].map((p, i) => ({ time: i * 10, price: p })) })! as PatternDrawing;
        expect(x.patternName()).toBeNull();
        expect(x.valid()).toBeNull();
    });

    it('round-trips through serialize', () => {
        const a = HARM('butterfly', [0, 100, 21, 60, 130]).serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('butterfly');
    });
});
