import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    resetDrawingSettings,
    DEFAULT_DRAWING_COLOR,
    DrawingStore,
    migrate,
    distToSegment,
    pointInBox,
    pointInCircle,
    handleAt,
    extendRay,
    FibRetracement,
    type Projector,
    type SerializedDrawing,
} from '../src/core/drawings';
/** A trivial linear projector: x = time, y = 100 − price, single pane 'price'. */
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

describe('drawings/hittest', () => {
    it('distToSegment: on-segment is 0, off-segment is the perpendicular distance', () => {
        expect(distToSegment(25, 75, 0, 100, 50, 50)).toBeCloseTo(0, 6);
        expect(distToSegment(25, 85, 0, 100, 50, 50)).toBeCloseTo(10 / Math.SQRT2, 4);
    });
    it('distToSegment: clamps past the endpoints', () => {
        expect(distToSegment(-10, 0, 0, 0, 10, 0)).toBe(10); // left of A
    });
    it('pointInBox respects padding + ordering', () => {
        expect(pointInBox(5, 5, 0, 0, 10, 10)).toBe(true);
        expect(pointInBox(12, 5, 0, 0, 10, 10)).toBe(false);
        expect(pointInBox(12, 5, 10, 10, 0, 0, 3)).toBe(true); // reversed corners + pad
    });
    it('pointInCircle + handleAt', () => {
        expect(pointInCircle(3, 4, 0, 0, 5)).toBe(true);
        expect(pointInCircle(3, 4, 0, 0, 4)).toBe(false);
        expect(handleAt(10, 10, [[0, 0], [10, 11]], 6)).toBe(1);
        expect(handleAt(50, 50, [[0, 0], [10, 11]], 6)).toBe(-1);
    });
    it('extendRay: right extension reaches the chart edge', () => {
        const [, , ex] = extendRay(0, 0, 10, 10, 'right', 200, 100);
        expect(ex).toBe(202); // width + 2
    });
});

describe('drawings/TrendLine', () => {
    const proj = fakeProjector();
    const make = () =>
        createDrawing('trendline', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }] })!;

    it('has a 2/2 anchor schema with both axes free', () => {
        const s = make().anchorSchema();
        expect(s.min).toBe(2);
        expect(s.max).toBe(2);
        expect(s.slots.map((x) => x.free)).toEqual(['both', 'both']);
    });
    it('hit-tests against the projected segment', () => {
        const d = make();
        expect(d.hitTest(25, 75, proj, 5)).toBe(true);
        expect(d.hitTest(25, 90, proj, 5)).toBe(false);
    });
    it('reports its price range + handle points', () => {
        const d = make();
        expect(d.priceRange()).toEqual({ min: 0, max: 50 });
        expect(d.handlePoints(proj)).toEqual([[0, 100], [50, 50]]);
        expect(d.hitHandle(0, 100, proj, 4)).toBe(0);
    });
});

describe('drawings/HorizontalLine', () => {
    const proj = fakeProjector();
    const make = () => createDrawing('hline', { paneId: 'price', anchors: [{ time: 10, price: 30 }] })!;

    it('spans the full width (x is ignored)', () => {
        const d = make();
        expect(d.hitTest(0, 70, proj, 5)).toBe(true);
        expect(d.hitTest(195, 70, proj, 5)).toBe(true);
        expect(d.hitTest(50, 80, proj, 5)).toBe(false);
    });
    it('bounds the full plot width at its price', () => {
        const b = make().bounds(proj);
        expect(b).toEqual({ x: 0, y: 69, w: 200, h: 2 });
    });
});

describe('drawings/timeExtent (autoscale culling)', () => {
    it('a trend line reports its anchor time span; a horizontal line spans all time (null)', () => {
        const tl = createDrawing('trendline', { paneId: 'price', anchors: [{ time: 100, price: 1 }, { time: 300, price: 2 }] })!;
        expect(tl.timeExtent()).toEqual({ min: 100, max: 300 });
        const hl = createDrawing('hline', { paneId: 'price', anchors: [{ time: 200, price: 5 }] })!;
        expect(hl.timeExtent()).toBeNull(); // full-width → never culls
    });
});

describe('drawings/Ray Box TextLabel', () => {
    const proj = fakeProjector();
    it('Ray extends to the right edge for hit-testing', () => {
        const r = createDrawing('ray', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }] })!;
        expect(r.hitTest(100, 0, proj, 5)).toBe(true); // on the extended ray (y = 100 - x)
        expect(r.priceRange()).toEqual({ min: 0, max: 50 });
    });
    it('Box is grabbable inside when filled + reports its price span', () => {
        const b = createDrawing('box', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 50, price: 50 }] })!;
        expect(b.style.fillColor).toBeTruthy(); // default fill
        expect(b.hitTest(25, 75, proj, 5)).toBe(true); // inside the filled rect
        expect(b.priceRange()).toEqual({ min: 0, max: 50 });
        expect(b.handlePoints(proj)).toEqual([[0, 100], [50, 50]]);
    });
    it('TextLabel starts empty (typed inline) with an approximate hit box', () => {
        const t = createDrawing('text', { paneId: 'price', anchors: [{ time: 10, price: 50 }] })!;
        expect(t.text?.value).toBe(''); // no seeded literal — the inline editor's placeholder invites the text
        expect(t.text?.size).toBe('large'); // reads at a glance without reaching for the size control
        expect(t.hitTest(20, 60, proj, 5)).toBe(true);
        expect(t.hitTest(400, 400, proj, 5)).toBe(false);
        // round-trips the text block
        t.applySettings({ 'text.value': 'Buy zone' });
        expect(deserializeDrawing(t.serialize())!.serialize().text?.value).toBe('Buy zone');
    });
});

describe('drawings/text on every type', () => {
    it('every drawing type exposes text fields (value/color/size/bold/italic)', () => {
        for (const type of ['trendline', 'hline', 'ray', 'box', 'text'] as const) {
            const d = createDrawing(type, { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })!;
            const paths = d.schema().fields.map((f) => f.path);
            expect(paths).toEqual(expect.arrayContaining(['text.value', 'text.color', 'text.size', 'text.bold', 'text.italic']));
        }
    });
    it('annotations whose text IS the drawing declare it, shapes that merely carry a label do not', () => {
        // Drives where the popup puts the text controls: on the bar, or under the label field.
        for (const type of ['text', 'note', 'callout', 'comment', 'signpost'] as const) {
            const d = createDrawing(type, { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })!;
            expect(d.schema().textIsContent).toBe(true);
        }
        for (const type of ['trendline', 'hline', 'ray', 'box'] as const) {
            const d = createDrawing(type, { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })!;
            expect(d.schema().textIsContent).toBeFalsy();
        }
    });
    it('setting text on a line lazily creates a well-formed text block', () => {
        const d = createDrawing('trendline', { paneId: 'price', anchors: [{ time: 0, price: 1 }, { time: 1, price: 2 }] })!;
        expect(d.text).toBeUndefined();
        d.applySettings({ 'text.value': 'support', 'text.bold': true });
        expect(d.text?.value).toBe('support');
        expect(d.text?.bold).toBe(true);
        expect(d.text?.size).toBe('normal'); // defaults filled in
    });
});

describe('drawings/applySettings (dot-path)', () => {
    it('sets nested style + lazily creates text + toggles behavior', () => {
        const d = createDrawing('trendline', { paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] })!;
        d.applySettings({ 'style.lineColor': '#ff0000', 'style.lineWidth': 4 });
        expect(d.style.lineColor).toBe('#ff0000');
        expect(d.style.lineWidth).toBe(4);
        expect(d.text).toBeUndefined();
        d.applySettings({ 'text.value': 'hello' });
        expect(d.text?.value).toBe('hello');
        expect(d.text?.size).toBe('normal'); // defaults filled in
        d.applySettings({ locked: true });
        expect(d.locked).toBe(true);
    });
    it('ignores unknown paths without throwing', () => {
        const d = createDrawing('hline', { paneId: 'price', anchors: [{ time: 0, price: 1 }] })!;
        expect(() => d.applySettings({ 'nope.deep.path': 1 })).not.toThrow();
    });
});

describe('drawings/resetDrawingSettings', () => {
    it('restores style defaults without touching anchors, lock, or id', () => {
        const d = createDrawing('trendline', {
            id: 'dw-reset',
            paneId: 'price',
            anchors: [{ time: 10, price: 20 }, { time: 30, price: 40 }],
        })!;
        const anchors = d.anchors.map((a) => ({ ...a }));
        d.applySettings({ 'style.lineColor': '#ff0000', 'style.lineWidth': 4, 'style.lineStyle': 'dotted' });
        d.locked = true;
        resetDrawingSettings(d);
        expect(d.id).toBe('dw-reset');
        expect(d.locked).toBe(true);
        expect(d.anchors).toEqual(anchors);
        expect(d.style.lineColor).toBe(DEFAULT_DRAWING_COLOR);
        expect(d.style.lineWidth).toBe(2);
        expect(d.style.lineStyle).toBe('solid');
    });

    it('restores type extras (fib levels) and clears custom text styling', () => {
        const d = createDrawing('fibretracement', {
            paneId: 'price',
            anchors: [{ time: 10, price: 100 }, { time: 50, price: 50 }],
        })! as FibRetracement;
        const defaultLevels = d.levels.map((l) => ({ ...l }));
        d.applySettings({ 'style.lineWidth': 4, numbersSize: 'huge', 'levels.0.enabled': false, 'text.color': '#abcdef' });
        expect(d.levels[0]!.enabled).toBe(false);
        expect(d.text?.color).toBe('#abcdef');
        resetDrawingSettings(d);
        expect(d.style.lineWidth).toBe(1);
        expect(d.numbersSize).toBe('small');
        expect(d.levels).toEqual(defaultLevels);
        expect(d.text).toBeUndefined();
    });

    it('keeps typed text content while restoring text cosmetics', () => {
        const d = createDrawing('text', { paneId: 'price', anchors: [{ time: 1, price: 2 }] })!;
        d.applySettings({ 'text.value': 'Buy zone', 'text.color': '#ff0000', 'text.size': 'huge', 'text.bold': true });
        resetDrawingSettings(d);
        expect(d.text?.value).toBe('Buy zone');
        expect(d.text?.color).toBeUndefined();
        expect(d.text?.size).toBe('large'); // back to the type's own default, not the global one
        expect(d.text?.bold).toBeUndefined();
    });

    it('store write-back replaces style so reset can drop extra keys', () => {
        const store = new DrawingStore();
        const d = store.add(
            createDrawing('box', {
                id: 'dw-box',
                paneId: 'price',
                anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }],
                style: { lineColor: '#ff0000', lineWidth: 4, lineStyle: 'dotted', fillColor: '#00ff00' },
            })!,
        );
        resetDrawingSettings(d);
        store.update(d.id, d.serialize());
        const live = store.get(d.id)!;
        expect(live.style.lineColor).toBe(DEFAULT_DRAWING_COLOR);
        expect(live.style.lineWidth).toBe(1);
        expect(live.style.lineStyle).toBe('solid');
        expect(live.style.fillColor).toBe(`${DEFAULT_DRAWING_COLOR}26`);
    });
});

describe('drawings/serialize round-trip', () => {
    it('survives serialize → deserialize → serialize unchanged', () => {
        const d = createDrawing('trendline', {
            id: 'dw-7',
            paneId: 'price',
            anchors: [{ time: 100, price: 25000 }, { time: 200, price: 26000 }],
            style: { lineColor: '#abc', lineWidth: 3, lineStyle: 'dotted' },
            locked: true,
            visible: false,
            zIndex: 5,
        })!;
        const a = d.serialize();
        const b = deserializeDrawing(a)!.serialize();
        expect(b).toEqual(a);
        expect(a.id).toBe('dw-7');
        expect(a.type).toBe('trendline');
    });
});

describe('drawings/DrawingStore', () => {
    const tl = (id?: string) =>
        createDrawing('trendline', { id, paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] })!;

    it('adds in mount-order z and re-orders with bringToFront/sendToBack', () => {
        const s = new DrawingStore();
        const a = s.add(tl(s.nextId()));
        const b = s.add(tl(s.nextId()));
        expect(s.all().map((d) => d.id)).toEqual([a.id, b.id]);
        s.bringToFront(a.id);
        expect(s.all().map((d) => d.id)).toEqual([b.id, a.id]);
        s.sendToBack(a.id);
        expect(s.all()[0]!.id).toBe(a.id);
    });

    it('fires onChange on mutation', () => {
        const s = new DrawingStore();
        let n = 0;
        s.onChange(() => (n += 1));
        const d = s.add(tl(s.nextId()));
        s.update(d.id, { style: { lineColor: '#0f0', lineWidth: 2, lineStyle: 'solid' } });
        s.setLocked(d.id, true);
        s.remove(d.id);
        expect(n).toBe(4);
        expect(s.has(d.id)).toBe(false);
    });

    it('serialize → load round-trips and keeps nextId() collision-free', () => {
        const s = new DrawingStore();
        s.add(tl(s.nextId()));
        s.add(tl(s.nextId()));
        const doc = s.serialize();
        const s2 = new DrawingStore();
        s2.load(doc);
        expect(s2.all().map((d) => d.id)).toEqual(['dw-1', 'dw-2']);
        expect(s2.nextId()).toBe('dw-3'); // past the loaded ids
    });

    it('byPane filters by pane', () => {
        const s = new DrawingStore();
        s.add(tl(s.nextId()));
        s.add(createDrawing('hline', { id: s.nextId(), paneId: 'volume', anchors: [{ time: 0, price: 1 }] })!);
        expect(s.byPane('price').length).toBe(1);
        expect(s.byPane('volume').length).toBe(1);
    });
});

describe('drawings/migrate', () => {
    it('returns an empty doc for malformed / wrong-version input', () => {
        expect(migrate(null)).toEqual({ version: 1, drawings: [] });
        expect(migrate({ version: 2, drawings: [] })).toEqual({ version: 1, drawings: [] });
        expect(migrate('garbage')).toEqual({ version: 1, drawings: [] });
    });
    it('drops malformed entries but keeps valid ones', () => {
        const good: SerializedDrawing = {
            id: 'dw-1',
            type: 'hline',
            paneId: 'price',
            anchors: [{ time: 0, price: 1 }],
            style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' },
            locked: false,
            visible: true,
            zIndex: 1,
            createdAt: 0,
        };
        const doc = migrate({ version: 1, drawings: [good, { id: 'x' }, null, { ...good, anchors: 'no' }] });
        expect(doc.drawings.length).toBe(1);
        expect(doc.drawings[0]!.id).toBe('dw-1');
    });
});
