import { TwoPointLine } from './TwoPointLine';

/** A trend-line segment that shows its inclination (degrees) with a baseline + arc at the start. */
export class TrendAngle extends TwoPointLine {
    readonly type = 'trendangle' as const;
}
