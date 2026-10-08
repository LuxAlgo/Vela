import { FibLevels } from './FibLevels';
import type { FibLevel } from './FibRatios';
import type { SettingsSchema } from '../schema';
import { FIB_PRESETS } from '../fibPresets';

/** The classic set: the standard pullback ratios on, the rest of the ladder off. */
const LEVELS = FIB_PRESETS[0]!.levels;

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

    override schema(): SettingsSchema {
        const base = super.schema();
        return { ...base, fields: [...base.fields, { path: 'reverse', label: 'Reverse', kind: 'boolean' }] };
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
