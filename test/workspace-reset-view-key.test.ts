// @vitest-environment jsdom
// The "Reset chart view" key (Alt+R) does what the chart menu's "Reset chart view" row
// does: it resumes auto scale on a price scale the user dragged, and frames the whole
// history with the right margin. It used to frame the history only, so a dragged price
// scale stayed frozen and the top and bottom margins never came back.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const WORKSPACE_TIMEOUT = 30_000;

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

describe('the reset chart view key', () => {
    it('resets the active chart the same way the chart menu row does', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false } as never);
        disposers.push(() => ws.destroy());
        const reset = vi.spyOn(ws.active, 'resetView');
        const setAuto = vi.spyOn(ws.active.chart.renderer, 'set');

        const handled = ws.keymap.handleKeydown(new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', altKey: true }));

        expect(handled).toBe(true);
        expect(reset).toHaveBeenCalledTimes(1);
        expect(setAuto).toHaveBeenCalledWith('autoScale', true); // a dragged price scale fits the data again
    }, WORKSPACE_TIMEOUT);
});
