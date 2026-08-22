import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET, type DrawingSet } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingLabel } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

// One label at logical 100 / price 100; identity coordinate closures keep the math legible.
const xOf = (l: number): number => l;
const yOf = (p: number): number => p;

const theme = { fontFamily: 'sans-serif', textColor: '#ddd' } as VelaTheme;

function label(over: Partial<DrawingLabel>): DrawingLabel {
    return {
        id: 'l1',
        paneId: 'price',
        xloc: 'bar_index',
        x: 100,
        y: 100,
        yloc: 'price',
        text: 'AB',
        style: 'label_down',
        size: 'normal', // 14px → lineH 17.5
        textAlign: 'center',
        fontFamily: 'default',
        ...over,
    };
}

function setOf(labels: DrawingLabel[]): DrawingSet {
    return { ...EMPTY_DRAWING_SET, labels };
}

/** Records every fillText with the font/textAlign active at call time. */
function recordingCtx() {
    const texts: Array<{ text: string; x: number; y: number; font: string; align: string }> = [];
    let font = '';
    let align = 'start';
    const ctx = {
        set font(v: string) {
            font = v;
        },
        get font(): string {
            return font;
        },
        set textAlign(v: string) {
            align = v;
        },
        get textAlign(): string {
            return align;
        },
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textBaseline: 'alphabetic',
        save() {},
        restore() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arcTo() {},
        arc() {},
        rect() {},
        clip() {},
        fill() {},
        stroke() {},
        fillRect() {},
        strokeRect() {},
        setLineDash() {},
        strokeText() {},
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, font, align });
        },
        measureText: () => ({ width: 10 }),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

function paint(labels: DrawingLabel[]) {
    const scene = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme }, setOf(labels));
    const rec = recordingCtx();
    scene.render(rec.ctx, 800, 400, xOf, yOf);
    return { scene, texts: rec.texts };
}

// Bubble geometry at the defaults: text width 10 → w = 22 (padX 6), h = 25.5 (lineH 17.5 + padY 8),
// label_down at (100, 100) → body rect left 89, top 67.5.
const BUBBLE = { left: 89, right: 111, top: 67.5, bottom: 93 };

describe('bubble labels — textalign', () => {
    it('centers by default', () => {
        const { texts } = paint([label({})]);
        expect(texts).toHaveLength(1);
        expect(texts[0]!.align).toBe('center');
        expect(texts[0]!.x).toBe(100);
    });

    it('left-aligns lines against the bubble padding', () => {
        const { texts } = paint([label({ textAlign: 'left' })]);
        expect(texts[0]!.align).toBe('left');
        expect(texts[0]!.x).toBe(BUBBLE.left + 6);
    });

    it('right-aligns lines against the bubble padding', () => {
        const { texts } = paint([label({ textAlign: 'right' })]);
        expect(texts[0]!.align).toBe('right');
        expect(texts[0]!.x).toBe(BUBBLE.right - 6);
    });
});

describe('labels — text_formatting (bold/italic)', () => {
    it('plain labels keep the plain font', () => {
        const { texts } = paint([label({})]);
        expect(texts[0]!.font).toBe('14px sans-serif');
    });

    it('bold and italic reach the bubble font', () => {
        const { texts } = paint([label({ bold: true, italic: true })]);
        expect(texts[0]!.font).toBe('italic bold 14px sans-serif');
    });

    it('bold reaches text-only labels too', () => {
        const { texts } = paint([label({ style: 'none', bold: true })]);
        expect(texts[0]!.font).toBe('bold 14px sans-serif');
    });
});

describe('labels — tooltip hit regions', () => {
    it('a bubble with a tooltip exposes its body rect', () => {
        const { scene } = paint([label({ tooltip: 'hello' })]);
        const regions = scene.labelTipRegions();
        expect(regions).toHaveLength(1);
        expect(regions[0]).toEqual({ ...BUBBLE, text: 'hello' });
    });

    it('point shapes expose a square around the marker', () => {
        const { scene } = paint([label({ style: 'circle', tooltip: 'dot' })]);
        const r = scene.labelTipRegions()[0]!;
        // r = max(4, 14*0.6) + 3 = 11.4 around (100, 100)
        expect(r.left).toBeCloseTo(88.6);
        expect(r.right).toBeCloseTo(111.4);
        expect(r.top).toBeCloseTo(88.6);
        expect(r.bottom).toBeCloseTo(111.4);
        expect(r.text).toBe('dot');
    });

    it('text-only labels expose the text block, honoring textalign', () => {
        const { scene } = paint([label({ style: 'none', textAlign: 'left', tooltip: 'txt' })]);
        const r = scene.labelTipRegions()[0]!;
        expect(r.left).toBe(100); // left-aligned text starts at the anchor
        expect(r.right).toBe(110);
        expect(r.text).toBe('txt');
    });

    it('labels without a tooltip contribute nothing, and regions reset per render', () => {
        const { scene } = paint([label({})]);
        expect(scene.labelTipRegions()).toHaveLength(0);
        // Re-render with a tooltip-carrying set, then again without: stale regions must not survive.
        const rec = recordingCtx();
        scene.setSet(setOf([label({ tooltip: 'x' })]));
        scene.render(rec.ctx, 800, 400, xOf, yOf);
        expect(scene.labelTipRegions()).toHaveLength(1);
        scene.setSet(setOf([label({})]));
        scene.render(rec.ctx, 800, 400, xOf, yOf);
        expect(scene.labelTipRegions()).toHaveLength(0);
    });
});
