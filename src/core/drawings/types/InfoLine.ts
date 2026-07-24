import { TwoPointLine } from './TwoPointLine';

/** A trend-line segment that shows a price/percent/bars readout at its midpoint. */
export class InfoLine extends TwoPointLine {
    readonly type = 'infoline' as const;
}
