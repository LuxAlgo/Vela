import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';
import { fibLevels } from '../levelPalette';

/** Standard retracement ratios (0 → 1). */
const LEVELS = fibLevels([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);

/**
 * Fibonacci retracement: horizontal levels between two swing anchors. Level 0 sits on the
 * second anchor and level 1 on the first, so the levels measure the pullback from the
 * point just placed; `reverse` puts level 0 on the first anchor instead.
 */
export class FibRetracement extends FibLevels {
    readonly type = 'fibretracement' as const;

    /** Level 0 on the first anchor (the layout drawings had before the default flipped). */
    declare reverse: boolean;

    constructor(init: ConstructorParameters<typeof FibLevels>[0]) {
        super(init);
        if (this.reverse === undefined) this.reverse = false;
    }

    defaultLevels(): readonly FibLevel[] {
        return LEVELS;
    }

    protected override levelPrice(ratio: number, p1: number, p2: number): number {
        return this.reverse ? p1 + ratio * (p2 - p1) : p2 + ratio * (p1 - p2);
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...super.writeProps(), reverse: this.reverse };
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        // A document saved before the flag existed was laid out with level 0 on the first
        // anchor; keep it that way instead of letting it jump to the new default.
        this.reverse = typeof props.reverse === 'boolean' ? props.reverse : true;
    }
}
