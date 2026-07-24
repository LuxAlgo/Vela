import { describe, it, expect } from 'vitest';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

function setup(dpr = 1) {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, dpr);
    cs.setBars([1000, 2000, 3000, 4000, 5000]); // 5 bars, interval 1000ms
    cs.setViewport({ barSpacing: 100, rightOffset: 1 });
    return cs;
}

describe('native CoordinateSystem · X axis (logical ↔ px)', () => {
    it('maps logical bar index to pixels via barSpacing + rightOffset', () => {
        const cs = setup();
        expect(cs.barCount).toBe(5);
        expect(cs.rightEdgeLogical).toBe(5); // (n-1) + rightOffset = 4 + 1
        expect(cs.logicalToX(5)).toBe(800); // right edge
        expect(cs.logicalToX(4)).toBe(700); // last bar, 1 bar-width from the edge
        expect(cs.logicalToX(0)).toBe(300);
    });

    it('inverts exactly (round-trip)', () => {
        const cs = setup();
        for (const L of [-3, 0, 2.5, 4, 7]) {
            expect(cs.xToLogical(cs.logicalToX(L))).toBeCloseTo(L, 9);
        }
        expect(cs.xToLogical(800)).toBe(5);
        expect(cs.xToLogical(300)).toBe(0);
        expect(cs.xToLogical(0)).toBe(-3);
    });

    it('reports the visible logical range from the pixel edges', () => {
        const cs = setup();
        expect(cs.visibleLogicalRange()).toEqual({ from: -3, to: 5 });
    });
});

describe('native CoordinateSystem · spacing multiplier (pitch scale)', () => {
    it('defaults to 1 — pitch equals barSpacing and transforms are unchanged', () => {
        const cs = setup();
        expect(cs.spacingScale).toBe(1);
        expect(cs.pxPerBar()).toBe(100);
        expect(cs.bodySpacing()).toBe(100);
        expect(cs.logicalToX(4)).toBe(700); // identical to the base X-axis test
    });

    it('scales the center-to-center pitch (>1 spreads bars apart) while the right edge stays pinned', () => {
        const cs = setup();
        cs.setPitchScale(2);
        expect(cs.pxPerBar()).toBe(200); // 100 × 2
        expect(cs.logicalToX(5)).toBe(800); // right edge unmoved
        expect(cs.logicalToX(4)).toBe(600); // one bar in is now 2× further from the edge (was 700)
        expect(cs.logicalToX(3)).toBe(400);
    });

    it('xToLogical stays the exact inverse under a non-default multiplier (crosshair snaps at the wider step)', () => {
        const cs = setup();
        cs.setPitchScale(2.5);
        for (const L of [-3, 0, 2.5, 4, 7]) {
            expect(cs.xToLogical(cs.logicalToX(L))).toBeCloseTo(L, 9);
        }
        // A wider pitch means the same pixel span covers fewer bars → wider crosshair step.
        expect(cs.pxPerBar()).toBe(250);
    });

    it('keeps body width at the raw pitch for ≥1, and shrinks it to the tighter pitch for <1', () => {
        const cs = setup(); // barSpacing 100
        cs.setPitchScale(3);
        expect(cs.bodySpacing()).toBe(100); // spreading apart keeps body width, adds gap
        cs.setPitchScale(0.4);
        expect(cs.bodySpacing()).toBeCloseTo(40, 9); // tighter than normal → body shrinks to fit
        expect(cs.pxPerBar()).toBeCloseTo(40, 9);
    });

    it('guards against a non-positive multiplier (falls back to 1)', () => {
        const cs = setup();
        cs.setPitchScale(0);
        expect(cs.spacingScale).toBe(1);
        cs.setPitchScale(-2);
        expect(cs.spacingScale).toBe(1);
        cs.setPitchScale(Number.NaN);
        expect(cs.spacingScale).toBe(1);
    });
});

describe('native CoordinateSystem · latest-bar-off-screen predicate (scroll-to-realtime button)', () => {
    // The scroll-to-realtime button (and its Alt+Shift+→ shortcut) reveals exactly when the
    // most recent bar has scrolled off the right edge. The renderer's rule is `rightOffset < 0`;
    // this pins that rule to the actual pixel transform: the last bar sits past the right edge
    // iff rightOffset < 0, and lands back on/inside it once rightOffset ≥ 0.
    const latestBarX = (rightOffset: number) => {
        const cs = new CoordinateSystem();
        cs.setSize(800, 200, 1);
        cs.setBars([1000, 2000, 3000, 4000, 5000]); // 5 bars
        cs.setViewport({ barSpacing: 100, rightOffset });
        return cs.logicalToX(cs.barCount - 1); // pixel x of the latest bar
    };

    it('latest bar is off-screen (x > width) exactly when rightOffset < 0', () => {
        expect(latestBarX(-1)).toBeGreaterThan(800); // scrolled off → button shows
        expect(latestBarX(-0.001)).toBeGreaterThan(800);
        expect(latestBarX(0)).toBe(800); // exactly at the edge → not off-screen
        expect(latestBarX(6)).toBeLessThan(800); // default margin → well in view → button hidden
    });
});

describe('native CoordinateSystem · time ↔ logical', () => {
    it('maps bar times to logical indices, interpolating + extrapolating', () => {
        const cs = setup();
        expect(cs.timeToLogical(1000)).toBe(0);
        expect(cs.timeToLogical(5000)).toBe(4);
        expect(cs.timeToLogical(3000)).toBe(2);
        expect(cs.timeToLogical(2500)).toBeCloseTo(1.5, 9);
        expect(cs.timeToLogical(500)).toBeCloseTo(-0.5, 9); // before first bar
        expect(cs.timeToLogical(6000)).toBeCloseTo(5, 9); // after last bar
    });

    it('inverts logical back to time', () => {
        const cs = setup();
        expect(cs.logicalToTime(0)).toBe(1000);
        expect(cs.logicalToTime(4)).toBe(5000);
        expect(cs.logicalToTime(2)).toBe(3000);
        expect(cs.logicalToTime(-0.5)).toBeCloseTo(500, 6);
        expect(cs.logicalToTime(5)).toBeCloseTo(6000, 6);
        expect(cs.visibleTimeRange()).toEqual({ from: cs.logicalToTime(-3), to: 6000 });
    });
});

describe('native CoordinateSystem · appendBar (O(1) live append)', () => {
    it('grows the bar series without re-deriving the interval', () => {
        const cs = setup(); // 5 bars [1000..5000], interval 1000
        expect(cs.barCount).toBe(5);
        cs.appendBar(6000);
        expect(cs.barCount).toBe(6);
        expect(cs.logicalToTime(5)).toBe(6000); // new bar addressable
        expect(cs.barInterval).toBe(1000); // unchanged (no re-sort)
        expect(cs.timeToLogical(6000)).toBe(5);
    });

    it('lazily establishes the interval on a cold start (<2 bars)', () => {
        const cs = new CoordinateSystem();
        cs.setSize(800, 200, 1);
        cs.setBars([]);
        expect(cs.barInterval).toBe(0);
        cs.appendBar(1000);
        expect(cs.barCount).toBe(1);
        expect(cs.barInterval).toBe(0); // still unknown with one bar
        cs.appendBar(3000);
        expect(cs.barCount).toBe(2);
        expect(cs.barInterval).toBe(2000); // derived from the first real gap
    });
});

describe('native CoordinateSystem · price ↔ px + DPR', () => {
    it('maps price within a pane scale + bounds (inverted Y)', () => {
        const cs = setup();
        const scale = { min: 0, max: 10 };
        const bounds = { top: 0, height: 200 };
        expect(cs.priceToY(10, scale, bounds)).toBe(0); // max at top
        expect(cs.priceToY(0, scale, bounds)).toBe(200); // min at bottom
        expect(cs.priceToY(5, scale, bounds)).toBe(100);
        for (const p of [0, 2.5, 7.5, 10]) {
            expect(cs.yToPrice(cs.priceToY(p, scale, bounds), scale, bounds)).toBeCloseTo(p, 9);
        }
    });

    it('rounds media px to device px via DPR', () => {
        expect(setup(1).toBitmap(100)).toBe(100);
        expect(setup(1.25).toBitmap(100)).toBe(125);
        expect(setup(1.5).toBitmap(101)).toBe(Math.round(101 * 1.5)); // 152
        expect(setup(2).toBitmap(100)).toBe(200);
    });

    it('maps price logarithmically when scale.log is set', () => {
        const cs = setup();
        const scale = { min: 10, max: 1000, log: true }; // 2 decades
        const bounds = { top: 0, height: 200 };
        expect(cs.priceToY(1000, scale, bounds)).toBe(0); // max at top
        expect(cs.priceToY(10, scale, bounds)).toBe(200); // min at bottom
        expect(cs.priceToY(100, scale, bounds)).toBeCloseTo(100, 9); // geometric mid → pixel mid
        for (const p of [10, 31.6, 100, 316, 1000]) {
            expect(cs.yToPrice(cs.priceToY(p, scale, bounds), scale, bounds)).toBeCloseTo(p, 6);
        }
    });

    it('falls back to linear when log scale has a non-positive min', () => {
        const cs = setup();
        const scale = { min: -5, max: 5, log: true };
        const bounds = { top: 0, height: 200 };
        expect(cs.priceToY(0, scale, bounds)).toBe(100); // linear midpoint, no NaN
    });
});
