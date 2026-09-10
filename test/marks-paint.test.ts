// The timeline-mark lane's hover pulse (src/renderers/native/chrome/marks/paint): the
// size multiplier the painter applies to the token the pointer landed on — pure, node env.
import { describe, it, expect } from 'vitest';
import { pulseScale, MARK_PULSE_AMPLITUDE, MARK_PULSE_MS } from '../src/renderers/native/chrome/marks/paint';

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
