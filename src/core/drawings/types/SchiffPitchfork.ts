import type { DrawingPoint } from '../geometry';
import { PitchforkVariant } from './PitchforkVariant';

/** A Schiff pitchfork: the median origin is shifted in PRICE only — halfway between the pivot and
 *  the first tine point, at the pivot's time. */
export class SchiffPitchfork extends PitchforkVariant {
    readonly type = 'schiffpitchfork' as const;

    protected medianStart(p0: DrawingPoint, p1: DrawingPoint): DrawingPoint {
        return { time: p0.time, price: (p0.price + p1.price) / 2 };
    }
}
