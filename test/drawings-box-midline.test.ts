// A rectangle's optional midline: a line halfway between its top and bottom edges, across its
// full width, off by default. It takes the border color until one is picked, is dashed until
// restyled, moves with the box, and breaks around the box's centered label.
import { describe, it, expect } from 'vitest';

import {
    createDrawing,
    deserializeDrawing,
    type Box,
    type Drawing,
    type Projector,
    type SerializedDrawing,
} from '../src/core/drawings';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { dashPattern } from '../src/renderers/shared/drawing-geometry';
import type { VelaTheme } from '../src/core/options';

/** Linear projector: x = time, y = 100 − price, single pane 'price'. */
const linear: Projector = {
    xOf: (t) => t,
    yOf: (price, paneId) => (paneId === 'price' ? 100 - price : null),
    pxToPoint: (x, y) => ({ time: x, price: 100 - y }),
    paneIdAtY: () => 'price',
    width: 300,
    height: 100,
};

/** A log-scale projector: equal price RATIOS are equal pixel steps. */
const logScale: Projector = {
    ...linear,
    yOf: (price, paneId) => (paneId === 'price' ? 300 - 100 * Math.log10(price) : null),
};

interface Stroke {
    color: string;
    width: number;
    dash: number[];
    segments: Array<[number, number, number, number]>;
}

/** A canvas that records each stroked path (its color, width, dash and segments), each stroked
 *  rectangle, and each filled one, in paint order. */
function recordingCtx() {
    const ops: Array<{ kind: 'stroke'; s: Stroke } | { kind: 'strokeRect' | 'fillRect'; rect: number[] } | { kind: 'text'; text: string }> = [];
    let dash: number[] = [];
    let path: Array<[number, number, number, number]> = [];
    let at: [number, number] = [0, 0];
    const ctx = {
        globalAlpha: 1,
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: 'left',
        textBaseline: 'top',
        setTransform() {},
        clearRect() {},
        beginPath() {
            path = [];
        },
        closePath() {},
        moveTo(x: number, y: number) {
            at = [x, y];
        },
        lineTo(x: number, y: number) {
            path.push([at[0], at[1], x, y]);
            at = [x, y];
        },
        arcTo() {},
        arc() {},
        ellipse() {},
        stroke() {
            ops.push({ kind: 'stroke', s: { color: ctx.strokeStyle, width: ctx.lineWidth, dash: [...dash], segments: [...path] } });
        },
        fill() {},
        setLineDash(d: number[]) {
            dash = [...d];
        },
        fillRect(...r: number[]) {
            ops.push({ kind: 'fillRect', rect: r });
        },
        strokeRect(...r: number[]) {
            ops.push({ kind: 'strokeRect', rect: r });
        },
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        fillText(text: string) {
            ops.push({ kind: 'text', text });
        },
        strokeText() {},
        measureText: (text: string) => ({ width: text.length * 8 }), // 8px per character
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const theme = { textColor: '#fff', fontFamily: 'sans-serif', background: '#000' } as unknown as VelaTheme;

function paint(d: Drawing, proj: Projector = linear) {
    const { ctx, ops } = recordingCtx();
    new DrawingPainter().paintAll(ctx, [d], proj, theme);
    return ops;
}

/** The horizontal lines painted for a drawing (a box's border is a stroked rect, not a line). */
const lines = (d: Drawing, proj?: Projector): Stroke[] => paint(d, proj).flatMap((o) => (o.kind === 'stroke' ? [o.s] : []));

const ANCHORS = [
    { time: 10, price: 20 },
    { time: 110, price: 60 },
];

const rect = (extra: Partial<SerializedDrawing> = {}): Box => createDrawing('box', { id: 'r', paneId: 'price', anchors: ANCHORS.map((a) => ({ ...a })), ...extra }) as Box;

/** A rectangle saved before rectangles had a midline: no per-type settings at all. */
const OLD_DOC: SerializedDrawing = {
    id: 'old',
    type: 'box',
    paneId: 'price',
    anchors: ANCHORS,
    style: { lineColor: '#2962ff', lineWidth: 1, lineStyle: 'solid', fillColor: '#2962ff26' },
    locked: false,
    visible: true,
    zIndex: 0,
    createdAt: 1,
};

describe('a rectangle midline', () => {
    it('is off on a new rectangle, and one saved before the midline existed paints as before', () => {
        expect(rect().box.midline).toBe(false);
        expect(lines(rect())).toEqual([]);
        const old = deserializeDrawing(OLD_DOC) as Box;
        expect(old.box.midline).toBe(false);
        expect(paint(old)).toEqual([
            { kind: 'fillRect', rect: [10, 40, 100, 40] },
            { kind: 'strokeRect', rect: [10, 40, 100, 40] },
        ]);
    });

    it('switched on, draws one line halfway between the top and bottom, across the full width', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true });
        // Top edge y = 40, bottom edge y = 80.
        expect(lines(r).map((l) => l.segments)).toEqual([[[10, 60, 110, 60]]]);
    });

    it('on a log scale still splits the box into two equal halves on screen', () => {
        const r = rect({ anchors: [{ time: 10, price: 10 }, { time: 110, price: 1000 }] });
        r.applySettings({ 'box.midline': true });
        const top = logScale.yOf(1000, 'price')!;
        const bottom = logScale.yOf(10, 'price')!;
        expect(lines(r, logScale)[0]!.segments[0]![1]).toBeCloseTo((top + bottom) / 2, 9);
    });

    it('spans the box whichever way it was drawn, and follows it when resized or moved', () => {
        const r = rect({ anchors: [{ time: 110, price: 60 }, { time: 10, price: 20 }] });
        r.applySettings({ 'box.midline': true });
        expect(lines(r)[0]!.segments).toEqual([[10, 60, 110, 60]]);
        r.dragHandle(1, { time: 210, price: 0 }); // the second corner: now 60 → 0
        expect(lines(r)[0]!.segments).toEqual([[110, 70, 210, 70]]);
        r.anchors = r.translateBody(5, 10, r.anchors);
        expect(lines(r)[0]!.segments).toEqual([[115, 60, 215, 60]]);
    });

    it('takes the border color until a color is picked, and is dashed at the border width until restyled', () => {
        const r = rect({ style: { lineColor: '#ff8800', lineWidth: 2, lineStyle: 'solid' } });
        r.applySettings({ 'box.midline': true });
        expect(lines(r)[0]).toMatchObject({ color: '#ff8800', width: 2, dash: dashPattern('dashed', 2) });
        r.applySettings({ 'style.lineColor': '#00ff00' }); // the border changes: the midline follows
        expect(lines(r)[0]!.color).toBe('#00ff00');
        r.applySettings({ 'box.midColor': '#ffffff', 'box.midStyle': 'dotted' });
        r.applySettings({ 'style.lineColor': '#123456' }); // a picked color stays put
        expect(lines(r)[0]).toMatchObject({ color: '#ffffff', dash: dashPattern('dotted', 2) });
    });

    it('survives saving and reloading, and an unpicked color keeps following the border', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true, 'box.midStyle': 'dotted' });
        const back = deserializeDrawing(JSON.parse(JSON.stringify(r.serialize()))) as Box;
        expect(back.box).toEqual({ midline: true, midStyle: 'dotted' });
        expect(lines(back)).toEqual(lines(r));
        back.applySettings({ 'style.lineColor': '#abcdef' });
        expect(lines(back)[0]!.color).toBe('#abcdef');
    });
});

describe("a rectangle midline and the box's label", () => {
    const labelled = (value: string): Box => {
        const r = rect({ text: { value, size: 'normal', hAlign: 'center', vAlign: 'center' } });
        r.applySettings({ 'box.midline': true });
        return r;
    };

    it('breaks around the label, keeping clear of the text on both sides', () => {
        // "Range" is 40px wide at the box's center (x = 60): the line stops 6px short of each side.
        expect(lines(labelled('Range'))[0]!.segments).toEqual([
            [10, 60, 34, 60],
            [86, 60, 110, 60],
        ]);
    });

    it('paints over the fill, under the border and under the label', () => {
        expect(paint(labelled('IB')).map((o) => o.kind)).toEqual(['fillRect', 'stroke', 'strokeRect', 'text']);
    });

    it('a multi-line label clears the line by its widest line', () => {
        expect(lines(labelled('Asia\nSession'))[0]!.segments).toEqual([
            [10, 60, 26, 60],
            [94, 60, 110, 60],
        ]);
    });

    it('a label wider than the box leaves no line showing, and an empty label leaves it whole', () => {
        expect(lines(labelled('Asian Session Range wide label'))[0]!.segments).toEqual([]);
        expect(lines(labelled(''))[0]!.segments).toEqual([[10, 60, 110, 60]]);
    });
});
