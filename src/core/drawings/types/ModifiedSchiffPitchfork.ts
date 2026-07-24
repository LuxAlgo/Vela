import type { DrawingPoint } from '../geometry';
import { PitchforkVariant } from './PitchforkVariant';

/** A modified Schiff pitchfork: the median origin is the full midpoint of the pivot and the first
 *  tine point (shifted in both time and price). */
export class ModifiedSchiffPitchfork extends PitchforkVariant {
    readonly type = 'modifiedschiffpitchfork' as const;

    protected medianStart(p0: DrawingPoint, p1: DrawingPoint): DrawingPoint {
        return { time: (p0.time + p1.time) / 2, price: (p0.price + p1.price) / 2 };
    }
}
