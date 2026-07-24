import { HarmonicPattern, type HarmonicRanges, type RatioBand } from './HarmonicPattern';

const XC_OVER_XA: RatioBand = { min: 1.272, max: 1.414 }; // C extends the XA leg
const CD_OVER_XC: RatioBand = { min: 0.74, max: 0.83 }; // D retraces the XC line by ≈0.786

/**
 * Cypher: AB 0.382–0.618 XA, then two NON-ADJACENT rules — XC/XA 1.272–1.414 (C beyond A) and
 * CD/XC ≈ 0.786. Its C and D measure against XA / XC (not the previous leg), so it overrides the
 * standard harmonic checks.
 */
export class Cypher extends HarmonicPattern {
    readonly type = 'cypher' as const;

    patternName(): string {
        return 'Cypher';
    }

    protected ranges(): HarmonicRanges {
        // Only AB/XA is a standard consecutive constraint; BC/CD/AD are unused (see valid()).
        return { ab: { min: 0.382, max: 0.618 }, bc: { min: 0, max: Infinity }, cd: { min: 0, max: Infinity }, ad: { min: 0, max: Infinity } };
    }

    /** XC/XA — point C is a projection of the XA leg beyond A. */
    private xcOverXa(): number | null {
        const x = this.anchors[0];
        const a = this.anchors[1];
        const c = this.anchors[3];
        if (!x || !a || !c) return null;
        const xa = Math.abs(a.price - x.price);
        return xa < 1e-9 ? null : Math.abs(c.price - x.price) / xa;
    }

    /** CD/XC — D is a retracement of the XC line. */
    private cdOverXc(): number | null {
        const x = this.anchors[0];
        const c = this.anchors[3];
        const d = this.anchors[4];
        if (!x || !c || !d) return null;
        const xc = Math.abs(c.price - x.price);
        return xc < 1e-9 ? null : Math.abs(d.price - c.price) / xc;
    }

    override ratioOk(i: number): boolean | null {
        if (i === 2) return this.inBand(this.legValue('ab'), this.ranges().ab);
        return null; // BC/AB + CD/BC aren't Cypher's defining ratios
    }

    override valid(): boolean | null {
        if (this.anchors.length < 5) return null;
        return this.inBand(this.legValue('ab'), this.ranges().ab) && this.inBand(this.xcOverXa(), XC_OVER_XA) && this.inBand(this.cdOverXc(), CD_OVER_XC);
    }
}
