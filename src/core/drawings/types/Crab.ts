import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

/** Crab: AB 0.382–0.618 XA, extreme CD 2.618–3.618 BC, completion AD≈1.618 XA. */
export class Crab extends HarmonicPattern {
    readonly type = 'crab' as const;

    patternName(): string {
        return 'Crab';
    }

    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.382, max: 0.618 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 2.618, max: 3.618 }, ad: { min: 1.55, max: 1.69 } };
    }
}
