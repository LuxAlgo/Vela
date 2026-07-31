// The LEVEL PALETTE — the one color convention every subdivided tool paints its levels
// with, so the 0.618 of a retracement, a fan, an arc set and a Gann box are all the same
// color. Before this module each of the ~18 tools restated the same hex list, and they had
// already drifted (two near-identical blues, one ratio colored three different ways).
//
// Two ways to color a level, matching the two kinds of tool:
//   • BY RATIO ({@link levelColor}) — Fibonacci-style tools, where a ratio has a conventional
//     color a trader recognizes, and the anchor ratios (0, 1, 2, 3) read as neutral bounds.
//   • BY POSITION ({@link cycleColor}) — sequence tools (Gann fan angles, Mach waves), where
//     the level has no canonical ratio and only needs to be distinguishable from its
//     neighbours.

import { BEARISH, BULLISH, INFO, NEUTRAL, WARNING } from '../palette';
import type { FibLevel } from './types/FibRatios';

/** Boundary levels (0, 1, 2, 3): the frame of the construction, not a signal. */
export const LEVEL_ANCHOR = NEUTRAL;
export const LEVEL_RED = BEARISH;
export const LEVEL_ORANGE = WARNING;
export const LEVEL_GREEN = '#4caf50';
export const LEVEL_TEAL = BULLISH;
export const LEVEL_BLUE = INFO;
export const LEVEL_PURPLE = '#9c27b0';
export const LEVEL_PINK = '#e91e63';
export const LEVEL_AQUA = '#26a69a';
export const LEVEL_VIOLET = '#ab47bc';
export const LEVEL_CORAL = '#ef5350';
export const LEVEL_AMBER = '#ffb74d';
export const LEVEL_CYAN = '#38c0fd';
/** The 1/1 diagonal of a Gann construction — chart ink, deliberately not a hue. */
export const LEVEL_UNITY = '#b2b5be';

/** The distinguish-by-position sequence, ordered so neighbours contrast. */
export const LEVEL_CYCLE: readonly string[] = [
    LEVEL_CYAN,
    LEVEL_BLUE,
    LEVEL_TEAL,
    LEVEL_GREEN,
    LEVEL_ORANGE,
    LEVEL_RED,
    LEVEL_PINK,
    LEVEL_PURPLE,
    LEVEL_ANCHOR,
    LEVEL_AQUA,
    LEVEL_VIOLET,
    LEVEL_CORAL,
];

/** The nth color of {@link LEVEL_CYCLE} (wraps), for sequence tools. */
export function cycleColor(index: number): string {
    return LEVEL_CYCLE[((index % LEVEL_CYCLE.length) + LEVEL_CYCLE.length) % LEVEL_CYCLE.length]!;
}

/** The conventional color of each Fibonacci-family ratio. */
const RATIO_COLORS: ReadonlyArray<readonly [number, string]> = [
    [0, LEVEL_ANCHOR],
    [0.125, LEVEL_RED],
    [0.236, LEVEL_RED],
    [0.25, LEVEL_RED],
    [0.382, LEVEL_ORANGE],
    [0.5, LEVEL_GREEN],
    [0.618, LEVEL_TEAL],
    [0.75, LEVEL_BLUE],
    [0.786, LEVEL_BLUE],
    [1, LEVEL_ANCHOR],
    [1.272, LEVEL_BLUE],
    [1.382, LEVEL_ORANGE],
    [1.618, LEVEL_RED],
    [2, LEVEL_ANCHOR],
    [2.382, LEVEL_ORANGE],
    [2.618, LEVEL_ORANGE],
    [3, LEVEL_ANCHOR],
    [4.236, LEVEL_GREEN],
    [6.854, LEVEL_TEAL],
    [11.09, LEVEL_BLUE],
];

/** The convention's color for a ratio. Unknown ratios fall back to their position in the
 *  cycle, so a tool with a bespoke ratio set still gets distinguishable levels. */
export function levelColor(ratio: number, index = 0): string {
    return RATIO_COLORS.find(([r]) => r === ratio)?.[1] ?? cycleColor(index);
}

/** One entry in a tool's default level set: a bare ratio takes the convention's color and is
 *  enabled; the object form overrides color, enabled state or label for that tool only. */
export type LevelSpec = number | { ratio: number; color?: string; enabled?: boolean; label?: string };

/** Build a tool's default levels from its ratios, colored by the shared convention. */
export function fibLevels(specs: readonly LevelSpec[]): readonly FibLevel[] {
    return specs.map((spec, i) => {
        const s = typeof spec === 'number' ? { ratio: spec } : spec;
        return {
            ratio: s.ratio,
            color: s.color ?? levelColor(s.ratio, i),
            enabled: s.enabled !== false,
            ...(s.label ? { label: s.label } : {}),
        };
    });
}

/** Build a sequence tool's levels, colored by position (1-based ratios and labels). */
export function cycleLevels(count: number, enabledCount = count): readonly FibLevel[] {
    return Array.from({ length: count }, (_, i) => ({
        ratio: i + 1,
        color: cycleColor(i),
        enabled: i < enabledCount,
        label: String(i + 1),
    }));
}
