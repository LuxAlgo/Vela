// A drawing can be limited to some timeframes — a weekly level kept off a one-minute chart.
// The limit is part of the drawing: it rides its saved document and can be lifted again.
import { describe, it, expect } from 'vitest';
import { TypedEventBus } from '../src/core/events/EventBus';
import type { VelaEventMap } from '../src/core/events/types';
import { DrawingController } from '../src/core/drawings/DrawingController';
import { shownOnTimeframe, timeframeBandOf, sanitizeShowOn } from '../src/core/drawings';
import type { IDrawingsRendererPort } from '../src/core/drawings';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ANCHORS = [
    { time: 1000, price: 10 },
    { time: 2000, price: 20 },
];

function controller(): DrawingController {
    const port: IDrawingsRendererPort = {
        setToolbar() {},
        showToolbar() {},
        syncDrawings() {},
        setActiveTool() {},
        setSelection() {},
        openSettings() {},
        onDrawingIntent: () => () => {},
    };
    const renderer = { capabilities: { userDrawings: true }, userDrawingsPort: port } as unknown as IChartRenderer;
    return new DrawingController(renderer, new TypedEventBus<VelaEventMap>(), undefined);
}

describe('showing a drawing only on some timeframes', () => {
    it('a drawing with no limit shows on every timeframe', () => {
        for (const ms of [1000, MIN, 15 * MIN, HOUR, DAY, 7 * DAY, 30 * DAY]) expect(shownOnTimeframe(undefined, ms)).toBe(true);
    });

    it('a drawing limited to 1H and up shows on a 4H chart but not on a 5-minute one', () => {
        const higher = ['60', '240', 'D', 'W', 'M'];
        expect(shownOnTimeframe(higher, 4 * HOUR)).toBe(true);
        expect(shownOnTimeframe(higher, DAY)).toBe(true);
        expect(shownOnTimeframe(higher, 5 * MIN)).toBe(false);
    });

    it('a custom timeframe counts as the nearest standard one below it', () => {
        expect(timeframeBandOf(3 * MIN)).toBe('1');
        expect(timeframeBandOf(2 * HOUR)).toBe('60');
        expect(timeframeBandOf(12 * HOUR)).toBe('240');
        expect(timeframeBandOf(30 * 1000)).toBe('s');
        expect(shownOnTimeframe(['60'], 2 * HOUR)).toBe(true);
    });

    it('a drawing on a chart whose timeframe is not known yet still shows', () => {
        expect(shownOnTimeframe(['D'], 0)).toBe(true);
    });

    it('a drawing limited to no timeframe at all is hidden everywhere', () => {
        expect(shownOnTimeframe([], HOUR)).toBe(false);
        expect(shownOnTimeframe([], DAY)).toBe(false);
    });

    it('the limit survives a save and a restore, and lifting it shows the drawing everywhere again', () => {
        const a = controller();
        const d = a.add('hline', { anchors: [ANCHORS[0]!] })!;
        a.update(d.id, { showOn: ['D', 'W'] });
        const saved = JSON.parse(JSON.stringify(a.toJSON()));

        const b = controller();
        b.fromJSON(saved);
        const restored = b.all()[0]!;
        expect(restored.showOn).toEqual(['D', 'W']);

        b.update(restored.id, { showOn: undefined });
        expect(b.all()[0]!.showOn).toBeUndefined();
        expect(JSON.parse(JSON.stringify(b.toJSON())).drawings[0].showOn).toBeUndefined();
    });

    it('unknown timeframes in a saved document are ignored and the rest kept in order', () => {
        expect(sanitizeShowOn(['W', 'bogus', '5', 5, 'W'])).toEqual(['5', 'W']);
        expect(sanitizeShowOn('D')).toBeUndefined();
    });
});
