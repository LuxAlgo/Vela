// @vitest-environment jsdom
// Maximizing one chart of a split layout must not blow the other charts up to full size.
// They used to span the whole grid under the maximized chart, hidden only by visibility, so
// every chart of a 2×2 layout resized its canvases to full screen: four times the canvas
// memory of the layout itself, enough for iOS Safari to kill the tab on the phone bar's
// maximize button. The other charts now leave the layout while one chart is maximized, keep
// the canvases they had, and come back to their own slots on restore.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { ChartCell } from '../src/workspace/ChartCell';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const WORKSPACE_TIMEOUT = 30_000;
const FULL_GRID = '1 / 1 / -1 / -1';

let restoreCanvas: () => void;
beforeAll(() => {
    restoreCanvas = installCanvasStandIn();
});
afterAll(() => restoreCanvas());

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

function fourChartWorkspace(): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '4' } as never);
    disposers.push(() => ws.destroy());
    return ws;
}

describe('maximizing one chart of a split layout', () => {
    it('takes the other charts out of the layout instead of stretching them to full size', () => {
        const ws = fourChartWorkspace();
        const [first, ...others] = ws.cells() as [ChartCell, ...ChartCell[]];
        expect(others).toHaveLength(3);

        ws.maximizeCell(first.id);

        expect(first.host.style.gridArea).toBe(FULL_GRID);
        expect(first.host.style.display).toBe('');
        for (const cell of others) {
            expect(cell.host.style.display).toBe('none'); // no box, so its canvases keep their size
            expect(cell.host.style.gridArea).not.toBe(FULL_GRID);
        }
    }, WORKSPACE_TIMEOUT);

    it('puts every chart back in its own slot on restore', () => {
        const ws = fourChartWorkspace();
        const cells = ws.cells();
        const slots = cells.map((c) => c.host.style.gridArea);

        ws.maximizeCell(cells[1]!.id);
        ws.maximizeCell(null);

        expect(cells.map((c) => c.host.style.display)).toEqual(['', '', '', '']);
        expect(cells.map((c) => c.host.style.gridArea)).toEqual(slots);
    }, WORKSPACE_TIMEOUT);

    it('leaves the hidden charts out of the layout screenshot', () => {
        const ws = fourChartWorkspace();
        const [first, second] = ws.cells() as [ChartCell, ChartCell];

        ws.maximizeCell(second.id);

        const shot = (ws as unknown as { shotCells(): Array<{ id: string }> }).shotCells();
        expect(shot.map((c) => c.id)).toEqual([second.id]);
        expect(shot.map((c) => c.id)).not.toContain(first.id);
    }, WORKSPACE_TIMEOUT);
});
