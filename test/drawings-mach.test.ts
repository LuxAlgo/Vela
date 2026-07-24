import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    type MachFigure,
    type Projector,
    type Supersonic,
    type GoldenSonic,
    type GoldenSupersonic,
} from '../src/core/drawings';

const HR = 3600000;

/** Linear projector: x = time/hour, y = 100 − price. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x * HR, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 400,
        height: 200,
    };
}

describe('drawings/sonic', () => {
    const proj = fakeProjector();

    /** Horizontal diameter left→right: time 40→60 at price 50 → R=10, center (50, 50). */
    const make = (t1 = 40, t2 = 60) =>
        createDrawing('sonic', {
            paneId: 'price',
            anchors: [
                { time: t1 * HR, price: 50 },
                { time: t2 * HR, price: 50 },
            ],
            props: { waveCount: 4 },
        })! as MachFigure;

    it('sizes the first circle from the user-drawn diameter', () => {
        const d = make();
        // waveCount in props is read before levels default; sync enabled via applySettings
        d.applySettings({ waveCount: 4 });
        const g = d.geom(proj)!;
        expect(g.R).toBe(10);
        expect(g.circles[0]!.r).toBe(10);
        expect(g.circles[0]!.cx).toBeCloseTo(50);
        expect(d.editableLevels()).not.toBeNull();
    });

    it('expands circles from first click toward second click', () => {
        const d = make(40, 60);
        d.applySettings({ waveCount: 4 });
        const right = d.geom(proj)!;
        expect(right.fx).toBeCloseTo(1);
        expect(right.noseX).toBeCloseTo(40);
        expect(right.circles.length).toBe(4);
        expect(right.circles[1]!.cx).toBeGreaterThan(right.circles[0]!.cx);
        for (const c of right.circles) {
            expect(c.cx - c.r).toBeCloseTo(right.noseX);
        }
    });

    it('colors each circle from levels and exposes the gear panel', () => {
        const d = make();
        d.applySettings({ waveCount: 3 });
        d.levels[1]!.color = '#abcdef';
        const g = d.geom(proj)!;
        expect(g.circles.map((c) => c.color)).toEqual([d.levels[0]!.color, '#abcdef', d.levels[2]!.color]);
        expect(d.editableLevels()!.length).toBeGreaterThanOrEqual(3);
    });

    it('round-trips levels + waveCount through serialize', () => {
        const d = make();
        d.applySettings({ waveCount: 5 });
        d.levels[0]!.color = '#112233';
        const a = d.serialize();
        expect(a.type).toBe('sonic');
        const round = deserializeDrawing(a)! as MachFigure;
        expect(round.waveCount).toBe(5);
        expect(round.levels[0]!.color).toBe('#112233');
        expect(round.serialize()).toEqual(a);
    });

    it('reports only the diameter price span for autoscale', () => {
        const d = make();
        expect(d.priceRange()).toEqual({ min: 50, max: 50 });
    });
});

describe('drawings/supersonic', () => {
    const proj = fakeProjector();

    const make = (mach = 2) =>
        createDrawing('supersonic', {
            paneId: 'price',
            anchors: [
                { time: 40 * HR, price: 50 },
                { time: 60 * HR, price: 50 },
            ],
            props: { waveCount: 4, mach },
        })! as Supersonic;

    it('builds a Mach cone that opens toward the second click', () => {
        const d = make(2);
        d.applySettings({ waveCount: 4 });
        const g = d.geom(proj)!;
        expect(d.machNumber()).toBe(2);
        expect(g.noseX).toBeCloseTo(30);
        expect(g.rays).toHaveLength(2);
    });

    it('round-trips mach + levels', () => {
        const d = make(3);
        d.waveCount = 5;
        const a = d.serialize();
        expect(a.props).toMatchObject({ waveCount: 5, mach: 3 });
        const round = deserializeDrawing(a)! as Supersonic;
        expect(round.mach).toBe(3);
        expect(round.serialize()).toEqual(a);
    });
});

describe('drawings/golden sonic & supersonic', () => {
    const proj = fakeProjector();

    it('spaces Golden Sonic circles by Fibonacci ratios (including under 1)', () => {
        const d = createDrawing('goldensonic', {
            paneId: 'price',
            anchors: [
                { time: 40 * HR, price: 50 },
                { time: 60 * HR, price: 50 },
            ],
        })! as GoldenSonic;
        expect(d.type).toBe('goldensonic');
        const g = d.geom(proj)!;
        expect(g.circles.map((c) => +(c.r / g.R).toFixed(3))).toEqual([
            0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 4.236, 6.854, 11.09,
        ]);
        // Still a sonic wall (common crest)
        for (const c of g.circles) expect(c.cx - c.r).toBeCloseTo(g.noseX);
    });

    it('applies editable level ratios to circle radii', () => {
        const d = createDrawing('sonic', {
            paneId: 'price',
            anchors: [
                { time: 40 * HR, price: 50 },
                { time: 60 * HR, price: 50 },
            ],
            props: { waveCount: 2 },
        })! as MachFigure;
        d.applySettings({ waveCount: 2 });
        d.applySettings({ 'levels.1.ratio': 3.5 });
        const g = d.geom(proj)!;
        expect(g.circles).toHaveLength(2);
        expect(g.circles[1]!.ratio).toBe(3.5);
        expect(g.circles[1]!.r).toBeCloseTo(3.5 * g.R);
    });

    it('round-trips showRatios and defaults to on', () => {
        const d = createDrawing('sonic', {
            paneId: 'price',
            anchors: [
                { time: 40 * HR, price: 50 },
                { time: 60 * HR, price: 50 },
            ],
        })! as MachFigure;
        expect(d.showRatios).toBe(true);
        d.applySettings({ showRatios: false });
        const round = deserializeDrawing(d.serialize())! as MachFigure;
        expect(round.showRatios).toBe(false);
    });

    it('Golden Supersonic uses fib spacing with a cone envelope', () => {
        const d = createDrawing('goldensupersonic', {
            paneId: 'price',
            anchors: [
                { time: 40 * HR, price: 50 },
                { time: 60 * HR, price: 50 },
            ],
            props: { mach: 2 },
        })! as GoldenSupersonic;
        const g = d.geom(proj)!;
        expect(d.machNumber()).toBe(2);
        expect(g.rays).toHaveLength(2);
        expect(g.circles.length).toBe(11);
        expect(g.circles.find((c) => c.ratio === 1.618)!.r / g.R).toBeCloseTo(1.618);
        expect(g.circles[0]!.ratio).toBe(0.236);
        const a = d.serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
    });
});
