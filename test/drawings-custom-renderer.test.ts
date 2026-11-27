// @vitest-environment jsdom
// The native renderer's side of custom drawing tools: what the drawings controller does with
// a type it knows nothing about beyond its hooks (snap targets, hover parts, clicks, values,
// autoscale, results carried across a re-sync).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DARK_THEME } from '../src/core/theme';
import {
    createDrawing,
    defineDrawing,
    lineValueAt,
    type DrawingDefinition,
    type DrawingIntent,
    type Projector,
    type SerializedDrawing,
    type ShapeBar,
} from '../src/core/drawings';
import { UserDrawingController, type UserDrawingDeps } from '../src/renderers/native/drawings/UserDrawingController';
import { paintShapes } from '../src/renderers/native/drawings/ShapePainter';

// jsdom has no canvas: the controller then paints nothing, which is all these tests need
// (they read what it decides, not what it draws).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
    document.body.innerHTML = '';
});
function define<P extends object, S>(def: DrawingDefinition<P, S>): void {
    cleanup.push(defineDrawing(def));
}

const BARS: ShapeBar[] = Array.from({ length: 20 }, (_, i) => ({ time: i * 10, open: 50, high: 55, low: 45, close: 50, volume: 1 }));

/** Linear projector: x = time, y = 100 − price, one pane 'price'. */
function projector(barsKey = '20|0|190|1|a'): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        paneRect: () => ({ top: 0, height: 100 }),
        barsInRange: (from, to) => BARS.filter((b) => b.time >= from && b.time <= to),
        barsKey,
        width: 200,
        height: 100,
    };
}

function mount(over: Partial<UserDrawingDeps> = {}) {
    const toolbarHost = document.createElement('div');
    const overlayHost = document.createElement('div');
    const canvas = document.createElement('canvas');
    document.body.append(toolbarHost, overlayHost, canvas);
    const intents: DrawingIntent[] = [];
    const deps: UserDrawingDeps = {
        projector: () => projector(),
        dpr: () => 1,
        theme: () => DARK_THEME,
        requestScaleUpdate: () => {},
        seriesBoundaries: () => [],
        priceZ: () => null,
        requestDataPaint: () => {},
        seriesLook: () => ({ style: 'candles', upColor: '#0f0', downColor: '#f00', lineColor: '#0f0' }),
        chartBarMs: () => 10,
        // The candle magnet of this harness: the nearest multiple of 10 on both axes.
        snap: (pt, _pane, mode) => (mode === 'off' ? pt : { time: Math.round(pt.time / 10) * 10, price: Math.round(pt.price / 10) * 10 }),
        setSnapMode: () => {},
        setToolbarGutter: () => {},
        ...over,
    };
    const ctrl = new UserDrawingController(toolbarHost, overlayHost, canvas, deps);
    ctrl.onDrawingIntent((i) => intents.push(i));
    cleanup.push(() => ctrl.destroy());
    const sync = (...drawings: Array<{ serialize(): SerializedDrawing } | null>): void => ctrl.syncDrawings(drawings.map((d) => d!.serialize()));
    return { ctrl, intents, sync };
}

const of = <K extends DrawingIntent['kind']>(intents: DrawingIntent[], kind: K) => intents.filter((i): i is Extract<DrawingIntent, { kind: K }> => i.kind === kind);

describe('custom drawings in the native renderer', () => {
    it('keeps a drawing of an unregistered type on the chart, selectable', () => {
        const { ctrl } = mount();
        const doc: SerializedDrawing = { id: 'dw-1', type: 'acme.absent', paneId: 'price', anchors: [{ time: 20, price: 80 }, { time: 120, price: 30 }], style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' }, locked: false, visible: true, zIndex: 1, createdAt: 0 };
        ctrl.syncDrawings([doc]);
        expect(ctrl.drawingAt(70, 45)).toEqual({ id: 'dw-1', part: null }); // on the placeholder's outline
    });

    it('reports the part under the pointer, its cursor, and a change of part', () => {
        define({
            type: 'test.parts',
            label: 'Parts',
            shapes: () => [
                { kind: 'rect', from: [10, 10], to: [60, 60], fill: '#000', part: 'left', cursor: 'grab', tip: 'Left half' },
                { kind: 'rect', from: [60, 10], to: [110, 60], fill: '#000', part: 'right' },
            ],
        });
        const { ctrl, intents, sync } = mount();
        sync(createDrawing('test.parts', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        ctrl.pointerMove(30, 30);
        expect(ctrl.hoveredDrawing()).toEqual({ id: 'a', part: 'left' });
        expect(ctrl.cursorAt(30, 30)).toBe('grab');
        ctrl.pointerMove(90, 30);
        expect(ctrl.cursorAt(90, 30)).toBe('pointer'); // this part names no cursor of its own
        ctrl.pointerMove(150, 90);
        expect(of(intents, 'hover').map((i) => [i.id, i.part])).toEqual([
            ['a', 'left'],
            ['a', 'right'],
            [null, null],
        ]);
    });

    it('tells a click from a drag, with the part and the data point, and lets the drawing act on it', () => {
        define({
            type: 'test.toggle',
            label: 'Toggle',
            props: { on: false },
            shapes: () => [{ kind: 'rect', from: [10, 10], to: [60, 60], fill: '#000', part: 'switch' }],
            click: (part, d) => (part === 'switch' ? { on: !d.props.on } : undefined),
        });
        const { ctrl, intents, sync } = mount();
        sync(createDrawing('test.toggle', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        ctrl.pointerDown(30, 40);
        ctrl.pointerUp(30, 40);
        expect(of(intents, 'click')).toEqual([{ kind: 'click', id: 'a', part: 'switch', time: 30, price: 60 }]);
        // The click changed the drawing: it is saved as an edit, and no settings bar opened.
        expect(of(intents, 'edit')[0]!.doc.props).toEqual({ on: true });
        expect(of(intents, 'settings')).toEqual([]);
    });

    it('opens the settings bar on a click the drawing does not handle', () => {
        define({ type: 'test.plain', label: 'Plain', shapes: () => [{ kind: 'rect', from: [10, 10], to: [60, 60], fill: '#000' }] });
        const { ctrl, intents, sync } = mount();
        sync(createDrawing('test.plain', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        ctrl.pointerDown(30, 40);
        ctrl.pointerUp(30, 40);
        expect(of(intents, 'click')).toHaveLength(1);
        expect(of(intents, 'settings').map((i) => i.id)).toEqual(['a']);
    });

    it('snaps to a host source and to the points another drawing offers, from close by only', () => {
        define({ type: 'test.levels', label: 'Levels', shapes: () => [], snapTargets: () => [{ price: 33 }] });
        const { ctrl, intents, sync } = mount();
        sync(createDrawing('test.levels', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        ctrl.setSnapSources([() => [{ time: 77, price: 61 }]]);
        const place = (x: number, y: number): { time: number; price: number } => {
            ctrl.setActiveTool('hline');
            ctrl.pointerDown(x, y, 'weak');
            ctrl.pointerUp(x, y, 'weak');
            const created = of(intents, 'create');
            return created[created.length - 1]!.doc.anchors[0]!;
        };
        // Near the host's point (77, 61 → y 39): the point takes both axes.
        expect(place(75, 41)).toEqual({ time: 77, price: 61 });
        // Near the other drawing's level (33 → y 67): the price snaps, the time stays the magnet's.
        expect(place(142, 65)).toEqual({ time: 140, price: 33 });
        // Away from both: the candle magnet alone decides.
        expect(place(142, 8)).toEqual({ time: 140, price: 90 });
        // With the magnet off nothing snaps.
        ctrl.setActiveTool('hline');
        ctrl.pointerDown(75, 41, 'off');
        const created = of(intents, 'create');
        expect(created[created.length - 1]!.doc.anchors[0]).toEqual({ time: 75, price: 59 });
    });

    it('widens the scale only for a drawing that asks for it', () => {
        define({ type: 'test.scaled', label: 'Scaled', autoscale: true, shapes: () => [] });
        define({ type: 'test.unscaled', label: 'Unscaled', shapes: () => [] });
        const { ctrl, sync } = mount();
        const anchors = [{ time: 20, price: 80 }, { time: 120, price: 30 }];
        sync(createDrawing('test.unscaled', { id: 'a', paneId: 'price', anchors }), createDrawing('trendline', { id: 'b', paneId: 'price', anchors }));
        expect(ctrl.autoscaleRangeForPane('price', 0, 200)).toBeNull();
        // What the drawings span is another question, and its answer has not changed.
        expect(ctrl.priceRangeForPane('price', 0, 200)).toEqual({ min: 30, max: 80 });
        sync(createDrawing('test.scaled', { id: 'c', paneId: 'price', anchors }));
        expect(ctrl.autoscaleRangeForPane('price', 0, 200)).toEqual({ min: 30, max: 80 });
        expect(ctrl.autoscaleRangeForPane('price', 300, 400)).toBeNull(); // out of view in time
        expect(ctrl.autoscaleRangeForPane('other', 0, 200)).toBeNull();
    });

    it('leaves a range that is not two numbers out of the scale', () => {
        define({ type: 'test.badrange', label: 'Bad range', autoscale: true, shapes: () => [], priceRange: () => ({ min: 0, max: Infinity }) });
        const { ctrl, sync } = mount();
        sync(createDrawing('test.badrange', { id: 'a', paneId: 'price', anchors: [{ time: 20, price: 80 }] }));
        expect(ctrl.autoscaleRangeForPane('price', 0, 200)).toBeNull();
    });

    it('ignores a snap target that is not a number, and a source that throws', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { ctrl, intents } = mount();
        ctrl.setSnapSources([
            () => [{ price: NaN }],
            () => {
                throw new Error('boom');
            },
        ]);
        ctrl.setActiveTool('hline');
        ctrl.pointerDown(75, 41, 'weak');
        ctrl.pointerUp(75, 41, 'weak');
        expect(of(intents, 'create')[0]!.doc.anchors[0]).toEqual({ time: 80, price: 60 }); // the candle magnet's point
        errors.mockRestore();
    });

    it('forgets the hover when the drawing under the pointer goes away', () => {
        define({ type: 'test.gone', label: 'Gone', shapes: () => [{ kind: 'rect', from: [10, 10], to: [60, 60], fill: '#000' }] });
        const { ctrl, intents, sync } = mount();
        sync(createDrawing('test.gone', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        ctrl.pointerMove(30, 30);
        expect(ctrl.hoveredDrawing()).toEqual({ id: 'a', part: null });
        ctrl.syncDrawings([]);
        expect(ctrl.hoveredDrawing()).toBeNull();
        expect(of(intents, 'hover').map((i) => i.id)).toEqual(['a', null]);
    });

    it('answers values and readouts from what the drawing computed from the bars', () => {
        define<Record<string, never>, number>({
            type: 'test.mean',
            label: 'Mean',
            compute: (c) => {
                const bars = c.bars(-Infinity, Infinity);
                return bars.reduce((sum, b) => sum + b.close, 0) / (bars.length || 1);
            },
            shapes: () => [],
            valueAt: (_t, d) => d.state ?? null,
            readout: (d) => (d.state === undefined ? [] : [{ label: 'Mean', value: String(d.state) }]),
        });
        const { ctrl, sync } = mount();
        sync(createDrawing('test.mean', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] }));
        expect(ctrl.drawingValueAt('a', 5)).toBe(50);
        expect(ctrl.drawingReadout('a')).toEqual([{ label: 'Mean', value: '50' }]);
        expect(ctrl.readoutGroups()).toEqual([{ name: 'Mean', rows: [{ label: 'Mean', value: '50', color: '' }] }]);
    });

    it('does not compute again for a re-sync that changes neither the drawing nor the bars', () => {
        const compute = vi.fn(() => 1);
        define({ type: 'test.once', label: 'Once', compute, shapes: () => [] });
        const { ctrl, sync } = mount();
        const d = createDrawing('test.once', { id: 'a', paneId: 'price', anchors: [{ time: 0, price: 0 }, { time: 1, price: 1 }] });
        sync(d);
        ctrl.drawingAt(5, 5);
        ctrl.drawingAt(50, 50);
        sync(d); // a re-sync rebuilds the instances
        ctrl.drawingAt(5, 5);
        expect(compute).toHaveBeenCalledTimes(1);
    });
});

describe('built-in lines report their level', () => {
    const anchors = [{ time: 100, price: 10 }, { time: 200, price: 30 }];

    it('a trend line between its points, and past the ends it extends', () => {
        const line = createDrawing('trendline', { paneId: 'price', anchors })!;
        expect(line.valueAt(150)).toBe(20);
        expect(line.valueAt(250)).toBeNull();
        expect(line.valueAt(50)).toBeNull();
        line.style.extendRight = true;
        expect(line.valueAt(250)).toBe(40);
        expect(line.valueAt(50)).toBeNull();
        line.style.extendLeft = true;
        expect(line.valueAt(50)).toBe(0);
    });

    it('a ray past its second point, an extended line both ways, the horizontal tools their price', () => {
        expect(createDrawing('ray', { paneId: 'price', anchors })!.valueAt(300)).toBe(50);
        expect(createDrawing('ray', { paneId: 'price', anchors })!.valueAt(50)).toBeNull();
        expect(createDrawing('extendedline', { paneId: 'price', anchors })!.valueAt(0)).toBe(-10);
        expect(createDrawing('hline', { paneId: 'price', anchors: [anchors[0]!] })!.valueAt(9999)).toBe(10);
        expect(createDrawing('hray', { paneId: 'price', anchors: [anchors[0]!] })!.valueAt(150)).toBe(10);
        expect(createDrawing('hray', { paneId: 'price', anchors: [anchors[0]!] })!.valueAt(50)).toBeNull();
        expect(createDrawing('box', { paneId: 'price', anchors })!.valueAt(150)).toBeNull(); // a shape has no level
    });

    it('extends toward the chart edge whichever way the points were clicked', () => {
        // Drawn right to left: the ray still runs on to the RIGHT edge, as it is painted.
        const ray = createDrawing('ray', { paneId: 'price', anchors: [anchors[1]!, anchors[0]!] })!;
        expect(ray.valueAt(300)).toBe(50);
        expect(ray.valueAt(50)).toBeNull();
    });

    it('reads a line as it is painted when the chart supplies its projector', () => {
        // A logarithmic price axis: straight on screen is not straight in price.
        const log: Projector = { ...projector(), yOf: (price) => 100 - Math.log10(price) * 10, pxToPoint: (x, y) => ({ time: x, price: 10 ** ((100 - y) / 10) }) };
        const a = { time: 0, price: 10 };
        const b = { time: 100, price: 1000 };
        expect(lineValueAt(a, b, 50)).toBe(505); // straight in price
        expect(lineValueAt(a, b, 50, { proj: log })).toBeCloseTo(100, 6); // straight on the log axis
    });
});

describe('shape painting details', () => {
    function ctx2d() {
        const calls: Array<[string, ...unknown[]]> = [];
        const strokes: string[] = [];
        const target = { globalAlpha: 1, strokeStyle: '', fillStyle: '', lineWidth: 1, font: '' } as Record<string, unknown>;
        const ctx = new Proxy(target, {
            get(t, key: string) {
                if (key in t) return t[key];
                if (key === 'measureText') return (text: string) => ({ width: text.length * 6 });
                if (key === 'createLinearGradient') return () => ({ addColorStop: (...a: unknown[]) => calls.push(['addColorStop', ...a]) });
                return (...a: unknown[]) => {
                    if (key === 'stroke') strokes.push(String(t.strokeStyle));
                    calls.push([key, ...a]);
                };
            },
            set(t, key: string, value) {
                t[key] = value;
                return true;
            },
        });
        return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, strokes, named: (name: string) => calls.filter((c) => c[0] === name) };
    }
    const env = (over: Partial<Parameters<typeof paintShapes>[2]> = {}): Parameters<typeof paintShapes>[2] => ({
        style: { lineColor: '#111111', lineWidth: 2, lineStyle: 'solid', fillColor: '#222222' },
        theme: { text: '#eeeeee', background: '#000000', font: 'sans-serif' },
        width: 200,
        height: 100,
        pass: 'all',
        embedded: () => {},
        image: () => null,
        // No shape of these tests may fail to paint.
        failed: (err) => {
            throw err;
        },
        ...over,
    });

    it('strokes each segment of a path in its own color', () => {
        const c = ctx2d();
        paintShapes(c.ctx, [{ kind: 'path', points: [[0, 0], [10, 0], [20, 0], [30, 0]], colors: ['#aa0000', '#00aa00'] }], env());
        expect(c.strokes).toEqual(['#aa0000', '#00aa00', '#111111']); // the third falls back to the drawing's color
    });

    it('fills with a gradient or a hatch, and uses the drawing style where a shape names none', () => {
        const c = ctx2d();
        paintShapes(
            c.ctx,
            [
                { kind: 'rect', from: [0, 0], to: [50, 50], stroke: null, fill: { gradient: { from: [0, 0], to: [50, 0], stops: [[0, '#ff0000'], [1, '#0000ff']] } } },
                { kind: 'rect', from: [0, 0], to: [50, 50], stroke: null, fill: { hatch: { color: '#00ff00', spacing: 10 } } },
                { kind: 'rect', from: [0, 0], to: [50, 50], fill: true },
            ],
            env(),
        );
        expect(c.named('addColorStop')).toHaveLength(2);
        expect(c.named('clip')).toHaveLength(1); // the hatch is clipped to its shape
        expect(c.strokes).toContain('#00ff00'); // the hatch lines
        expect(c.strokes[c.strokes.length - 1]).toBe('#111111'); // the last rect: outlined in the drawing's line color
    });

    it('paints an image once it has loaded, and nothing before', () => {
        const before = ctx2d();
        paintShapes(before.ctx, [{ kind: 'image', at: [50, 50], w: 20, h: 10, src: 'x.png' }], env());
        expect(before.named('drawImage')).toEqual([]);
        const after = ctx2d();
        const img = {} as CanvasImageSource;
        paintShapes(after.ctx, [{ kind: 'image', at: [50, 50], w: 20, h: 10, src: 'x.png' }], env({ image: () => img }));
        expect(after.named('drawImage')).toEqual([['drawImage', img, 40, 45, 20, 10]]);
    });

    it('moves the texts that ask for it clear of one another', () => {
        const c = ctx2d();
        paintShapes(
            c.ctx,
            [
                { kind: 'text', at: [10, 10], text: 'first', avoid: true },
                { kind: 'text', at: [10, 12], text: 'second', avoid: true },
            ],
            env(),
        );
        const ys = c.named('translate').map((t) => t[2] as number);
        expect(ys[0]).toBe(10);
        expect(ys[1]).toBeGreaterThanOrEqual(10 + 15); // pushed below the first one's box
    });

    it('wraps a text at its width and rotates it around its point', () => {
        const c = ctx2d();
        paintShapes(c.ctx, [{ kind: 'text', at: [10, 10], text: 'one two three four', maxWidth: 50, angle: Math.PI / 2 }], env());
        expect(c.named('fillText').length).toBeGreaterThan(1);
        expect(c.named('rotate')).toEqual([['rotate', Math.PI / 2]]);
    });
});
