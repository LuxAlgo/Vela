import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { DrawingController } from '../src/core/drawings/DrawingController';
import { DrawingStore } from '../src/core/drawings/DrawingStore';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { DrawingInteraction } from '../src/renderers/native/drawings/DrawingInteraction';
import {
    buildToolbar,
    createDrawing,
    defineDrawing,
    deserializeDrawing,
    drawingTypes,
    getDrawingType,
    hitShapes,
    onDrawingTypesChange,
    registerDrawingGroup,
    reviveDrawing,
    shapeContext,
    shapesBounds,
    unregisterDrawingGroup,
    unregisterDrawingType,
    ShapeDrawing,
    UnknownDrawing,
    type Drawing,
    type DrawingDefinition,
    type DrawingIntent,
    type DrawingShape,
    type IDrawingsRendererPort,
    type Projector,
    type SerializedDrawing,
    type ShapeBar,
    type ToolbarDefinition,
} from '../src/core/drawings';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 100 − price, one pane 'price'. `bars` back `barsInRange`. */
function projector(bars: ShapeBar[] = [], barsKey?: string): Projector {
    return {
        xOf: (t) => t,
        yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
        pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
        paneIdAtY: () => 'price',
        barsInRange: (from, to) => bars.filter((b) => b.time >= from && b.time <= to),
        barsKey,
        width: 200,
        height: 100,
    };
}

/** A 2D context that records the calls a paint makes. */
function recordingCtx() {
    const calls: string[] = [];
    const texts: string[] = [];
    const rects: Array<[number, number, number, number]> = [];
    const log = (name: string) => (..._args: unknown[]) => void calls.push(name);
    const ctx = {
        globalAlpha: 1,
        save: log('save'),
        restore: log('restore'),
        beginPath: log('beginPath'),
        closePath: log('closePath'),
        moveTo: log('moveTo'),
        lineTo: log('lineTo'),
        arc: log('arc'),
        arcTo: log('arcTo'),
        ellipse: log('ellipse'),
        rect: log('rect'),
        quadraticCurveTo: log('quadraticCurveTo'),
        bezierCurveTo: log('bezierCurveTo'),
        stroke: log('stroke'),
        fill: log('fill'),
        clip: log('clip'),
        translate: log('translate'),
        rotate: log('rotate'),
        setLineDash: log('setLineDash'),
        strokeText: log('strokeText'),
        drawImage: log('drawImage'),
        fillRect: (x: number, y: number, w: number, h: number) => {
            calls.push('fillRect');
            rects.push([x, y, w, h]);
        },
        fillText: (text: string) => {
            calls.push('fillText');
            texts.push(text);
        },
        measureText: (text: string) => ({ width: text.length * 6 }),
        createLinearGradient: () => ({ addColorStop: log('addColorStop') }),
    };
    const count = (name: string): number => calls.filter((c) => c === name).length;
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, texts, rects, count };
}

const theme = { textColor: '#fff', background: '#000', fontFamily: 'sans-serif', upColor: '#0f0', downColor: '#f00' } as unknown as VelaTheme;

/** Types registered by a test are removed after it, so tests do not see each other's tools. */
const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const fn of cleanup.splice(0)) fn();
});
function define<P extends object, S>(def: DrawingDefinition<P, S>): void {
    cleanup.push(defineDrawing(def));
}

/** A two-point tool that draws the segment and a labelled midpoint. */
function defineSegment(type = 'test.segment'): void {
    define({
        type,
        label: 'Test segment',
        group: 'test-tools',
        props: { ratio: 0.5 },
        shapes: (c) => {
            const [a, b] = c.points;
            if (!a || !b) return [];
            const mid: [number, number] = [a[0] + (b[0] - a[0]) * c.props.ratio, a[1] + (b[1] - a[1]) * c.props.ratio];
            return [
                { kind: 'line', from: a, to: b },
                { kind: 'marker', at: mid, part: 'mid', tip: 'Midpoint', cursor: 'ns-resize' },
                { kind: 'text', at: mid, text: `mid ${c.props.ratio}`, hit: false },
            ];
        },
    });
}

const anchors = [
    { time: 20, price: 80 },
    { time: 120, price: 30 },
];

describe('defineDrawing', () => {
    it('registers a type that creates, serializes and comes back with its props', () => {
        expect(getDrawingType('test.segment')).toBeUndefined();
        defineSegment();
        const d = createDrawing('test.segment', { paneId: 'price', anchors })!;
        expect(d).toBeInstanceOf(ShapeDrawing);
        d.applySettings({ 'props.ratio': 0.25 });
        const doc = d.serialize();
        expect(doc.type).toBe('test.segment');
        expect(doc.props).toEqual({ ratio: 0.25 });
        const back = deserializeDrawing(doc) as ShapeDrawing<{ ratio: number }>;
        expect(back.props.ratio).toBe(0.25);
        // A record without props starts from the definition's defaults.
        expect((createDrawing('test.segment', { paneId: 'price' }) as ShapeDrawing<{ ratio: number }>).props.ratio).toBe(0.5);
    });

    it('unregisters with the function it returns', () => {
        const off = defineDrawing({ type: 'test.gone', label: 'Gone', shapes: () => [] });
        expect(drawingTypes().some((t) => t.type === 'test.gone')).toBe(true);
        off();
        expect(drawingTypes().some((t) => t.type === 'test.gone')).toBe(false);
        expect(createDrawing('test.gone', { paneId: 'price' })).toBeNull();
    });

    it('derives hit-testing, parts, bounds and handles from the shapes', () => {
        defineSegment();
        const d = createDrawing('test.segment', { paneId: 'price', anchors })!;
        const proj = projector();
        // On the segment (x=70 → y = 20 + 50·0.5 = 45), and well off it.
        expect(d.hitTest(70, 45, proj, 4)).toBe(true);
        expect(d.hitTest(70, 90, proj, 4)).toBe(false);
        // The marker is a named part with its own cursor and tip; the plain line is the body.
        expect(d.hitInfo(70, 45, proj, 4)).toEqual({ part: 'mid', cursor: 'ns-resize', tip: 'Midpoint' });
        expect(d.hitInfo(30, 25, proj, 4)).toEqual({ part: null, cursor: undefined, tip: undefined });
        expect(d.handlePoints(proj)).toEqual([
            [20, 20],
            [120, 70],
        ]);
        expect(d.hitHandle(120, 70, proj, 4)).toBe(1);
        const b = d.bounds(proj)!;
        expect(b.x).toBeLessThanOrEqual(20);
        expect(b.x + b.w).toBeGreaterThanOrEqual(120);
    });

    it('is painted from its shapes, with no branch of its own in the painter', () => {
        defineSegment();
        const d = createDrawing('test.segment', { paneId: 'price', anchors })!;
        const rec = recordingCtx();
        new DrawingPainter().paintAll(rec.ctx, [d], projector(), theme);
        expect(rec.count('lineTo')).toBeGreaterThanOrEqual(1); // the segment
        expect(rec.count('arc')).toBe(1); // the midpoint marker (no handles: nothing is targeted)
        expect(rec.texts).toEqual(['mid 0.5']);
    });

    it('hands the paint the interaction state of the frame', () => {
        const seen: Array<{ selected: boolean; hovered: boolean; part: string | null; placing: boolean }> = [];
        define({ type: 'test.view', label: 'View', shapes: (c) => (seen.push({ ...c.view }), []) });
        const d = createDrawing('test.view', { id: 'v', paneId: 'price', anchors })!;
        const painter = new DrawingPainter();
        painter.paintAll(recordingCtx().ctx, [d], projector(), theme, { selected: new Set(['v']), hovered: 'v', hoverPart: 'lvl' });
        painter.paintGhost(recordingCtx().ctx, d, projector(), theme);
        expect(seen[0]).toEqual({ selected: true, hovered: true, part: 'lvl', placing: false });
        expect(seen[seen.length - 1]!.placing).toBe(true);
    });

    it('paints the shapes marked front apart from the body', () => {
        define({
            type: 'test.depth',
            label: 'Depth',
            shapes: (c) => [
                { kind: 'rect', from: c.points[0]!, to: c.points[1]!, fill: '#123456', stroke: null },
                { kind: 'text', at: c.points[0]!, text: 'zone', front: true },
            ],
        });
        const d = createDrawing('test.depth', { paneId: 'price', anchors })!;
        const painter = new DrawingPainter();
        // The layer under the series gets the body only…
        const under = recordingCtx();
        painter.bodyOnly = true;
        painter.paintAll(under.ctx, [d], projector(), theme, {}, false);
        painter.bodyOnly = false;
        expect(under.count('rect')).toBe(1);
        expect(under.texts).toEqual([]);
        // …and the top layer the front shapes only.
        const top = recordingCtx();
        painter.paintFront(top.ctx, [d], projector(), theme);
        expect(top.count('rect')).toBe(0);
        expect(top.texts).toEqual(['zone']);
    });

    it('paints axis tags in the price gutter and on the time strip', () => {
        define({
            type: 'test.tags',
            label: 'Tags',
            shapes: (c) => [
                { kind: 'tag', axis: 'price', value: c.anchors[0]!.price, text: 'entry', color: '#ff0000' },
                { kind: 'tag', axis: 'time', value: c.anchors[0]!.time },
            ],
        });
        const d = createDrawing('test.tags', { paneId: 'price', anchors })!;
        const rec = recordingCtx();
        new DrawingPainter().paintAxisTags(rec.ctx, [d], projector(), theme, (t) => `t${t}`);
        expect(rec.texts).toEqual(['entry', 't20']);
        // The price chip starts at the plot's right edge (x = width + 1), level with the price.
        expect(rec.rects[0]![0]).toBe(201);
        expect(rec.rects[0]![1]).toBe(20 - 8);
        // The time chip hangs under the plot (y = height + 1).
        expect(rec.rects[1]![1]).toBe(101);
    });

    it('paints another registered drawing as a part, and hits through it', () => {
        define({
            type: 'test.compound',
            label: 'Compound',
            shapes: (c) => [{ kind: 'drawing', type: 'hline', anchors: [c.anchors[0]!], part: 'level' }],
        });
        const d = createDrawing('test.compound', { paneId: 'price', anchors })!;
        const rec = recordingCtx();
        new DrawingPainter().paintAll(rec.ctx, [d], projector(), theme);
        expect(rec.count('lineTo')).toBe(1); // the embedded horizontal line
        expect(d.hitInfo(150, 20, projector(), 4)?.part).toBe('level'); // anywhere along it
        expect(d.hitTest(150, 60, projector(), 4)).toBe(false);
    });

    it('keeps painting, and hit-testing, around a tool that throws or embeds itself', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        define({
            type: 'test.broken',
            label: 'Broken',
            shapes: () => {
                throw new Error('boom');
            },
        });
        define({ type: 'test.self', label: 'Self', shapes: (c) => [{ kind: 'drawing', type: 'test.self', anchors: c.anchors }] });
        const broken = createDrawing('test.broken', { paneId: 'price', anchors })!;
        const self = createDrawing('test.self', { paneId: 'price', anchors })!;
        const line = createDrawing('hline', { paneId: 'price', anchors: [anchors[0]!] })!;
        const painter = new DrawingPainter();
        const rec = recordingCtx();
        painter.bodyOnly = true;
        painter.paintAll(rec.ctx, [broken, self, line], projector(), theme, {}, false);
        expect(rec.count('lineTo')).toBe(1); // the line after them is still painted
        expect(rec.count('save')).toBe(rec.count('restore')); // and no clip is left behind
        expect(broken.hitTest(70, 45, projector(), 4)).toBe(false);
        expect(self.hitTest(70, 45, projector(), 4)).toBe(false); // ends, where it used to recurse forever
        errors.mockRestore();
    });

    it('paints the rest of the chart when a tool returns shapes it cannot draw', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        // What a tool under development returns by mistake: a point that is not placed yet,
        // a number where the text goes, a hole in a path, a kind that does not exist.
        const bad = [
            { kind: 'line', from: [10, 10], to: undefined },
            { kind: 'text', at: [10, 10], text: 42 },
            { kind: 'path', points: [[0, 0], null, [5, 5]] },
            { kind: 'rows', x: 0, rows: [null] },
            { kind: 'band', upper: [[0, 0]], lower: undefined },
            { kind: 'drawing', type: 'hline', anchors: undefined },
            { kind: 'tag', axis: 'price', value: 'high' },
            { kind: 'hexagon' },
            null,
        ] as unknown as DrawingShape[];
        define({ type: 'test.malformed', label: 'Malformed', shapes: () => [...bad, { kind: 'marker', at: [50, 50], shape: 'square' }] });
        define({ type: 'test.nolist', label: 'No list', shapes: () => undefined as unknown as DrawingShape[] });
        const malformed = createDrawing('test.malformed', { paneId: 'price', anchors })!;
        const nolist = createDrawing('test.nolist', { paneId: 'price', anchors })!;
        const line = createDrawing('hline', { paneId: 'price', anchors: [anchors[0]!] })!;
        const painter = new DrawingPainter();
        const rec = recordingCtx();

        expect(() => painter.paintAll(rec.ctx, [malformed, nolist, line], projector(), theme)).not.toThrow();
        expect(() => painter.paintAxisTags(rec.ctx, [malformed, nolist], projector(), theme, String)).not.toThrow();
        expect(rec.count('rect')).toBeGreaterThan(0); // the tool's one good shape is painted
        expect(rec.count('lineTo')).toBe(1); // and so is the line after the two tools
        expect(rec.count('save')).toBe(rec.count('restore'));
        // The pointer path reads the same lists.
        expect(malformed.hitTest(50, 50, projector(), 4)).toBe(true);
        expect(malformed.hitTest(10, 10, projector(), 4)).toBe(false);
        expect(nolist.hitTest(10, 10, projector(), 4)).toBe(false);
        expect(() => malformed.bounds(projector())).not.toThrow();
        // Said once per tool, not on every frame.
        painter.paintAll(recordingCtx().ctx, [malformed, nolist], projector(), theme);
        expect(errors.mock.calls.filter(([message]) => String(message).includes('test.malformed'))).toHaveLength(1);
        expect(errors.mock.calls.filter(([message]) => String(message).includes('test.nolist'))).toHaveLength(1);
        errors.mockRestore();
    });

    it('paints the shapes after one the canvas refuses', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        define({
            type: 'test.refused',
            label: 'Refused',
            shapes: () => [
                { kind: 'rect', from: [0, 0], to: [10, 10], fill: { gradient: { from: [0, 0], to: [10, 10], stops: [[0, 'not a color']] } } },
                { kind: 'marker', at: [50, 50], shape: 'triangle' },
            ],
        });
        const d = createDrawing('test.refused', { paneId: 'price', anchors })!;
        const line = createDrawing('hline', { paneId: 'price', anchors: [anchors[0]!] })!;
        const rec = recordingCtx();
        // A canvas throws on a color stop it cannot read.
        (rec.ctx as unknown as { createLinearGradient: () => unknown }).createLinearGradient = () => ({
            addColorStop: () => {
                throw new SyntaxError('The value provided could not be parsed as a color.');
            },
        });
        expect(() => new DrawingPainter().paintAll(rec.ctx, [d, line], projector(), theme)).not.toThrow();
        expect(rec.count('closePath')).toBeGreaterThan(0); // the triangle after the refused rectangle
        expect(rec.count('save')).toBe(rec.count('restore'));
        expect(errors).toHaveBeenCalledTimes(1);
        errors.mockRestore();
    });

    it('carries on when a hook of a tool throws', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const boom = (): never => {
            throw new Error('state is not there yet');
        };
        define({
            type: 'test.hooks',
            label: 'Hooks',
            shapes: (c) => (c.points.length === 2 ? [{ kind: 'line', from: c.points[0]!, to: c.points[1]! }] : []),
            handles: boom,
            place: boom,
            placed: boom,
            constrain: boom,
            translate: boom,
            timeExtent: boom,
            priceRange: boom,
            valueAt: boom,
            readout: boom,
            snapTargets: boom,
            click: boom,
        });
        const d = createDrawing('test.hooks', { paneId: 'price', anchors })!;
        const proj = projector();
        const point = { time: 60, price: 40 };

        expect(d.handlePoints(proj)).toHaveLength(2); // the two points keep their grips
        expect(d.hitHandle(20, 20, proj, 4)).toBe(0);
        expect(d.placeAnchor(1, point, proj, false)).toEqual(point);
        expect(() => d.onPlaced(proj)).not.toThrow();
        expect(() => d.constrainHandleDrag(0)).not.toThrow();
        expect(d.translateBody(10, 5, anchors)).toEqual([
            { time: 30, price: 85 },
            { time: 130, price: 35 },
        ]);
        expect(d.timeExtent()).toEqual({ min: 20, max: 120 });
        expect(d.priceRange()).toEqual({ min: 30, max: 80 });
        expect(d.valueAt(70, proj)).toBeNull();
        expect(d.readout()).toEqual([]);
        expect(d.snapTargets()).toEqual([]);
        expect(d.onClick(null)).toBe(false);
        // Each hook is reported once, however often it runs.
        d.readout();
        d.priceRange();
        expect(errors.mock.calls.filter(([message]) => String(message).includes('readout'))).toHaveLength(1);
        expect(errors.mock.calls.filter(([message]) => String(message).includes('priceRange'))).toHaveLength(1);
        errors.mockRestore();
    });

    it('leaves out what a hook returns in the wrong form', () => {
        define({
            type: 'test.wrongform',
            label: 'Wrong form',
            shapes: () => [],
            handles: () => [null, { at: undefined }, { at: { time: 70, price: 55 }, drag: () => undefined }] as never,
            readout: () => 'slope 2' as never,
            snapTargets: () => ({ price: 80 }) as never,
            translate: () => undefined as never,
        });
        const d = createDrawing('test.wrongform', { paneId: 'price', anchors })!;
        expect(d.handlePoints(projector())).toEqual([
            [20, 20],
            [120, 70],
            [70, 45],
        ]);
        expect(d.readout()).toEqual([]);
        expect(d.snapTargets()).toEqual([]);
        expect(d.translateBody(10, 5, anchors)).toEqual([
            { time: 30, price: 85 },
            { time: 130, price: 35 },
        ]);
    });

    describe('an image shape', () => {
        /** A stand-in for the browser's image: records how it was asked for, and lets the test answer. */
        class FakeImage {
            static made: FakeImage[] = [];
            crossOrigin: string | null = null;
            /** The CORS setting at the moment the request went out. */
            requestedWith: string | null | undefined;
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            private url = '';
            constructor() {
                FakeImage.made.push(this);
            }
            set src(value: string) {
                this.url = value;
                this.requestedWith = this.crossOrigin;
            }
            get src(): string {
                return this.url;
            }
        }
        afterEach(() => {
            FakeImage.made = [];
            vi.unstubAllGlobals();
        });
        function imageTool(type: string, src: string): Drawing {
            define({ type, label: 'Image', anchors: 1, shapes: (c) => [{ kind: 'image', at: c.points[0]!, w: 32, h: 32, src }] });
            return createDrawing(type, { paneId: 'price', anchors: [anchors[0]!] })!;
        }

        it('is asked for with CORS, so one from another origin cannot taint the chart', () => {
            vi.stubGlobal('Image', FakeImage);
            const d = imageTool('test.image.cors', 'https://cdn.example/logo-cors.png');
            const painter = new DrawingPainter();
            let repaints = 0;
            painter.onAsset = () => (repaints += 1);
            const rec = recordingCtx();
            painter.paintAll(rec.ctx, [d], projector(), theme);
            expect(FakeImage.made).toHaveLength(1);
            expect(FakeImage.made[0]!.requestedWith).toBe('anonymous');
            expect(rec.count('drawImage')).toBe(0); // not loaded yet

            FakeImage.made[0]!.onload?.();
            expect(repaints).toBe(1);
            painter.paintAll(rec.ctx, [d], projector(), theme);
            expect(rec.count('drawImage')).toBe(1);
        });

        it('paints nothing, and says why once, when the image cannot be loaded', () => {
            vi.stubGlobal('Image', FakeImage);
            const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const d = imageTool('test.image.refused', 'https://cdn.example/logo-no-cors.png');
            const painter = new DrawingPainter();
            const rec = recordingCtx();
            painter.paintAll(rec.ctx, [d], projector(), theme);
            FakeImage.made[0]!.onerror?.();
            painter.paintAll(rec.ctx, [d], projector(), theme);
            painter.paintAll(rec.ctx, [d], projector(), theme);
            expect(rec.count('drawImage')).toBe(0);
            expect(FakeImage.made).toHaveLength(1); // not asked for again on every frame
            expect(warnings).toHaveBeenCalledTimes(1);
            expect(String(warnings.mock.calls[0]![0])).toContain('logo-no-cors.png');
            warnings.mockRestore();
        });
    });

    it('keeps the frame of a built-in text label off the layer under the series', () => {
        const label = createDrawing('text', { id: 't', paneId: 'price', anchors: [anchors[0]!], text: { value: 'hi', size: 'normal', hAlign: 'left', vAlign: 'top' } })!;
        const painter = new DrawingPainter();
        // On the top layer a hovered label wears its frame…
        const top = recordingCtx();
        painter.paintAll(top.ctx, [label], projector(), theme, { hovered: 't' });
        expect(top.count('stroke')).toBeGreaterThan(0);
        // …and the layer under the series, which does not repaint with the pointer, never does.
        const under = recordingCtx();
        painter.bodyOnly = true;
        painter.paintAll(under.ctx, [label], projector(), theme, { hovered: 't' }, false);
        painter.bodyOnly = false;
        expect(under.count('stroke')).toBe(0);
        expect(under.texts).toEqual(['hi']);
    });

    it('changes only the props an edit names', () => {
        define({ type: 'test.partial', label: 'Partial', props: { a: 1, b: 0 }, shapes: () => [] });
        const store = new DrawingStore();
        store.add(createDrawing('test.partial', { id: 'p', paneId: 'price', anchors, props: { a: 5, b: 0 } })!);
        store.update('p', { props: { b: 2 } });
        expect(store.get('p')!.serialize().props).toEqual({ a: 5, b: 2 });
    });

    it('edits props from an extra handle', () => {
        define({
            type: 'test.handle',
            label: 'Handle',
            props: { level: 50 },
            shapes: () => [],
            handles: (data) => [{ at: { time: data.anchors[0]!.time, price: data.props.level }, drag: (pt) => ({ level: pt.price }) }],
        });
        const d = createDrawing('test.handle', { paneId: 'price', anchors }) as ShapeDrawing<{ level: number }>;
        const proj = projector();
        expect(d.handlePoints(proj)).toHaveLength(3); // two anchors + the level grip
        expect(d.hitHandle(20, 50, proj, 4)).toBe(2);
        d.dragHandle(2, { time: 20, price: 64 });
        expect(d.props.level).toBe(64);
        expect(d.serialize().props).toEqual({ level: 64 });
    });

    it('reports values, a readout and snap targets from the definition', () => {
        define({
            type: 'test.values',
            label: 'Values',
            shapes: () => [],
            valueAt: (time, data) => {
                const [a, b] = data.anchors;
                return a && b && time >= a.time && time <= b.time ? a.price + ((b.price - a.price) * (time - a.time)) / (b.time - a.time) : null;
            },
            readout: (data) => [{ key: 'slope', label: 'Slope', value: String((data.anchors[1]!.price - data.anchors[0]!.price) / 100) }],
            snapTargets: (data) => data.anchors.map((a) => ({ price: a.price })),
        });
        const d = createDrawing('test.values', { paneId: 'price', anchors }) as ShapeDrawing;
        expect(d.valueAt(70)).toBe(55);
        expect(d.valueAt(500)).toBeNull();
        expect(d.readout()).toEqual([{ key: 'slope', label: 'Slope', value: '-0.5' }]);
        expect(d.results).toEqual({ slope: '-0.5' });
        expect(d.snapTargets()).toEqual([{ price: 80 }, { price: 30 }]);
    });
});

describe('compute', () => {
    const bars = (n: number): ShapeBar[] => Array.from({ length: n }, (_, i) => ({ time: i * 10, open: i, high: i + 1, low: i - 1, close: i }));

    it('runs when the anchors, props or bars change, and not on a new viewport', () => {
        const runs: Array<{ anchors: boolean; props: boolean; bars: string }> = [];
        define({
            type: 'test.compute',
            label: 'Compute',
            props: { n: 1 },
            compute: (c) => {
                runs.push({ ...c.change });
                return c.bars(0, Infinity).length * c.props.n;
            },
            shapes: () => [],
        });
        const d = createDrawing('test.compute', { paneId: 'price', anchors }) as ShapeDrawing<{ n: number }, number>;
        const data = bars(3);
        expect(d.shapeData(projector(data, '3|0|20|1|a')).state).toBe(3);
        expect(runs[0]).toEqual({ anchors: true, props: true, bars: 'reset' }); // nothing to extend yet
        d.shapeData(projector(data, '3|0|20|1|a')); // a pan or zoom: another projector, same data
        expect(runs).toHaveLength(1);

        // The newest bar moved.
        d.shapeData(projector(data, '3|0|20|1|b'));
        expect(runs[1]).toEqual({ anchors: false, props: false, bars: 'tick' });
        // A bar was added.
        expect(d.shapeData(projector(bars(4), '4|0|30|1|c')).state).toBe(4);
        expect(runs[2]!.bars).toBe('append');
        // Another series on the very same time grid (a symbol switch).
        d.shapeData(projector(bars(4), '4|0|30|2|c'));
        expect(runs[3]!.bars).toBe('reset');
        // Another series altogether.
        d.shapeData(projector(bars(2), '2|500|510|3|d'));
        expect(runs[4]!.bars).toBe('reset');
        // A setting.
        d.applySettings({ 'props.n': 2 });
        expect(d.shapeData(projector(bars(2), '2|500|510|3|d')).state).toBe(4);
        expect(runs[5]).toEqual({ anchors: false, props: true, bars: 'none' });
        // A point.
        d.anchors[0]!.price = 81;
        d.shapeData(projector(bars(2), '2|500|510|3|d'));
        expect(runs[6]).toEqual({ anchors: true, props: false, bars: 'none' });
    });

    it('reads the chart time zone, and runs again when it changes', () => {
        const runs: Array<{ zone: string; bars: string }> = [];
        define({
            type: 'test.zone',
            label: 'Zone',
            compute: (c) => {
                runs.push({ zone: c.timeZone, bars: c.change.bars });
                return c.timeZone;
            },
            shapes: (c) => [{ kind: 'text', at: [0, 0], text: `${c.timeZone} ${c.state}` }],
        });
        const d = createDrawing('test.zone', { paneId: 'price', anchors }) as ShapeDrawing<Record<string, never>, string>;
        const zoned = (timeZone?: string): Projector => ({ ...projector(bars(3), '3|0|20|1|a'), timeZone });
        expect(d.shapeData(zoned()).state).toBe('UTC'); // a renderer that does not say
        d.shapeData(zoned('America/New_York'));
        d.shapeData(zoned('America/New_York')); // the same zone: no run
        d.shapeData(zoned('Asia/Tokyo'));
        expect(runs).toEqual([
            { zone: 'UTC', bars: 'reset' },
            { zone: 'America/New_York', bars: 'reset' },
            { zone: 'Asia/Tokyo', bars: 'reset' },
        ]);
        const proj = zoned('Asia/Tokyo');
        expect(d.shapes(shapeContext(d.shapeData(proj), proj))).toMatchObject([{ text: 'Asia/Tokyo Asia/Tokyo' }]);
    });

    it('survives a run that throws: the last result stays, and the next change runs again', () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = true;
        define({
            type: 'test.throws',
            label: 'Throws',
            compute: () => {
                if (fail) throw new Error('boom');
                return 'ok';
            },
            shapes: () => [],
        });
        const d = createDrawing('test.throws', { paneId: 'price', anchors }) as ShapeDrawing<Record<string, unknown>, string>;
        expect(d.shapeData(projector([], '0|0|0|1|')).state).toBeUndefined();
        d.shapeData(projector([], '0|0|0|1|')); // the same inputs: not tried again
        expect(errors).toHaveBeenCalledTimes(1); // said once, not on every frame
        fail = false;
        expect(d.shapeData(projector([], '1|0|0|1|x')).state).toBe('ok');
        errors.mockRestore();
    });

    it('tells a run what changed since the result it is handed, not since a run still on its way', async () => {
        const seen: Array<{ bars: string; prev: unknown }> = [];
        const pending: Array<(v: string) => void> = [];
        define<Record<string, never>, string>({
            type: 'test.superseded',
            label: 'Superseded',
            compute: (c, prev) => {
                seen.push({ bars: c.change.bars, prev });
                return new Promise<string>((r) => pending.push(r));
            },
            shapes: () => [],
        });
        const d = createDrawing('test.superseded', { paneId: 'price', anchors }) as ShapeDrawing<Record<string, never>, string>;
        d.mount({ prev: null, invalidate: () => {} });
        d.shapeData(projector([], '3|0|20|1|a'));
        pending[0]!('first');
        await Promise.resolve();
        await Promise.resolve();
        d.shapeData(projector([], '3|0|20|1|b')); // a tick: still running…
        d.shapeData(projector([], '4|0|30|1|c')); // …when a bar is added
        // The third run extends 'first', which knew three bars: a bar was added since.
        expect(seen[2]).toEqual({ bars: 'append', prev: 'first' });
    });

    it('computes again for a type that was defined again', () => {
        define({ type: 'test.redefined', label: 'One', compute: () => 'v1', shapes: () => [] });
        const first = createDrawing('test.redefined', { id: 'a', paneId: 'price', anchors })!;
        const proj = projector([], '0|0|0|1|');
        expect(first.shapeData(proj).state).toBe('v1');
        const offFirst = cleanup[cleanup.length - 1]!;
        define({ type: 'test.redefined', label: 'Two', compute: () => 'v2', shapes: () => [] });
        const next = reviveDrawing(first.serialize());
        next.mount({ prev: first, invalidate: () => {} });
        expect(next.shapeData(proj).state).toBe('v2');
        // The first definition's disposer leaves the second one registered.
        offFirst();
        expect(getDrawingType('test.redefined')?.label).toBe('Two');
    });

    it('carries its result over to the instance that replaces it', () => {
        let runs = 0;
        define({ type: 'test.carry', label: 'Carry', compute: () => (runs += 1), shapes: () => [] });
        const first = createDrawing('test.carry', { id: 'a', paneId: 'price', anchors })!;
        const proj = projector([], '0|0|0|1|');
        first.shapeData(proj);
        const next = reviveDrawing(first.serialize());
        next.mount({ prev: first, invalidate: () => {} });
        expect(next.shapeData(proj).state).toBe(1);
        expect(runs).toBe(1);
    });

    it('keeps the previous result while an asynchronous one is on its way, then repaints', async () => {
        let resolve!: (v: string) => void;
        define({
            type: 'test.async',
            label: 'Async',
            compute: () => new Promise<string>((r) => (resolve = r)),
            shapes: () => [],
        });
        const d = createDrawing('test.async', { paneId: 'price', anchors }) as ShapeDrawing<Record<string, unknown>, string>;
        const invalidate = vi.fn();
        d.mount({ prev: null, invalidate });
        const proj = projector([], '0|0|0|1|');
        expect(d.shapeData(proj)).toMatchObject({ state: undefined, pending: true });
        resolve('done');
        await Promise.resolve();
        await Promise.resolve();
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(d.shapeData(proj)).toMatchObject({ state: 'done', pending: false });
    });
});

describe('shape geometry', () => {
    const env = { width: 200, height: 100 };

    it('hits each kind of shape where it is drawn', () => {
        const hit = (s: DrawingShape, x: number, y: number): boolean => hitShapes([s], x, y, 3, env) != null;
        expect(hit({ kind: 'line', from: [0, 0], to: [10, 0], extend: 'right' }, 150, 1)).toBe(true); // on the extension
        expect(hit({ kind: 'line', from: [0, 0], to: [10, 0] }, 150, 1)).toBe(false);
        expect(hit({ kind: 'rect', from: [10, 10], to: [50, 50], fill: '#000' }, 30, 30)).toBe(true); // filled: the inside
        expect(hit({ kind: 'rect', from: [10, 10], to: [50, 50] }, 30, 30)).toBe(false); // outlined: the border only
        expect(hit({ kind: 'rect', from: [10, 10], to: [50, 50] }, 10, 30)).toBe(true);
        expect(hit({ kind: 'ellipse', center: [50, 50], rx: 20 }, 70, 50)).toBe(true);
        expect(hit({ kind: 'ellipse', center: [50, 50], rx: 20 }, 50, 50)).toBe(false);
        expect(hit({ kind: 'path', points: [[0, 0], [50, 0], [50, 50]], closed: true, fill: '#000' }, 40, 10)).toBe(true);
        expect(hit({ kind: 'curve', d: [['M', 0, 0], ['Q', 50, 100, 100, 0]] }, 50, 50)).toBe(true); // the curve's apex
        expect(hit({ kind: 'band', upper: [[0, 10], [100, 10]], lower: [[0, 40], [100, 40]], fill: '#000' }, 50, 25)).toBe(true);
        expect(hit({ kind: 'rows', x: 100, rows: [{ y: 10, h: 10, w: -40 }] }, 80, 15)).toBe(true); // grows to the left
        expect(hit({ kind: 'marker', at: [20, 20], size: 10 }, 23, 23)).toBe(true);
        expect(hit({ kind: 'text', at: [20, 20], text: 'hello' }, 30, 26)).toBe(true);
        expect(hit({ kind: 'tag', axis: 'price', value: 1 }, 0, 0)).toBe(false);
    });

    it('returns the front-most shape and skips the ones marked not hittable', () => {
        const shapes: DrawingShape[] = [
            { kind: 'rect', from: [0, 0], to: [100, 100], fill: '#000', part: 'back' },
            { kind: 'rect', from: [20, 20], to: [60, 60], fill: '#000', part: 'top' },
            { kind: 'rect', from: [0, 0], to: [100, 100], fill: '#000', hit: false },
        ];
        expect((hitShapes(shapes, 30, 30, 2, env) as { part?: string }).part).toBe('top');
        expect((hitShapes(shapes, 80, 80, 2, env) as { part?: string }).part).toBe('back');
    });

    it('bounds a list of shapes', () => {
        expect(shapesBounds([{ kind: 'line', from: [10, 20], to: [60, 5] }, { kind: 'ellipse', center: [100, 50], rx: 10 }])).toMatchObject({ x: 10, y: 5 });
        expect(shapesBounds([])).toBeNull();
    });
});

describe('placement hooks', () => {
    function place(tool: string) {
        const intents: DrawingIntent[] = [];
        const interaction = new DrawingInteraction({
            projector: () => projector(),
            activeTool: () => tool,
            drawings: () => [],
            hoveredId: () => null,
            selectedIds: () => new Set<string>(),
            emit: (i) => intents.push(i),
            changed: () => {},
            openSettings: () => {},
            snap: (pt) => pt,
            toolDefaults: () => undefined,
        });
        const created = (): SerializedDrawing | undefined => intents.find((i): i is Extract<DrawingIntent, { kind: 'create' }> => i.kind === 'create')?.doc;
        return { interaction, created };
    }

    it('constrains each point, the ghost included, and keeps what a click reads', () => {
        define({
            type: 'test.flat',
            label: 'Flat',
            props: { firstPrice: 0 },
            anchors: [{ hint: 'Click the start' }, { hint: 'Click the end' }],
            // The second point keeps the first one's price: a flat range.
            place: (s) => {
                if (s.index === 0) s.set({ firstPrice: s.point.price });
                return s.index === 1 ? { time: s.point.time, price: s.anchors[0]!.price } : undefined;
            },
            shapes: () => [],
        });
        const { interaction, created } = place('test.flat');
        interaction.down(20, 40); // price 60
        interaction.move(90, 10);
        expect(interaction.ghost()!.anchors[1]).toEqual({ time: 90, price: 60 }); // the preview is constrained too
        expect(interaction.placingStep()!.draft.stepHint(1)).toBe('Click the end');
        interaction.down(120, 5);
        expect(created()!.anchors).toEqual([
            { time: 20, price: 60 },
            { time: 120, price: 60 },
        ]);
        expect(created()!.props).toEqual({ firstPrice: 60 });
    });

    it('ends a placement early when the definition says so', () => {
        define({
            type: 'test.early',
            label: 'Early',
            anchors: 4,
            place: (s) => {
                if (s.index === 1) s.finish();
            },
            shapes: () => [],
        });
        const { interaction, created } = place('test.early');
        interaction.down(10, 10);
        expect(created()).toBeUndefined();
        interaction.down(50, 50);
        expect(created()!.anchors).toHaveLength(2);
    });
});

describe('unknown types', () => {
    const doc = (extra: Partial<SerializedDrawing> = {}): SerializedDrawing => ({
        id: 'dw-1',
        type: 'acme.later',
        paneId: 'price',
        anchors,
        style: { lineColor: '#abc', lineWidth: 3, lineStyle: 'dashed' },
        locked: false,
        visible: true,
        zIndex: 4,
        createdAt: 7,
        props: { depth: 3, nested: { a: [1, 2] } },
        ...extra,
    });

    it('stay in the document, record for record', () => {
        const store = new DrawingStore();
        store.load({ version: 1, drawings: [doc()] });
        const held = store.get('dw-1')!;
        expect(held).toBeInstanceOf(UnknownDrawing);
        expect(JSON.parse(JSON.stringify(store.serialize().drawings[0]))).toEqual(doc());
    });

    it('show as a placeholder that can be found', () => {
        const d = reviveDrawing(doc());
        expect(d.hitTest(70, 45, projector(), 4)).toBe(true);
        const rec = recordingCtx();
        new DrawingPainter().paintAll(rec.ctx, [d], projector(), theme);
        expect(rec.count('lineTo')).toBeGreaterThanOrEqual(1);
    });

    it('come back as themselves once their type is registered, and leave again with it', () => {
        const store = new DrawingStore();
        store.load({ version: 1, drawings: [doc()] });
        const off = defineDrawing({ type: 'acme.later', label: 'Later', props: { depth: 1 }, shapes: () => [] });
        expect(store.refreshTypes()).toBe(true);
        const real = store.get('dw-1') as ShapeDrawing<{ depth: number }>;
        expect(real).toBeInstanceOf(ShapeDrawing);
        expect(real.props.depth).toBe(3); // the saved setting, not the definition's default
        expect(real.style.lineWidth).toBe(3);
        off();
        store.refreshTypes();
        expect(store.get('dw-1')).toBeInstanceOf(UnknownDrawing);
        expect(store.serialize().drawings[0]!.props).toEqual({ depth: 3, nested: { a: [1, 2] } });
    });
});

describe('the registry reaches the charts', () => {
    class Port implements IDrawingsRendererPort {
        toolbars: ToolbarDefinition[] = [];
        synced: SerializedDrawing[] = [];
        favorites: string[][] = [];
        setToolbar(def: ToolbarDefinition): void {
            this.toolbars.push(def);
        }
        showToolbar(): void {}
        syncDrawings(docs: readonly SerializedDrawing[]): void {
            this.synced = [...docs];
        }
        setActiveTool(): void {}
        setSelection(): void {}
        setFavorites(types: readonly string[]): void {
            this.favorites.push([...types]);
        }
        openSettings(): void {}
        onDrawingIntent(): () => void {
            return () => {};
        }
    }

    function chart() {
        const port = new Port();
        const events = new TypedEventBus<VelaEventMap>();
        const renderer = { capabilities: { userDrawings: true }, userDrawingsPort: port } as unknown as IChartRenderer;
        const ctrl = new DrawingController(renderer, events, undefined);
        cleanup.push(() => ctrl.destroy());
        return { port, events, ctrl };
    }

    const groupOf = (def: ToolbarDefinition, type: string): string | undefined => def.groups.find((g) => g.tools.some((t) => t.type === type))?.id;

    it('lists a new tool in its own group, and renames the group', () => {
        defineSegment();
        const tb = buildToolbar(undefined).definition;
        const group = tb.groups.find((g) => g.id === 'test-tools')!;
        expect(group.label).toBe('Test tools'); // unlabelled: the id as a name
        expect(group.tools.map((t) => t.type)).toEqual(['test.segment']);
        expect(tb.groups[tb.groups.length - 1]).toBe(group); // after the built-in groups

        registerDrawingGroup({ id: 'test-tools', label: 'My tools' });
        cleanup.push(() => unregisterDrawingGroup('test-tools'));
        expect(buildToolbar(undefined).definition.groups.find((g) => g.id === 'test-tools')!.label).toBe('My tools');
    });

    it('lists a tool that names a built-in group with that group', () => {
        define({ type: 'test.fib', label: 'My fib', group: 'fibonacci', shapes: () => [] });
        define({ type: 'test.line', label: 'My line', group: 'lines', shapes: () => [] });
        const tb = buildToolbar(undefined).definition;
        expect(groupOf(tb, 'test.fib')).toBe('fibonacci-gann');
        expect(groupOf(tb, 'test.line')).toBe('lines-channels-pitchforks');
        // A toolbar restricted to a tool list still only shows what it lists.
        expect(groupOf(buildToolbar({ tools: ['trendline'] }).definition, 'test.fib')).toBeUndefined();
    });

    it('never lists two groups under one id, and leaves out a tool kept off the toolbar', () => {
        define({ type: 'test.intext', label: 'In text', group: 'text', shapes: () => [] });
        define({ type: 'test.hidden', label: 'Hidden', group: 'lines', toolbar: false, shapes: () => [] });
        const tb = buildToolbar(undefined).definition;
        const ids = tb.groups.map((g) => g.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(groupOf(tb, 'test.intext')).toBe('text');
        expect(groupOf(tb, 'test.hidden')).toBeUndefined();
        // A toolbar that lists the tool itself still shows it.
        expect(groupOf(buildToolbar({ tools: ['test.hidden'] }).definition, 'test.hidden')).toBeDefined();
    });

    it('does nothing for a registry change that arrives after the chart is gone', async () => {
        const { port, ctrl } = chart();
        const before = port.toolbars.length;
        define({ type: 'test.late', label: 'Late', shapes: () => [] });
        ctrl.destroy();
        await Promise.resolve();
        expect(port.toolbars.length).toBe(before);
    });

    it('rebuilds only the drawings a registry change concerns', () => {
        const store = new DrawingStore();
        store.add(createDrawing('hline', { id: 'h', paneId: 'price', anchors: [anchors[0]!] })!);
        const before = store.get('h');
        const changed = vi.fn();
        store.onChange(changed);
        define({ type: 'test.unrelated', label: 'Unrelated', shapes: () => [] });
        expect(store.refreshTypes()).toBe(false);
        expect(store.get('h')).toBe(before);
        expect(changed).not.toHaveBeenCalled();
    });

    it('refreshes a live chart: the toolbar, the placed drawings and the favorites', async () => {
        const { port, events, ctrl } = chart();
        const types = vi.fn();
        events.on('drawing:types', types);
        ctrl.fromJSON({ version: 1, drawings: [{ id: 'dw-1', type: 'test.segment', paneId: 'price', anchors, style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' }, locked: false, visible: true, zIndex: 1, createdAt: 0, props: { ratio: 0.75 } }] });
        ctrl.setFavorites(['trendline', 'test.segment']); // restored before the plugin loaded
        expect(ctrl.favorites()).toEqual(['trendline']);
        expect(ctrl.all()).toHaveLength(1); // kept, as a placeholder
        const before = port.toolbars.length;

        defineSegment();
        await Promise.resolve(); // the follow-up runs once the registering code is done
        expect(port.toolbars.length).toBe(before + 1);
        expect(groupOf(port.toolbars[port.toolbars.length - 1]!, 'test.segment')).toBe('test-tools');
        expect(ctrl.favorites()).toEqual(['trendline', 'test.segment']);
        expect(port.synced[0]!.props).toEqual({ ratio: 0.75 });
        expect(types).toHaveBeenCalledTimes(1);

        // The tool can now be placed from code like any other.
        expect(ctrl.add('test.segment', { anchors })).not.toBeNull();

        unregisterDrawingType('test.segment');
        await Promise.resolve();
        expect(groupOf(port.toolbars[port.toolbars.length - 1]!, 'test.segment')).toBeUndefined();
        expect(ctrl.favorites()).toEqual(['trendline']);
        expect(ctrl.all()).toHaveLength(2); // the drawings stay
    });

    it('follows the registry once for a batch of registrations', async () => {
        const { port } = chart();
        const before = port.toolbars.length;
        const seen = vi.fn();
        cleanup.push(onDrawingTypesChange(seen));
        define({ type: 'test.b1', label: 'B1', shapes: () => [] });
        define({ type: 'test.b2', label: 'B2', shapes: () => [] });
        expect(seen).toHaveBeenCalledTimes(2);
        await Promise.resolve();
        expect(port.toolbars.length).toBe(before + 1);
    });

    it('keeps the remembered settings of a tool that is not registered yet', () => {
        const { ctrl } = chart();
        ctrl.setToolDefaults({ 'acme.later': { style: { lineColor: '#123456', lineWidth: 2, lineStyle: 'solid' } } });
        expect(ctrl.toolDefaults()['acme.later']).toBeDefined();
    });

    it('answers a drawing value and readout from the model when the renderer has none', () => {
        define({ type: 'test.flatline', label: 'Flat line', anchors: 1, shapes: () => [], valueAt: (_t, d) => d.anchors[0]!.price, readout: () => [{ label: 'Level', value: '80' }] });
        const { ctrl } = chart();
        const d = ctrl.add('test.flatline', { anchors: [anchors[0]!] }) as Drawing;
        expect(ctrl.valueAt(d.id, 999)).toBe(80);
        expect(ctrl.readout(d.id)).toEqual([{ label: 'Level', value: '80' }]);
        expect(ctrl.valueAt('nope', 0)).toBeNull();
    });
});
