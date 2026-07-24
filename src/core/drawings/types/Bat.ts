import { HarmonicPattern, type HarmonicRanges } from './HarmonicPattern';

/** Bat: AB 0.382–0.5 XA (never 0.618), CD 1.618–2.618 BC, completion AD≈0.886 XA (the defining ratio). */
export class Bat extends HarmonicPattern {
    readonly type = 'bat' as const;

    patternName(): string {
        return 'Bat';
    }

    protected ranges(): HarmonicRanges {
        return { ab: { min: 0.382, max: 0.5 }, bc: { min: 0.382, max: 0.886 }, cd: { min: 1.618, max: 2.618 }, ad: { min: 0.84, max: 0.92 } };
    }
}
