import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

/** Butterfly: AB≈0.786 XA, CD 1.618–2.618 BC, completion AD 1.272–1.618 XA (D extends beyond X). */
export class Butterfly extends HarmonicPattern {
    readonly type = 'butterfly' as const;

    patternName(): string {
        return 'Butterfly';
    }

    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.74, max: 0.83 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.618, max: 2.618 }, ad: { min: 1.272, max: 1.618 } };
    }
}
