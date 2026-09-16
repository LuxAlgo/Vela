// The timeline-mark lane's hover pulse (src/renderers/native/chrome/marks/paint): the
// size multiplier the painter applies to the token the pointer landed on — pure, node env.
import { describe, it, expect } from 'vitest';
import { fitLetterPx, letterFontPx, pulseScale, symbolInnerWidth, MARK_PULSE_AMPLITUDE, MARK_PULSE_MS } from '../src/renderers/native/chrome/marks/paint';

describe('marks · letterFontPx', () => {
    it('a single letter fills the token; a pair shares its width and shrinks to stay inside the outline', () => {
        expect(letterFontPx(16, 'N')).toBe(9);
        expect(letterFontPx(16, 'US')).toBe(6);
        expect(letterFontPx(20, 'N')).toBe(12);
        expect(letterFontPx(20, 'EU')).toBe(8);
    });

    it('a pair that would still run over the outline in the host font is shrunk to fit; one that fits is left alone', () => {
        const pinInner = symbolInnerWidth('pin', 16); // 10.12
        expect(fitLetterPx(6, 9.5, pinInner)).toBe(6); // `CH` in the default font fits
        expect(fitLetterPx(6, 12, pinInner)).toBe(5); // a wide face or `MM`: 6 × 10.12 / 12 → 5
        expect(fitLetterPx(6, 30, pinInner)).toBe(4); // never below 4 px
        expect(fitLetterPx(6, 0, pinInner)).toBe(6); // a zero measurement (no canvas font yet) changes nothing
    });

    it('a pin gives its letters only the head; the other tokens give the whole width, less the outline', () => {
        expect(symbolInnerWidth('pin', 16)).toBeCloseTo(16 * 0.82 - 3, 6);
        expect(symbolInnerWidth('circle', 16)).toBe(13);
        expect(symbolInnerWidth('square', 20)).toBe(17);
    });
});

describe('marks · pulseScale', () => {
    it('plays once: 1 at rest, 1 + amplitude at mid-pulse, back to 1 at the end and ever after', () => {
        expect(pulseScale(0)).toBe(1);
        expect(pulseScale(-50)).toBe(1);
        expect(pulseScale(Number.NaN)).toBe(1);
        expect(pulseScale(MARK_PULSE_MS / 2)).toBeCloseTo(1 + MARK_PULSE_AMPLITUDE, 6);
        expect(pulseScale(MARK_PULSE_MS)).toBe(1);
        expect(pulseScale(MARK_PULSE_MS * 1.5)).toBe(1);
        expect(pulseScale(MARK_PULSE_MS * 10)).toBe(1);
    });

    it('swells and settles smoothly — a slight, brief grow, never a jump or a second beat', () => {
        let prev = 1;
        for (let t = 0; t <= MARK_PULSE_MS / 2; t += 10) {
            const s = pulseScale(t);
            expect(s).toBeGreaterThanOrEqual(prev); // rising half
            prev = s;
        }
        for (let t = MARK_PULSE_MS / 2; t <= MARK_PULSE_MS; t += 10) {
            const s = pulseScale(t);
            expect(s).toBeLessThanOrEqual(prev + 1e-9); // settling half
            prev = s;
        }
        for (let t = 0; t <= MARK_PULSE_MS * 3; t += 7) {
            const s = pulseScale(t);
            expect(s).toBeGreaterThanOrEqual(1);
            expect(s).toBeLessThanOrEqual(1 + MARK_PULSE_AMPLITUDE + 1e-9);
        }
        expect(MARK_PULSE_AMPLITUDE).toBeLessThanOrEqual(0.12);
        expect(MARK_PULSE_MS).toBeLessThanOrEqual(500);
    });
});
