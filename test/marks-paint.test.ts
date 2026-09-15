// The timeline-mark lane's hover pulse (src/renderers/native/chrome/marks/paint): the
// size multiplier the painter applies to the token the pointer landed on — pure, node env.
import { describe, it, expect } from 'vitest';
import { letterFontPx, pulseScale, MARK_PULSE_AMPLITUDE, MARK_PULSE_MS } from '../src/renderers/native/chrome/marks/paint';

describe('marks · letterFontPx', () => {
    it('a single letter fills the token; a pair shares its width and shrinks to stay inside the outline', () => {
        expect(letterFontPx(16, 'N')).toBe(9);
        expect(letterFontPx(16, 'US')).toBe(6);
        expect(letterFontPx(20, 'N')).toBe(12);
        expect(letterFontPx(20, 'EU')).toBe(8);
    });

    it('the widest currency pair fits a 16 px pin head and a 20 px cluster token', () => {
        // Measured in Chrome with the host font (system-ui, 600 weight): `CH` is the widest
        // ISO pair — 9.5 px at 6 px, 12.43 px at 8 px. A pin's head is 82% of the token, less
        // the 1.5 px outline on each side.
        const measuredWidthOfCH = { 6: 9.5, 8: 12.43 } as const;
        const headInner = (size: number) => size * 0.82 - 1.5 * 2;
        expect(letterFontPx(16, 'CH')).toBe(6);
        expect(measuredWidthOfCH[6]).toBeLessThan(headInner(16));
        expect(letterFontPx(20, 'CH')).toBe(8);
        expect(measuredWidthOfCH[8]).toBeLessThan(headInner(20));
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
