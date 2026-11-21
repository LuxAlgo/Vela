import { describe, it, expect } from 'vitest';
import { DrawingInteraction } from '../src/renderers/native/drawings/DrawingInteraction';
import { createDrawing, type Drawing, type DrawingIntent, type DrawingPoint, type Projector } from '../src/core/drawings';

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

/** A box from (10, 10) to (50, 50): its anchor corners sit at px (10, 90) and (50, 50). */
function box(): Drawing {
    return createDrawing('box', { id: 'dw-1', paneId: 'price', anchors: [{ time: 10, price: 10 }, { time: 50, price: 50 }] })!;
}

/** Press at `from`, drag to `to`, release; returns the box's anchors from the committed edit. */
function drag(d: Drawing, from: [number, number], to: [number, number]): DrawingPoint[] | undefined {
    const intents: DrawingIntent[] = [];
    const it = new DrawingInteraction({
        projector: fakeProjector,
        activeTool: () => null,
        drawings: () => [d],
        hoveredId: () => d.id,
        selectedIds: () => new Set([d.id]),
        emit: (i) => intents.push(i),
        changed: () => {},
        openSettings: () => {},
        snap: (pt) => pt,
        toolDefaults: () => undefined,
    });
    it.down(from[0], from[1]);
    it.move(to[0], to[1]);
    it.up(to[0], to[1]);
    const edit = intents.find((i) => i.kind === 'edit');
    return edit?.kind === 'edit' ? edit.doc.anchors : undefined;
}

describe('rectangle handles', () => {
    it('a rectangle shows eight handles: four corners and the middle of each side', () => {
        const pts = box().handlePoints(fakeProjector());
        expect(pts).toHaveLength(8);
        expect(pts).toEqual(
            expect.arrayContaining([
                [10, 90],
                [50, 50],
                [50, 90],
                [10, 50],
                [30, 90],
                [50, 70],
                [30, 50],
                [10, 70],
            ]),
        );
    });

    it('dragging the middle of the top side moves only the top', () => {
        expect(drag(box(), [30, 50], [42, 35])).toEqual([
            { time: 10, price: 10 },
            { time: 50, price: 65 },
        ]);
    });

    it('dragging the middle of the left side moves only the left side', () => {
        expect(drag(box(), [10, 70], [0, 62])).toEqual([
            { time: 0, price: 10 },
            { time: 50, price: 50 },
        ]);
    });

    it('dragging one of the two added corners resizes both of its sides', () => {
        // (50, 90) is the corner that takes its x from the far anchor and its y from the near one.
        expect(drag(box(), [50, 90], [65, 95])).toEqual([
            { time: 10, price: 5 },
            { time: 65, price: 50 },
        ]);
    });

    it('dragging an original corner still moves that corner freely', () => {
        expect(drag(box(), [10, 90], [4, 96])).toEqual([
            { time: 4, price: 4 },
            { time: 50, price: 50 },
        ]);
    });
});
