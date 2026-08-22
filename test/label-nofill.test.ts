import { describe, it, expect } from 'vitest';
import { DrawingSceneRenderer, EMPTY_DRAWING_SET } from '../src/renderers/shared/DrawingSceneRenderer';
import type { DrawingLabel } from '../src/core/model/drawings';
import type { VelaTheme } from '../src/core/options';

/**
 * A `noFill` label (Pine `color = na`) must keep its STYLE's geometry: the text
 * sits exactly where the bubble would have put it — only the bubble/pointer fill
 * is skipped. The old behavior collapsed every noFill bubble style to
 * anchor-centered text, so `label.style_label_up` rendered like `label_center`.
 */

/** Records every `fillText` (string, x, y, fillStyle at call time) and counts `fill()`. */
function recordingCtx() {
    const texts: Array<{ text: string; x: number; y: number; fillStyle: string }> = [];
    let fills = 0;
    const ctx = {
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textAlign: 'left',
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
        stroke() {},
        fill() {
            fills += 1;
        },
        fillRect() {},
        setLineDash() {},
        measureText: () => ({ width: 20 }),
        fillText(text: string, x: number, y: number) {
            texts.push({ text, x, y, fillStyle: String(this.fillStyle) });
        },
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, texts: () => texts, fills: () => fills };
}

const theme = { textColor: '#e0e0e0', fontFamily: 'sans-serif' } as unknown as VelaTheme;

function makeLabel(style: DrawingLabel['style'], noFill: boolean): DrawingLabel {
    return {
        id: 'lb',
        paneId: 'price',
        xloc: 'bar_index',
        x: 5,
        y: 40,
        yloc: 'price',
        text: 'T',
        style,
        color: noFill ? undefined : '#2962ff',
        noFill,
        size: 'normal',
        textAlign: 'center',
        fontFamily: 'default',
    };
}

/** Render one label and return what got painted. px = x*10 = 50, py = 100−y = 60. */
function paint(label: DrawingLabel) {
    const r = new DrawingSceneRenderer({ timeToLogical: (ms) => ms, barAt: () => null, theme });
    r.setSet({ ...EMPTY_DRAWING_SET, labels: [label] });
    const { ctx, texts, fills } = recordingCtx();
    r.render(ctx, 200, 100, (l) => l * 10, (p) => 100 - p);
    return { texts: texts(), fills: fills() };
}

const ANCHOR_Y = 60;

describe('noFill labels keep their style geometry', () => {
    it('label_up with noFill puts the text below the anchor, exactly where the filled bubble would', () => {
        const filled = paint(makeLabel('label_up', false));
        const noFill = paint(makeLabel('label_up', true));

        expect(filled.fills).toBeGreaterThan(0); // bubble + pointer painted
        expect(noFill.fills).toBe(0); // na color → nothing filled

        expect(filled.texts).toHaveLength(1);
        expect(noFill.texts).toHaveLength(1);
        // Identical placement: only the bubble visibility differs.
        expect(noFill.texts[0]!.x).toBe(filled.texts[0]!.x);
        expect(noFill.texts[0]!.y).toBe(filled.texts[0]!.y);
        // label_up hangs below its anchor — NOT centered on it.
        expect(noFill.texts[0]!.y).toBeGreaterThan(ANCHOR_Y);
    });

    it('label_up and label_center with noFill place the text differently (the reported bug)', () => {
        const up = paint(makeLabel('label_up', true));
        const center = paint(makeLabel('label_center', true));
        expect(up.texts[0]!.y).not.toBe(center.texts[0]!.y);
        // label_center is symmetric around the anchor.
        expect(center.texts[0]!.y).toBeCloseTo(ANCHOR_Y, 5);
    });

    it('noFill text without an explicit textColor uses the theme text color, not bubble contrast', () => {
        const noFill = paint(makeLabel('label_up', true));
        expect(noFill.texts[0]!.fillStyle).toBe('#e0e0e0');
    });
});
