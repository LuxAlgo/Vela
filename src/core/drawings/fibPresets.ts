import type { FibLevel } from './types/FibRatios';
import { fibLevels, LEVEL_AMBER } from './levelPalette';

/**
 * Ready-made level sets for the Fibonacci retracement. Each keeps the whole ladder of levels —
 * the ones it doesn't use are present but off, so turning one on is a click — and sets which
 * end of the swing level 0 sits on.
 */
export type FibPresetKey = 'classic' | 'extension' | 'ote';

export interface FibPreset {
    key: FibPresetKey;
    label: string;
    /** Level 0 on the first anchor (the swing's start) instead of the second. */
    reverse: boolean;
    levels: readonly FibLevel[];
}

/** The standard ladder: retracements, extensions, then targets beyond the swing's end. */
const LADDER = [0, 0.236, 0.382, 0.5, 0.618, 0.705, 0.786, 0.886, 1, 1.272, 1.414, 1.618, 2, 2.272, 2.414, 2.618, 3, 3.272, 3.618, 4.236, 4.618, -0.272, -0.618, -1];

/** The optimal-trade-entry ladder: the 0.62–0.79 entry zone around 0.705, equilibrium at 0.5,
 *  and targets measured beyond the swing's end. */
const OTE_LADDER = [0, 0.236, 0.382, 0.5, 0.62, 0.705, 0.79, 0.886, 1, 1.272, 1.414, 1.618, 2, 2.618, 3, 3.618, 4.236, 4.618, -0.27, -0.62, -1, -1.5, -2, -2.5];

function ladder(ratios: readonly number[], on: readonly number[], colors: Readonly<Record<string, string>> = {}): readonly FibLevel[] {
    return fibLevels(ratios.map((ratio) => ({ ratio, enabled: on.includes(ratio), color: colors[String(ratio)] })));
}

export const FIB_PRESETS: readonly FibPreset[] = [
    {
        key: 'classic',
        label: 'Classic',
        reverse: false,
        levels: ladder(LADDER, [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]),
    },
    {
        key: 'extension',
        label: 'Extension',
        reverse: true,
        levels: ladder(LADDER, [0, 1, 1.272, 1.414, 1.618, 2, 2.618, 3.618, 4.236]),
    },
    {
        key: 'ote',
        label: 'OTE',
        reverse: false,
        // The entry zone reads as one band.
        levels: ladder(OTE_LADDER, [0, 0.5, 0.62, 0.705, 0.79, 1, -0.27, -0.62], { '0.62': LEVEL_AMBER, '0.705': LEVEL_AMBER, '0.79': LEVEL_AMBER }),
    },
];

/** The preset a level set and direction match exactly, or null once the user has made them their own. */
export function matchFibPreset(levels: readonly FibLevel[], reverse: boolean): FibPresetKey | null {
    const key = (ls: readonly FibLevel[]): string => JSON.stringify(ls.map((l) => [l.ratio, l.color, l.enabled, l.label ?? '']));
    const mine = key(levels);
    return FIB_PRESETS.find((p) => p.reverse === reverse && key(p.levels) === mine)?.key ?? null;
}
