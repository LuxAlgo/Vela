import { describe, it, expect } from 'vitest';
import { DrawingPainter } from '../src/renderers/native/drawings/DrawingPainter';
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

/** A canvas context that only counts `arc()` calls (each selection handle is one arc). */
function recordingCtx() {
    let arcs = 0;
    const ctx = {
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arcTo() {},
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
    return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs: () => arcs };
}

const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
const hline = (id: string, price: number) => createDrawing('hline', { id, paneId: 'price', anchors: [{ time: 10, price }] })!;

describe('DrawingPainter.paintAll handle highlighting', () => {
    it('paints handles for every selected id', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, { selected: new Set(['a', 'b']) });
        expect(arcs()).toBe(2); // one handle per selected hline
    });

    it('paints handles for the hovered and dragged drawings too', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme, { hovered: 'a', dragged: 'b' });
        expect(arcs()).toBe(2);
    });

    it('paints no handles when nothing is targeted', () => {
        const drawings = [hline('a', 30), hline('b', 50)];
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme);
        expect(arcs()).toBe(0);
    });
});

describe('DrawingPainter.paintAll muted label', () => {
    /** A ctx that records the strings passed to `fillText`. */
    function textCountingCtx() {
        const base = recordingCtx();
        const texts: string[] = [];
        (base.ctx as unknown as Record<string, unknown>).fillText = (s: string) => { texts.push(s); };
        return { ctx: base.ctx, texts: () => texts };
    }

    const label = (id: string) => createDrawing('text', { id, paneId: 'price', anchors: [{ time: 10, price: 50 }], text: { value: 'Buy zone', size: 'normal', hAlign: 'left', vAlign: 'top' } })!;

    it('paints a text label normally', () => {
        const { ctx, texts } = textCountingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme);
        expect(texts()).toEqual(['Buy zone']);
    });

    it('leaves the muted label to its inline editor (and only that one)', () => {
        const { ctx, texts } = textCountingCtx();
        new DrawingPainter().paintAll(ctx, [label('a'), label('b')], fakeProjector(), theme, { mutedLabel: 'a' });
        expect(texts()).toEqual(['Buy zone']); // 'b' still painted, 'a' muted
    });

    it('hides the muted label\u2019s drag handle too (typing, not dragging)', () => {
        const { ctx, arcs } = recordingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme, { selected: new Set(['a']), mutedLabel: 'a' });
        expect(arcs()).toBe(0);
    });
});

describe('DrawingPainter.paintAll text label frame', () => {
    /** A ctx that records the stroke color of every `stroke()` (the frame is the only stroke here). */
    function strokeRecordingCtx() {
        const base = recordingCtx();
        const strokes: string[] = [];
        const ctx = base.ctx as unknown as Record<string, unknown>;
        ctx.strokeStyle = '';
        ctx.stroke = () => { strokes.push(String(ctx.strokeStyle)); };
        return { ctx: base.ctx, strokes: () => strokes };
    }

    const label = (id: string) => createDrawing('text', { id, paneId: 'price', anchors: [{ time: 10, price: 50 }], text: { value: 'Buy zone', size: 'normal', hAlign: 'left', vAlign: 'top' } })!;
    const frame = (targets: { selected?: ReadonlySet<string>; hovered?: string | null }): string[] => {
        const { ctx, strokes } = strokeRecordingCtx();
        new DrawingPainter().paintAll(ctx, [label('a')], fakeProjector(), theme, targets);
        // Targeting also paints the handle (a hex-colored border); the frame is the themed rgba stroke.
        return strokes().filter((s) => s.startsWith('rgba('));
    };

    it('frames a selected text label, and a hovered one more faintly', () => {
        const selected = frame({ selected: new Set(['a']) });
        const hovered = frame({ hovered: 'a' });
        expect(selected).toHaveLength(1);
        expect(hovered).toHaveLength(1);
        expect(selected[0]).toContain('0.3'); // firm once clicked
        expect(hovered[0]).toContain('0.12'); // a hint under the cursor
    });

    it('leaves an untargeted label unframed', () => {
        expect(frame({})).toEqual([]);
        expect(frame({ selected: new Set(['other']), hovered: 'other' })).toEqual([]);
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
        new DrawingPainter().paintAll(ctx, drawings, paneAwareProjector(), theme);
        expect(clips()).toBe(2); // one clip per painted drawing
    });

    it('skips drawings on a hidden (zero-height) pane entirely — body and handles', () => {
        const onHidden = createDrawing('hline', { id: 'h', paneId: 'hidden', anchors: [{ time: 10, price: 30 }] })!;
        const { ctx, arcs, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, [onHidden], paneAwareProjector(), theme, { selected: new Set(['h']) });
        expect(strokes()).toBe(0); // nothing painted
        expect(arcs()).toBe(0); // no handles either
    });

    it('paints unclipped when the projector exposes no pane geometry (back-compat)', () => {
        const drawings = [hline('a', 30)];
        const { ctx, clips, strokes } = clipCountingCtx();
        new DrawingPainter().paintAll(ctx, drawings, fakeProjector(), theme);
        expect(clips()).toBe(0);
        expect(strokes()).toBeGreaterThan(0);
    });
});
