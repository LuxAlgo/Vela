import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';

/** Extension ratios — the swing plus projections beyond it (>1) for price targets. */
const LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.272, color: '#5b9cf6', enabled: true },
    { ratio: 1.618, color: '#f23645', enabled: true },
    { ratio: 2.618, color: '#9c27b0', enabled: true },
];

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
