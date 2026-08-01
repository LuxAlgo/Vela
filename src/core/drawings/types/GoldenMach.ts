import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import type { FibLevel } from './FibRatios';
import { MachFigure, SHOW_RATIOS_FIELD } from './MachFigure';
import { fibLevels } from '../levelPalette';

/**
 * Fibonacci radius steps for Golden Mach tools (multiples of the user-drawn first circle).
 * Colors follow the conventional fib palette used by retracement levels.
 */
export const GOLDEN_MACH_LEVELS = fibLevels([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 4.236, 6.854, 11.09]);

const DEFAULT_MACH = 2;

/** Golden Sonic — M = 1 Mach figure with Fibonacci-spaced circle radii. */
export class GoldenSonic extends MachFigure {
    readonly type = 'goldensonic' as const;

    protected override shouldSyncWaveCount(): boolean {
        return false;
    }

    defaultLevels(): readonly FibLevel[] {
        return GOLDEN_MACH_LEVELS;
    }

    machNumber(): number {
        return 1;
    }

    override schema(): SettingsSchema {
        // No wave-count dropdown — density is the enabled fib levels in the gear panel.
        return { fields: [...LINE_FIELDS, SHOW_RATIOS_FIELD, ...TEXT_FIELDS] };
    }
}

/** Golden Supersonic — Mach cone with Fibonacci-spaced circle radii. */
export class GoldenSupersonic extends MachFigure {
    readonly type = 'goldensupersonic' as const;

    mach!: number;

    protected override shouldSyncWaveCount(): boolean {
        return false;
    }

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.mach === undefined) this.mach = DEFAULT_MACH;
    }

    defaultLevels(): readonly FibLevel[] {
        return GOLDEN_MACH_LEVELS;
    }

    machNumber(): number {
        return Math.max(1.01, this.mach);
    }

    override schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                {
                    path: 'mach',
                    label: 'Mach number',
                    kind: 'number',
                    min: 1.5,
                    max: 5,
                    step: 0.5,
                    group: 'behavior',
                },
                SHOW_RATIOS_FIELD,
                ...TEXT_FIELDS,
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...super.writeProps(), mach: this.mach };
    }

    protected override readProps(props: Record<string, unknown>): void {
        super.readProps(props);
        if (typeof props.mach === 'number' && Number.isFinite(props.mach)) {
            this.mach = Math.max(1.01, Math.min(20, props.mach));
        }
    }
}
