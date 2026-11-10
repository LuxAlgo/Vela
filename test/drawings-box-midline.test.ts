// @vitest-environment jsdom
// A rectangle's optional midline: a line at the halfway price between its top and bottom,
// across its full width, off by default. It takes the border color until one is picked, is
// dashed until restyled, and travels with the rectangle — saved documents, tool styles, the
// drawings link across charts, and the settings panel.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import {
    createDrawing,
    deserializeDrawing,
    applyToolDefaults,
    captureToolDefaults,
    resetDrawingSettings,
    type Box,
    type Drawing,
    type Projector,
    type SerializedDrawing,
} from '../src/core/drawings';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { DrawingSettingsPopup, type SettingsActions } from '../src/renderers/native/drawings/DrawingSettingsPopup';
import { dashPattern } from '../src/renderers/shared/drawing-geometry';
import { DARK_THEME } from '../src/core/theme';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { VelaTheme } from '../src/core/options';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

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
        measureText: () => ({ width: 0 }),
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
    it('is off on a new rectangle', () => {
        const r = rect();
        expect(r.box.midline).toBe(false);
        expect(lines(r)).toEqual([]);
    });

    it('a rectangle saved before the midline existed loads without one and paints as before', () => {
        const r = deserializeDrawing(OLD_DOC) as Box;
        expect(r.box.midline).toBe(false);
        expect(paint(r)).toEqual([
            { kind: 'fillRect', rect: [10, 40, 100, 40] },
            { kind: 'strokeRect', rect: [10, 40, 100, 40] },
        ]);
    });

    it('switched on, draws one line at the exact halfway price across the full width of the box', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true });
        // Prices 20 and 60: halfway is 40, which this projector puts at y = 60.
        expect(lines(r).map((l) => l.segments)).toEqual([[[10, 60, 110, 60]]]);
    });

    it('sits at the halfway price, not the halfway pixel, on a log scale', () => {
        const r = rect({ anchors: [{ time: 10, price: 10 }, { time: 110, price: 1000 }] });
        r.applySettings({ 'box.midline': true });
        const [mid] = lines(r, logScale);
        expect(mid!.segments[0]![1]).toBeCloseTo(logScale.yOf(505, 'price')!, 9);
    });

    it('spans the box whichever way it was drawn', () => {
        const r = rect({ anchors: [{ time: 110, price: 60 }, { time: 10, price: 20 }] });
        r.applySettings({ 'box.midline': true });
        expect(lines(r)[0]!.segments).toEqual([[10, 60, 110, 60]]);
    });

    it('follows the box when it is resized or moved', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true });
        r.dragHandle(1, { time: 210, price: 80 }); // the far corner: now 20 → 80
        expect(lines(r)[0]!.segments).toEqual([[10, 50, 210, 50]]);
        r.anchors = r.translateBody(5, 10, r.anchors);
        expect(lines(r)[0]!.segments).toEqual([[15, 40, 215, 40]]);
    });

    it('paints over the fill and under the text', () => {
        const r = rect({ text: { value: 'IB', size: 'normal', hAlign: 'center', vAlign: 'center' } });
        r.applySettings({ 'box.midline': true });
        expect(paint(r).map((o) => o.kind)).toEqual(['fillRect', 'stroke', 'strokeRect', 'text']);
    });

    it('takes the border color until a color is picked, then keeps its own', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true, 'style.lineColor': '#ff8800' });
        expect(lines(r)[0]!.color).toBe('#ff8800');
        r.applySettings({ 'style.lineColor': '#00ff00' }); // the border changes: the midline follows
        expect(lines(r)[0]!.color).toBe('#00ff00');
        r.applySettings({ 'box.midColor': '#ffffff' });
        r.applySettings({ 'style.lineColor': '#123456' }); // a picked color stays put
        expect(lines(r)[0]!.color).toBe('#ffffff');
    });

    it('is dashed by default, at the border width, and takes the style picked for it', () => {
        const r = rect({ style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' } });
        r.applySettings({ 'box.midline': true });
        expect(r.box.midStyle).toBe('dashed');
        expect(lines(r)[0]!.dash).toEqual(dashPattern('dashed', 2));
        expect(lines(r)[0]!.width).toBe(2);
        r.applySettings({ 'box.midStyle': 'dotted' });
        expect(lines(r)[0]!.dash).toEqual(dashPattern('dotted', 2));
    });

    it('survives saving and reloading, picked color and style included', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true, 'box.midColor': '#ffffff', 'box.midStyle': 'dotted' });
        const back = deserializeDrawing(JSON.parse(JSON.stringify(r.serialize()))) as Box;
        expect(back.box).toEqual({ midline: true, midColor: '#ffffff', midStyle: 'dotted' });
        expect(lines(back)).toEqual(lines(r));
    });

    it('an unpicked color stays unpicked across a reload, so it keeps following the border', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true });
        const back = deserializeDrawing(JSON.parse(JSON.stringify(r.serialize()))) as Box;
        back.applySettings({ 'style.lineColor': '#abcdef' });
        expect(lines(back)[0]!.color).toBe('#abcdef');
    });

    it('ignores malformed saved settings and falls back to the defaults', () => {
        const back = deserializeDrawing({ ...OLD_DOC, props: { midline: 'yes', midColor: 5, midStyle: 'wavy' } }) as Box;
        expect(back.box).toEqual({ midline: false, midStyle: 'dashed' });
    });

    it('a style saved with the midline off switches it off', () => {
        const plain = captureToolDefaults(rect());
        const r = rect();
        r.applySettings({ 'box.midline': true });
        applyToolDefaults(r, plain);
        expect(r.box.midline).toBe(false);
    });

    it('reset settings switches the midline off and forgets its color', () => {
        const r = rect();
        r.applySettings({ 'box.midline': true, 'box.midColor': '#ffffff', 'box.midStyle': 'solid' });
        resetDrawingSettings(r);
        expect(r.box).toEqual({ midline: false, midStyle: 'dashed' });
    });
});

describe('a rectangle midline on a chart', () => {
    const live: VelaWorkspace[] = [];
    afterEach(() => {
        for (const ws of live.splice(0)) ws.destroy();
        document.body.replaceChildren();
    });
    const workspace = (opts: Record<string, unknown>): VelaWorkspace => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, opts as never);
        live.push(ws);
        return ws;
    };
    const SYNC_ANCHORS = [
        { time: Date.UTC(2024, 0, 2), price: 100 },
        { time: Date.UTC(2024, 0, 9), price: 120 },
    ];

    it('a saved tool style carries the midline onto the next rectangle, through a reload of the styles', () => {
        const ws = workspace({ layout: '1' });
        const chart = ws.cell('c1')!.chart.drawings;
        const styled = rect();
        styled.applySettings({ 'box.midline': true, 'box.midColor': '#ffffff', 'box.midStyle': 'solid' });
        chart.setToolTemplates(JSON.parse(JSON.stringify({ box: [{ name: 'Range', settings: captureToolDefaults(styled) }] })));
        const [saved] = JSON.parse(JSON.stringify(chart.toolTemplates())).box;
        const next = rect();
        applyToolDefaults(next, saved.settings);
        expect(next.box).toEqual({ midline: true, midColor: '#ffffff', midStyle: 'solid' });
        expect(lines(next)[0]!.segments).toEqual([[10, 60, 110, 60]]);
    });

    it("a rectangle's remembered settings start the next one with its midline", () => {
        const ws = workspace({ layout: '1' });
        const chart = ws.cell('c1')!.chart.drawings;
        const styled = rect();
        styled.applySettings({ 'box.midline': true });
        chart.setToolDefaults(JSON.parse(JSON.stringify({ box: captureToolDefaults(styled) })));
        const next = chart.add('box', { anchors: SYNC_ANCHORS }) as Box;
        expect(next.box).toEqual({ midline: true, midStyle: 'dashed' });
    });

    it("the chart's saved drawings bring the midline back", () => {
        const ws = workspace({ layout: '1' });
        const chart = ws.cell('c1')!.chart.drawings;
        chart.add('box', { anchors: SYNC_ANCHORS, props: { midline: true, midColor: '#ffffff' } });
        const saved = JSON.parse(JSON.stringify(chart.getConfig()));
        const other = workspace({ layout: '1' }).cell('c1')!.chart.drawings;
        other.applyConfig(saved);
        expect(other.all()[0]!.props).toEqual({ midline: true, midColor: '#ffffff', midStyle: 'dashed' });
    });

    it('a linked copy arrives with the midline, and turning it on or recoloring it follows', () => {
        const ws = workspace({ layout: '2h', sync: { drawings: true } });
        const c1 = ws.cell('c1')!.chart.drawings;
        const c2 = ws.cell('c2')!.chart.drawings;
        const original = c1.add('box', { anchors: SYNC_ANCHORS, props: { midline: true, midStyle: 'dotted' } })!;
        expect(c2.all()[0]!.props).toEqual({ midline: true, midStyle: 'dotted' });

        c1.update(original.id, { props: { midline: true, midColor: '#ffffff', midStyle: 'solid' } });
        expect(c2.all()[0]!.props).toEqual({ midline: true, midColor: '#ffffff', midStyle: 'solid' });
        c1.update(original.id, { props: { midline: false, midStyle: 'solid' } });
        expect(c2.all()[0]!.props).toEqual({ midline: false, midStyle: 'solid' });
    });
});

describe('a rectangle midline in the settings panel', () => {
    afterEach(() => document.body.replaceChildren());

    async function openPanel(drawing: Drawing) {
        const host = document.createElement('div');
        document.body.append(host);
        let live = drawing;
        const actions: SettingsActions = {
            resolve: () => live,
            patch: (p) => {
                live.applySettings(p);
                live = deserializeDrawing(live.serialize())!;
            },
            setLocked: () => {},
            reorder: () => {},
            duplicate: () => {},
            resetSettings: () => {},
            remove: () => {},
        };
        const popup = new DrawingSettingsPopup(host, DARK_THEME, { chartBarMs: () => 60_000, timeZone: () => 'UTC' });
        popup.open([drawing], null, actions);
        host.querySelector<HTMLButtonElement>('.vela-dpop [data-tip="Settings"]')!.click();
        await new Promise((r) => setTimeout(r, 50));
        const row = (label: string): HTMLElement | undefined => [...host.querySelectorAll<HTMLElement>('.vela-dsp-row')].find((r) => r.querySelector('.vela-dsp-lab')?.textContent === label);
        return { popup, row, live: () => live as Box };
    }

    it('offers a Midline switch; its color and style show only while it is on', async () => {
        const p = await openPanel(rect());
        expect(p.row('Midline')).toBeDefined();
        expect(p.row('Midline color')!.hidden).toBe(true);
        expect(p.row('Midline style')!.hidden).toBe(true);

        p.row('Midline')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        p.popup.syncPanel();
        expect(p.live().box.midline).toBe(true);
        expect(p.row('Midline color')!.hidden).toBe(false);
        expect(p.row('Midline style')!.hidden).toBe(false);
        p.popup.destroy();
    });

    it('shows the border color as the midline color until one is picked', async () => {
        const p = await openPanel(rect({ style: { lineColor: '#ff8800', lineWidth: 1, lineStyle: 'solid' }, props: { midline: true } }));
        const swatch = (): string => p.row('Midline color')!.querySelector<HTMLElement>('.vela-color-field-swatch')!.style.background;
        expect(swatch()).toContain('rgb(255, 136, 0)'); // #ff8800
        p.popup.destroy();
    });
});
