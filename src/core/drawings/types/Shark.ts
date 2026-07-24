import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

/** Shark: AB 0.382–0.618 XA, BC 1.13–1.618 AB, CD 1.618–2.24 BC, completion AD 0.886–1.13 XA. */
export class Shark extends HarmonicPattern {
    readonly type = 'shark' as const;

    patternName(): string {
        return 'Shark';
    }

    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.382, max: 0.618 }, bc: { min: 1.13, max: 1.618 }, cd: { min: 1.618, max: 2.24 }, ad: { min: 0.886, max: 1.13 } };
    }
}
