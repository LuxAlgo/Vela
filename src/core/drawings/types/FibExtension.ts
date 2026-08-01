import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';
import { fibLevels, LEVEL_PURPLE } from '../levelPalette';

/** Extension ratios — the swing plus projections beyond it (>1) for price targets. The
 *  furthest target breaks out of the shared hues to read as the outermost projection. */
const LEVELS = fibLevels([0, 0.382, 0.618, 1, 1.272, 1.618, { ratio: 2.618, color: LEVEL_PURPLE }]);

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
