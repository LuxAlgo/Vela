import { describe, it, expect } from 'vitest';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
import { sliceKeyFor } from '../src/renderers/native/drawings/UserDrawingController';
import { createDrawing, type Projector } from '../src/core/drawings';
import type { VelaTheme } from '../src/core/options';

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

/** A canvas context that counts `arc()` calls (each selection handle is one arc) and `lineTo()`
 *  ones (a painted line body — handles are arcs only). */
function recordingCtx() {
    let arcs = 0;
    let lines = 0;
    const ctx = {
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {
            lines += 1;
        },
        stroke() {},
        fill() {},
        setLineDash() {},
        arc() {
            arcs += 1;
        },
        fillRect() {},
        strokeRect() {},
        save() {},
        restore() {},
        fillText() {},
        measureText: () => ({ width: 0 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs: () => arcs, lines: () => lines };
}

const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
const hline = (id: string, price: number) => createDrawing('hline', { id, paneId: 'price', anchors: [{ time: 10, price }] })!;

describe('DrawingPainter.paintAll handle highlighting', () => {
    it('paints handles for every id in the highlight set', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, new Set(['a', 'b']));
        expect(arcs()).toBe(2); // one handle per selected hline
    });

    it('paints no handles when the highlight set is empty', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, new Set());
        expect(arcs()).toBe(0);
    });

    // Drawings interleaved into the series stack paint their bodies on the backend-composited
    // layers, but their handles have to come back to the top canvas — buried under the candles
    // they'd be unusable.
    it('paintHighlights draws handles alone, for the highlighted ones only', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs, lines } = recordingCtx();
        new DrawingPainter().paintHighlights(ctx, drawings, fakeProjector(), new Set(['b']));
        expect(arcs()).toBe(1); // b's handle …
        expect(lines()).toBe(0); // … and neither body
    });
});

describe('sliceKeyFor — which interleave layer a drawing paints on', () => {
    // Boundaries: an indicator at -2, the candles at 0, a raised indicator at 5.
    const bounds = [-2, 0, 5];

    it('a drawing over every boundary stays on the top canvas', () => {
        expect(sliceKeyFor(6, bounds)).toBeNull();
        expect(sliceKeyFor(9, [])).toBeNull();
    });

    it('slots a drawing under the first series at-or-above its z', () => {
        expect(sliceKeyFor(1, bounds)).toBe(5); // between the candles and the raised indicator
        expect(sliceKeyFor(-1, bounds)).toBe(0); // under the candles, over the back indicator
        expect(sliceKeyFor(-9, bounds)).toBe(-2); // under everything
    });

    it('a tie paints under the series carrying that z', () => {
        expect(sliceKeyFor(0, bounds)).toBe(0);
        expect(sliceKeyFor(5, bounds)).toBe(5);
    });
});

describe('DrawingPainter.paintAll pane separation', () => {
    /** fakeProjector + paneRect: 'price' is a live 100px pane; 'hidden' is zero-height. */
    function paneAwareProjector(): Projector {
        return {
            ...fakeProjector(),
            paneRect: (paneId) => (paneId === 'price' ? { top: 0, height: 100 } : paneId === 'hidden' ? { top: 100, height: 0 } : null),
        };
    }

    /** A ctx that additionally counts `clip()` and `stroke()` calls. */
    function clipCountingCtx() {
        const base = recordingCtx();
        let clips = 0;
        let strokes = 0;
        const ctx = base.ctx as unknown as Record<string, unknown>;
        ctx.clip = () => { clips += 1; };
        ctx.rect = () => {};
        const origStroke = ctx.stroke as () => void;
        ctx.stroke = () => { strokes += 1; origStroke(); };
        return { ctx: base.ctx, arcs: base.arcs, clips: () => clips, strokes: () => strokes };
    }

    it('clips each drawing to its pane rect', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, clips } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, drawings, paneAwareProjector(), theme, new Set());
        expect(clips()).toBe(2); // one clip per painted drawing
    });

    it('skips drawings on a hidden (zero-height) pane entirely — body and handles', () => {
        const onHidden = createDrawing('hline', { id: 'h', paneId: 'hidden', anchors: [{ time: 10, price: 30 }] })!;
        const { ctx, arcs, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, [onHidden], paneAwareProjector(), theme, new Set(['h']));
        expect(strokes()).toBe(0); // nothing painted
        expect(arcs()).toBe(0); // no handles either
    });

    it('paints unclipped when the projector exposes no pane geometry (back-compat)', () => {
        const drawings = [hline('a', 30)];
        const { ctx, clips, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, new Set());
        expect(clips()).toBe(0);
        expect(strokes()).toBeGreaterThan(0);
    });
});
