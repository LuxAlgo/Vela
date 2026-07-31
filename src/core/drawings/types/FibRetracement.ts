import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';
import { fibLevels } from '../levelPalette';

/** Standard retracement ratios (0 → 1). */
const LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/** Fibonacci retracement: horizontal levels between two swing anchors. */
export class FibRetracement extends FibLevels {
    readonly type = 'fibretracement' as const;

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }
}
