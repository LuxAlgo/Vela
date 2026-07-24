import { describe, it, expect } from 'vitest';
import { createDrawing, deserializeDrawing, DrawingStore, FibLevels, FibFan, FibTimeZones, type Projector } from '../src/core/drawings';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
function fakeProjector(): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        width: 200,
        height: 100,
    };
}

describe('drawings/FibRetracement', () => {
    const proj = fakeProjector();
    // anchors (0,0) → (50,100): price range 0..100, so a level's price = ratio·100
    const make = () => createDrawing('fibretracement', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 100 }] })!;

    it('places a horizontal level at each fib ratio of the price range', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(2);
        const lines = (d as FibLevels).levelLines(proj)!;
        const priceAt = (ratio: number) => lines.find((l) => l.ratio === ratio)?.price;
        expect(priceAt(0)).toBe(0);
        expect(priceAt(0.5)).toBe(50);
        expect(priceAt(0.618)).toBeCloseTo(61.8, 6);
        expect(priceAt(1)).toBe(100);
    });

    it('hit-tests on a level line, not in the gap; reports the full price range', () => {
        const d = make();
        expect(d.hitTest(25, 50, proj, 4)).toBe(true); // the 0.5 level (price 50 → y 50), x 0..50
        expect(d.hitTest(25, 35, proj, 2)).toBe(false); // between levels
        expect(d.hitTest(120, 50, proj, 4)).toBe(false); // past the level's right end
        expect(d.priceRange()).toEqual({ min: 0, max: 100 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('fibretracement');
    });

    it('exposes editable levels; disabling one drops it from the rendered lines', () => {
        const d = make();
        const levels = d.editableLevels()!;
        expect(levels.length).toBe(7);
        const i = levels.findIndex((l) => l.ratio === 0.5);
        d.applySettings({ [`levels.${i}.enabled`]: false }); // toggle the 0.5 level off
        const lines = (d as FibLevels).levelLines(proj)!;
        expect(lines.some((l) => l.ratio === 0.5)).toBe(false);
        expect(lines.length).toBe(6);
    });

    it('per-level color + label round-trip through serialize (props)', () => {
        const d = make();
        d.applySettings({ 'levels.1.color': '#abcdef', 'levels.1.label': 'support' });
        const doc = d.serialize();
        const persisted = doc.props!.levels as Array<{ color: string; label?: string }>;
        expect(persisted[1]!.color).toBe('#abcdef');
        const back = deserializeDrawing(doc)!;
        expect(back.editableLevels()![1]!.color).toBe('#abcdef');
        expect(back.editableLevels()![1]!.label).toBe('support');
    });

    it('numbers + labels font sizes default and round-trip via props', () => {
        const d = make() as FibLevels;
        expect(d.numbersSize).toBe('small');
        expect(d.labelsSize).toBe('normal');
        d.applySettings({ numbersSize: 'large', labelsSize: 'huge' }); // the bar buttons emit these
        const doc = d.serialize();
        expect(doc.props!.numbersSize).toBe('large');
        expect(doc.props!.labelsSize).toBe('huge');
        expect((deserializeDrawing(doc) as FibLevels).numbersSize).toBe('large');
    });

    it('store.update applies a props (levels) patch to the live drawing', () => {
        const store = new DrawingStore();
        const d = store.add(createDrawing('fibretracement', { id: store.nextId(), paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 100 }] })!);
        const doc = d.serialize();
        (doc.props!.levels as Array<{ color: string }>)[0]!.color = '#123456';
        store.update(d.id, { props: doc.props });
        expect((d as FibLevels).levels[0]!.color).toBe('#123456');
    });
});

describe('drawings/FibExtension', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('fibextension', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 100 }] })!;

    it('projects levels beyond the swing (ratio > 1)', () => {
        const d = make();
        const lines = (d as FibLevels).levelLines(proj)!;
        expect(lines.find((l) => l.ratio === 1.618)?.price).toBeCloseTo(161.8, 6); // past p2 (price 100)
        expect(d.priceRange()!.max).toBeCloseTo(261.8, 6); // the 2.618 level expands autoscale
    });
});

describe('drawings/FibFan', () => {
    const proj = fakeProjector();
    // p0 (0,0) → p1 (50,100): rays from p0 through the fib-divided prices at time 50
    const make = () => createDrawing('fibfan', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 100 }] })!;

    it('draws a ray per fib ratio from p0; 2/2 schema; price range = anchors', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(2);
        expect((d as FibFan).fanLines(proj)!.length).toBe(6);
        expect(d.hitTest(25, 75, proj, 4)).toBe(true); // on the 0.5 ray (y = 100 − x)
        expect(d.hitTest(25, 20, proj, 4)).toBe(false); // below every ray
        expect(d.priceRange()).toEqual({ min: 0, max: 100 });
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('fibfan');
    });
});

describe('drawings/FibExtensionTrend', () => {
    const proj = fakeProjector();
    // A(0,0) B(10,50) C(20,100): move = B−A = 50; level price = C.price + ratio·50
    const make = () => createDrawing('fibextensiontrend', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 10, price: 50 }, { time: 20, price: 100 }] })!;

    it('projects the A→B move from C across three anchors', () => {
        const d = make();
        expect(d.anchorSchema().min).toBe(3);
        expect(d.editableLevels()!.length).toBe(7);
        const pr = d.priceRange()!;
        expect(pr.min).toBe(0); // includes anchor A
        expect(pr.max).toBeCloseTo(230.9, 1); // the 2.618 level: 100 + 2.618·50
    });

    it('round-trips through serialize', () => {
        const a = make().serialize();
        expect(deserializeDrawing(a)!.serialize()).toEqual(a);
        expect(a.type).toBe('fibextensiontrend');
    });
});

describe('drawings/Fib fan + time zones are now configurable (gear)', () => {
    const proj = fakeProjector();

    it('fan: editable levels; disabling one drops its ray; color round-trips', () => {
        const d = createDrawing('fibfan', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 100 }] })!;
        expect(d.editableLevels()!.length).toBe(6);
        const i = d.editableLevels()!.findIndex((l) => l.ratio === 0.5);
        d.applySettings({ [`levels.${i}.enabled`]: false });
        expect((d as FibFan).fanLines(proj)!.some((l) => l.ratio === 0.5)).toBe(false);
        d.applySettings({ 'levels.0.color': '#abcdef' });
        expect((d.serialize().props!.levels as Array<{ color: string }>)[0]!.color).toBe('#abcdef');
    });

    it('time zones: editable levels; disabling one drops its line', () => {
        const d = createDrawing('fibtimezones', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 10, price: 50 }] })!;
        expect(d.editableLevels()!.length).toBe(9);
        const i = d.editableLevels()!.findIndex((l) => l.ratio === 8);
        d.applySettings({ [`levels.${i}.enabled`]: false });
        expect((d as FibTimeZones).zoneLines(proj)!.some((l) => l.n === 8)).toBe(false);
    });
});

describe('drawings/FibTimeZones', () => {
    const proj = fakeProjector();
    // base interval 10 (time 0 → 10): vertical lines at n·10 for n in the fib sequence
    const make = () => createDrawing('fibtimezones', { paneId: 'price', anchors: [{ time: 0, price: 50 }, { time: 10, price: 50 }] })!;

    it('places vertical lines at fib multiples of the base interval', () => {
        const d = make();
        const lines = (d as FibTimeZones).zoneLines(proj)!;
        expect(lines.map((l) => l.n)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34]);
        expect(lines.find((l) => l.n === 5)?.x).toBe(50); // time 50 → x 50
    });

    it('hit-tests near a vertical line; imposes no price/time constraint', () => {
        const d = make();
        expect(d.hitTest(30, 40, proj, 3)).toBe(true); // on the n=3 line (x 30)
        expect(d.hitTest(45, 40, proj, 3)).toBe(false); // between the n=3 (30) and n=5 (50) lines
        expect(d.priceRange()).toBeNull();
        expect(d.timeExtent()).toBeNull();
    });
});
