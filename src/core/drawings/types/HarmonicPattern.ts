import { PatternDrawing } from './PatternDrawing';

/** A closed [min, max] Fibonacci-ratio band (tolerance is baked into the width). */
export interface RatioBand {
    min: number;
    max: number;
}

/** Ideal ratio bands for the four harmonic legs (B/X retrace, C/B retrace, D/C extension, D/X completion). */
export interface HarmonicRanges {
    ab: RatioBand; // AB / XA
    bc: RatioBand; // BC / AB
    cd: RatioBand; // CD / BC
    ad: RatioBand; // AD / XA (the non-adjacent completion ratio)
}

/**
 * Shared base for the named harmonic patterns (Gartley, Bat, Butterfly, Crab, Shark). A 5-point
 * XABCD whose legs are validated against per-pattern Fibonacci bands: the three consecutive
 * ratios (AB/XA, BC/AB, CD/BC) plus the non-adjacent completion AD/XA. {@link valid} is true when
 * all four lie in band; the painter colors each leg ratio + draws a name/✓✗ badge from these hooks.
 * (Cypher overrides the model — its C/D measure against XA/XC.)
 */
export abstract class HarmonicPattern extends PatternDrawing {
    vertexLabels(): readonly string[] {
        return ['X', 'A', 'B', 'C', 'D'];
    }

    override legRatios(): boolean {
        return true;
    }

    override fillTriangles(): ReadonlyArray<readonly [number, number, number]> {
        return [
            [0, 1, 2],
            [2, 3, 4],
        ];
    }

    abstract override patternName(): string;
    /** The pattern's ideal ratio bands. */
    protected abstract ranges(): HarmonicRanges;

    /** A named leg ratio in price space (absolute), or null if a leg is degenerate. */
    protected legValue(name: 'ab' | 'bc' | 'cd' | 'ad'): number | null {
        const [x, a, b, c, d] = this.anchors;
        if (!x || !a || !b || !c || !d) return null;
        const leg = (p: { price: number }, q: { price: number }): number => Math.abs(q.price - p.price);
        const xa = leg(x, a);
        const ab = leg(a, b);
        const bc = leg(b, c);
        switch (name) {
            case 'ab':
                return xa < 1e-9 ? null : ab / xa;
            case 'bc':
                return ab < 1e-9 ? null : bc / ab;
            case 'cd':
                return bc < 1e-9 ? null : leg(c, d) / bc;
            default:
                return xa < 1e-9 ? null : leg(a, d) / xa; // ad
        }
    }

    protected inBand(v: number | null, b: RatioBand): boolean {
        return v != null && v >= b.min && v <= b.max;
    }

    override ratioOk(i: number): boolean | null {
        const r = this.ranges();
        if (i === 2) return this.inBand(this.legValue('ab'), r.ab);
        if (i === 3) return this.inBand(this.legValue('bc'), r.bc);
        if (i === 4) return this.inBand(this.legValue('cd'), r.cd);
        return null;
    }

    override valid(): boolean | null {
        if (this.anchors.length < 5) return null;
        const r = this.ranges();
        return (
            this.inBand(this.legValue('ab'), r.ab) &&
            this.inBand(this.legValue('bc'), r.bc) &&
            this.inBand(this.legValue('cd'), r.cd) &&
            this.inBand(this.legValue('ad'), r.ad)
        );
    }
}
