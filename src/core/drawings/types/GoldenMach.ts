import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_FIELDS } from '../schema';
import type { FibLevel } from './FibRatios';
import { MachFigure, SHOW_RATIOS_FIELD } from './MachFigure';

/**
 * Fibonacci radius steps for Golden Mach tools (multiples of the user-drawn first circle).
 * Colors follow the conventional fib palette used by retracement levels.
 */
export const GOLDEN_MACH_LEVELS: readonly FibLevel[] = [
    { ratio: 0.236, color: '#f23645', enabled: true },
    { ratio: 0.382, color: '#ff9800', enabled: true },
    { ratio: 0.5, color: '#4caf50', enabled: true },
    { ratio: 0.618, color: '#089981', enabled: true },
    { ratio: 0.786, color: '#5b9cf6', enabled: true },
    { ratio: 1, color: '#787b86', enabled: true },
    { ratio: 1.618, color: '#f23645', enabled: true },
    { ratio: 2.618, color: '#ff9800', enabled: true },
    { ratio: 4.236, color: '#4caf50', enabled: true },
    { ratio: 6.854, color: '#089981', enabled: true },
    { ratio: 11.09, color: '#5b9cf6', enabled: true },
];

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
