// @vitest-environment jsdom
// Free panning on a real chart (native renderer, canvas stand-in): the `freePan` option,
// the middle drag that turns an auto-scaled pane manual without a jump, the A chip, the
// Canvas tab switch and its round trip through the saved config.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Vela } from '../src/index';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';
import { mergeConfig } from '../src/renderers/native/core/chartConfig';
import { shiftScale } from '../src/renderers/native/core/manualScale';
import { cellChartDefaults } from '../src/workspace/ChartCell';
import { installCanvasStandIn } from './support/canvas-stand-in';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

const bars: OHLCV[] = Array.from({ length: 1000 }, (_, i) => {
    const base = 100 + Math.sin(i / 6) * 10;
    return { time: 1_700_000_000_000 + i * 60_000, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1 };
});

let restoreCanvas: () => void;
beforeAll(() => {
    restoreCanvas = installCanvasStandIn();
});
afterAll(() => restoreCanvas());

const charts: Vela[] = [];
afterEach(() => {
    for (const c of charts.splice(0)) c.destroy();
    document.body.replaceChildren();
});

function chart(options: ConstructorParameters<typeof Vela>[1] = {}): Vela {
    const host = document.createElement('div');
    document.body.append(host);
    const c = new Vela(host, { data: bars, live: false, animations: false, ...options });
    charts.push(c);
    return c;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the pane scales and the data canvas live behind the renderer; reading them IS the behavior under test */
type Scale = { min: number; max: number };
function internals(c: Vela): any {
    return (c as any).rendererPort;
}

/** The price pane once the bars have loaded and a frame has autoscaled it. */
async function pane(c: Vela): Promise<{ scale: Scale; manualScale: Scale | null; bounds: { top: number; height: number } }> {
    const n = internals(c);
    for (let i = 0; i < 50 && n.coords.barCount === 0; i++) await new Promise((r) => setTimeout(r, 5));
    n.renderFrame(4);
    return n.scene.panes.get('price');
}

function pointer(c: Vela, type: string, init: { button?: number; x: number; y: number; buttons?: number }): void {
    const canvas: HTMLCanvasElement = internals(c).dataCanvas;
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: init.button ?? 0, buttons: init.buttons ?? 0, clientX: init.x, clientY: init.y });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('the freePan option', () => {
    it('is off by default and reads back through the renderer feature', () => {
        expect(chart().renderer.get('freePan')).toBe(false);
        const c = chart({ freePan: true });
        expect(c.renderer.get('freePan')).toBe(true);
        c.renderer.set('freePan', false);
        expect(c.renderer.get('freePan')).toBe(false);
    });

    it('is forwarded by the workspace to every cell chart', () => {
        expect(cellChartDefaults({ freePan: true }).freePan).toBe(true);
    });

    it('never rides the saved config', () => {
        const c = chart({ freePan: true });
        expect(JSON.stringify(c.renderer.getConfig())).not.toContain('freePan');
    });
});

describe('a middle drag on an auto-scaled pane', () => {
    it('pans time and price and switches the pane to manual scale without a jump', async () => {
        const c = chart({ freePan: true });
        const p = await pane(c);
        expect(p.manualScale).toBeNull();
        expect(c.renderer.get('autoScale')).toBe(true);
        const before = { ...p.scale };
        const from = c.getVisibleRange();
        const y = p.bounds.top + p.bounds.height / 2;

        pointer(c, 'pointerdown', { button: 1, x: 400, y });
        expect(p.manualScale).toBeNull(); // a press alone changes nothing
        pointer(c, 'pointermove', { x: 460, y: y + 40, buttons: 4 });

        // The window that went manual is the one on screen, moved by exactly the 40px drag.
        const expected = shiftScale(before, 40, p.bounds.height);
        expect(p.manualScale!.min).toBeCloseTo(expected.min, 6);
        expect(p.manualScale!.max).toBeCloseTo(expected.max, 6);
        expect(p.manualScale!.max - p.manualScale!.min).toBeCloseTo(before.max - before.min, 6);
        // Time moved too: dragging right reveals earlier bars.
        expect(c.getVisibleRange()!.from).toBeLessThan(from!.from);
        // The A (auto) state reads off at once.
        expect(c.renderer.get('autoScale')).toBe(false);
        pointer(c, 'pointerup', { button: 1, x: 460, y: y + 40 });

        // The A chip's click restores autoscale.
        internals(c).togglePaneAuto('price');
        expect(c.renderer.get('autoScale')).toBe(true);
    });

    it('does nothing with the option off', async () => {
        const c = chart();
        const p = await pane(c);
        const before = { ...p.scale };
        const from = c.getVisibleRange();
        const y = p.bounds.top + p.bounds.height / 2;
        pointer(c, 'pointerdown', { button: 1, x: 400, y });
        pointer(c, 'pointermove', { x: 460, y: y + 40, buttons: 4 });
        pointer(c, 'pointerup', { button: 1, x: 460, y: y + 40 });
        expect(p.manualScale).toBeNull();
        expect((await pane(c)).scale).toEqual(before);
        expect(c.getVisibleRange()).toEqual(from);
    });
});

describe('the Canvas tab switch', () => {
    it('defaults off and persists through getConfig / applyConfig', () => {
        const c = chart({ freePan: true });
        expect((c.renderer.getConfig() as ChartConfig).navigation).toEqual({ freeDrag: false });
        c.renderer.applyConfig({ navigation: { freeDrag: true } });
        const saved = c.renderer.getConfig() as ChartConfig;
        expect(saved.navigation.freeDrag).toBe(true);

        const restored = chart({ freePan: true });
        restored.renderer.applyConfig(JSON.parse(JSON.stringify(saved)));
        expect((restored.renderer.getConfig() as ChartConfig).navigation.freeDrag).toBe(true);
        expect(internals(restored).input.freeDrag).toBe(true);
    });

    it('drops malformed values', () => {
        const base = chart().renderer.getConfig() as ChartConfig;
        expect(mergeConfig(base, { navigation: { freeDrag: 'yes' } }).navigation.freeDrag).toBe(false);
    });

    it('only drives the left drag while the option is on', () => {
        const c = chart();
        c.renderer.applyConfig({ navigation: { freeDrag: true } });
        expect(internals(c).input.freeDrag).toBe(false);
        c.renderer.set('freePan', true);
        expect(internals(c).input.freeDrag).toBe(true);
    });

    it('makes a left drag pan time and price', async () => {
        const c = chart({ freePan: true });
        c.renderer.applyConfig({ navigation: { freeDrag: true } });
        const p = await pane(c);
        const before = { ...p.scale };
        const y = p.bounds.top + p.bounds.height / 2;
        pointer(c, 'pointerdown', { x: 400, y });
        pointer(c, 'pointermove', { x: 380, y: y - 30, buttons: 1 });
        pointer(c, 'pointerup', { x: 380, y: y - 30 });
        const expected = shiftScale(before, -30, p.bounds.height);
        expect(p.manualScale!.min).toBeCloseTo(expected.min, 6);
        expect(c.renderer.get('autoScale')).toBe(false);
    });

    it('is a row of the Canvas tab only while the option is on', () => {
        expect(chart().renderer.listSettingsIds()).not.toContain('canvas.navigation.free-drag');
        const c = chart({ freePan: true });
        expect(c.renderer.listSettingsIds()).toContain('canvas.navigation.free-drag');
        c.renderer.openSettings('Canvas');
        const row = document.querySelector('[data-sd-id="canvas.navigation.free-drag"]');
        expect(row?.textContent).toContain('Drag moves price and time together');
    });

    it('is absent from the Canvas tab with the option off', () => {
        const c = chart();
        c.renderer.openSettings('Canvas');
        expect(document.querySelector('[data-sd-id="canvas.margins.top"]')).not.toBeNull();
        expect(document.querySelector('[data-sd-id="canvas.navigation.free-drag"]')).toBeNull();
    });
});
