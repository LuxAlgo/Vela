import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';
import { fibLevels, LEVEL_PURPLE } from '../levelPalette';

/** Extension ratios — the swing plus projections beyond it (>1) for price targets, with the
 *  rest of the ladder present but off. The furthest default target breaks out of the shared
 *  hues to read as the outermost projection. */
const ON = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618];
const LEVELS = fibLevels(
    [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.414, 1.618, 2, 2.272, 2.414, 2.618, 3, 3.272, 3.618, 4.236, 4.618].map((ratio) => ({
        ratio,
        enabled: ON.includes(ratio),
        ...(ratio === 2.618 ? { color: LEVEL_PURPLE } : {}),
    })),
);

/**
 * Fibonacci extension: the same two-anchor levels as a retracement, but with ratios
 * projecting beyond the swing (1.272 / 1.618 / 2.618) for price targets.
 */
export class FibExtension extends FibLevels {
    readonly type = 'fibextension' as const;

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }
}
