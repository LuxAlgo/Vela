import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';

/** Standard retracement ratios (0 → 1) with conventional per-level colors. */
const LEVELS: readonly FibLevel[] = [
    { ratio: 0, color: '#787b86', enabled: true },
    { ratio: 0.236, color: '#f23645', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 0.786, color: '#5b9cf6', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
];

/** Fibonacci retracement: horizontal levels between two swing anchors. */
export class FibRetracement extends FibLevels {
    readonly type = 'fibretracement' as const;

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }
}
