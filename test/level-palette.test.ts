import { describe, expect, it } from 'vitest';
import { createDrawing, drawingTypes } from '../src/core/drawings/registry';
import { FibRatios } from '../src/core/drawings/types/FibRatios';
import { cycleColor, LEVEL_CYCLE, levelColor } from '../src/core/drawings/levelPalette';

/** Ratios whose color is fixed by the shared convention (anchors excluded — they are neutral). */
const CONVENTIONAL = [0.236, 0.382, 0.5, 0.618, 0.786, 1.618];

describe('level palette', () => {
    it('gives every subdivided tool the same color for a shared ratio', () => {
        const seen = new Map<number, Map<string, string[]>>();
        let tools = 0;
        for (const type of drawingTypes()) {
            const d = createDrawing(type.type, { paneId: 'price' });
            if (!(d instanceof FibRatios)) continue;
            tools++;
            for (const level of d.defaultLevels()) {
                if (!CONVENTIONAL.includes(level.ratio)) continue;
                const byColor = seen.get(level.ratio) ?? new Map<string, string[]>();
                (byColor.get(level.color) ?? byColor.set(level.color, []).get(level.color)!).push(type.type);
                seen.set(level.ratio, byColor);
            }
        }
        expect(tools).toBeGreaterThanOrEqual(14);
        expect(seen.size).toBe(CONVENTIONAL.length);
        for (const [ratio, byColor] of seen) {
            expect([...byColor.keys()], `ratio ${ratio} colored ${byColor.size} ways: ${JSON.stringify([...byColor])}`).toEqual([
                levelColor(ratio),
            ]);
        }
    });

    it('colors sequence levels by position, wrapping the cycle', () => {
        expect(cycleColor(0)).toBe(LEVEL_CYCLE[0]);
        expect(cycleColor(LEVEL_CYCLE.length)).toBe(LEVEL_CYCLE[0]);
        expect(cycleColor(-1)).toBe(LEVEL_CYCLE[LEVEL_CYCLE.length - 1]);
        expect(new Set(LEVEL_CYCLE).size).toBe(LEVEL_CYCLE.length);
    });
});
