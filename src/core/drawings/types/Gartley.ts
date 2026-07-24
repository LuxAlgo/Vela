import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

/** Gartley: AB≈0.618 XA, CD 1.13–1.618 BC, completion AD≈0.786 XA. */
export class Gartley extends HarmonicPattern {
    readonly type = 'gartley' as const;

    patternName(): string {
        return 'Gartley';
    }

    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.55, max: 0.68 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.13, max: 1.618 }, ad: { min: 0.74, max: 0.83 } };
    }
}
