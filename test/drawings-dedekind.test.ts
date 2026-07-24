import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    isDedekindCenter,
    dedekindCentersInUnit,
    type DedekindTessellation,
    type Projector,
} from '../src/core/drawings';

const HR = 3600000;

/** Linear projector: x = time/hour, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

describe('drawings/dedekind — Kocik centers', () => {
    it('matches the algebraic characterization for known curvatures', () => {
        expect(dedekindCentersInUnit(1)).toEqual([0]);
        expect(dedekindCentersInUnit(3)).toEqual([1, 2]);
        expect(dedekindCentersInUnit(8)).toEqual([3, 5]);
        expect(dedekindCentersInUnit(72)).toEqual([19, 35, 37, 53]);
        expect(isDedekindCenter(1, 2)).toBe(false); // n=2 is neither odd nor a multiple of 8
        expect(isDedekindCenter(0, 1)).toBe(true);
    });
});

describe('drawings/dedekind tessellation', () => {
    const proj = fakeProjector();

    const make = (maxCurvature = 8) =>
        createDrawing('dedekind', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 40 },
                { time: 40 * HR, price: 80 },
            ],
            props: { maxCurvature },
        })! as DedekindTessellation;

    it('places with two corners; maps the box with unit semicircle reaching the top', () => {
        const d = make();
        expect(d.anchorSchema()).toEqual({
            min: 2,
            max: 2,
            slots: [
                { role: 'c1', free: 'both' },
                { role: 'c2', free: 'both' },
            ],
        });
        expect(d.placementMode()).toBe('click');
        const box = d.box(proj)!;
        // price 40→80 → y 60→20; time 0→40h → x 0→40; height 40 → unitPx 40; realSpan = 1
        expect(box.left).toBe(0);
        expect(box.right).toBe(40);
        expect(box.top).toBe(20);
        expect(box.bot).toBe(60);
        expect(box.unitPx).toBe(40);
        expect(box.realSpan).toBe(1);
    });

    it('emits verticals at half-integers and Dedekind semicircles up to maxCurvature', () => {
        const d = make(8);
        const geoms = d.geodesics(proj)!;
        const arcs = geoms.filter((g) => g.kind === 'arc');
        const vlines = geoms.filter((g) => g.kind === 'vline');
        expect(vlines.length).toBeGreaterThan(0);
        expect(arcs.length).toBeGreaterThan(0);
        // Unit semicircle (n=1, k=0) at center 0: cx = left + (0-0)*unitPx = 0, r = unitPx
        const unit = arcs.find((g) => g.kind === 'arc' && g.r === 40 && Math.abs(g.cx - 0) < 1e-6);
        expect(unit).toBeTruthy();
        // Denser maxCurvature yields more arcs
        const denser = make(24).geodesics(proj)!.filter((g) => g.kind === 'arc');
        expect(denser.length).toBeGreaterThan(arcs.length);
    });

    it('is grabbable inside the box and reports its price range', () => {
        const d = make();
        expect(d.hitTest(20, 40, proj, 4)).toBe(true);
        expect(d.hitTest(20, 90, proj, 4)).toBe(false);
        expect(d.priceRange()).toEqual({ min: 40, max: 80 });
    });

    it('round-trips maxCurvature through serialize', () => {
        const d = make(32);
        d.maxCurvature = 48;
        const a = d.serialize();
        expect(a.type).toBe('dedekind');
        expect(a.props).toEqual({ maxCurvature: 48 });
        const round = deserializeDrawing(a)! as DedekindTessellation;
        expect(round.serialize()).toEqual(a);
        expect(round.maxCurvature).toBe(48);
    });
});
