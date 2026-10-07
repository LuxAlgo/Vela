// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

// ── with the drawings switched off, the pointer never reaches them: a press over a drawing
// (or with a tool armed) is a plain pan/click, so an interaction that asks for a bar gets
// the click and the drawing stays put ──

function fakeElement() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    return {
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
        },
        removeEventListener(type: string, fn: (e: unknown) => void) {
            listeners.get(type)?.delete(fn);
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        style: { setProperty() {} } as unknown as CSSStyleDeclaration,
        setPointerCapture() {},
        releasePointerCapture() {},
        fire(type: string, e: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
        },
    };
}

function harness() {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1);
    cs.setBars([1000, 2000, 3000, 4000, 5000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 2 });
    const deps = {
        getCoords: () => cs,
        apply: vi.fn(),
        zoomTo: vi.fn(),
        fling: vi.fn(),
        onPointerMove: vi.fn(),
        onClick: vi.fn(),
        beginPriceScale: vi.fn(),
        priceScaleBy: vi.fn(),
        beginPricePan: () => false,
        pricePanBy: vi.fn(),
        resetPriceScale: vi.fn(),
        dataDblClick: vi.fn(),
        paneSeparatorAt: () => false,
        beginPaneResize: vi.fn(),
        paneResizeBy: vi.fn(),
        resetPaneSize: vi.fn(),
        resetView: vi.fn(),
        // Every press lands on a drawing.
        drawingsClaim: vi.fn(() => true),
        drawingsMeasureStart: vi.fn(() => true),
        drawingsMarqueeStart: vi.fn(() => true),
        drawingsDeleteAt: vi.fn(() => true),
        drawingsCancelPlacement: vi.fn(() => true),
        drawingsPointerDown: vi.fn(),
        drawingsPointerMove: vi.fn(),
        drawingsPointerUp: vi.fn(),
        drawingsCursor: vi.fn(() => 'pointer'),
        drawingsDblClick: vi.fn(() => true),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const base = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: 0, preventDefault() {} };
    const fire = (type: string, over: Record<string, unknown> = {}): void => el.fire(type, { ...base, ...over });
    return { ctl, deps, fire };
}

describe('InputController with the drawings switched off', () => {
    it('lets the drawings claim a press by default', () => {
        const h = harness();
        h.fire('pointerdown');
        h.fire('pointerup');
        expect(h.deps.drawingsPointerDown).toHaveBeenCalledTimes(1);
        expect(h.deps.onClick).not.toHaveBeenCalled();
    });

    it('turns a press over a drawing into a plain click', () => {
        const h = harness();
        h.ctl.drawings = false;
        h.fire('pointerdown');
        h.fire('pointerup');
        expect(h.deps.drawingsClaim).not.toHaveBeenCalled();
        expect(h.deps.drawingsPointerDown).not.toHaveBeenCalled();
        expect(h.deps.drawingsPointerUp).not.toHaveBeenCalled();
        expect(h.deps.onClick).toHaveBeenCalledWith(100, 100);
    });

    it('pans on a drag over a drawing instead of moving it', () => {
        const h = harness();
        h.ctl.drawings = false;
        h.fire('pointerdown');
        h.fire('pointermove', { clientX: 130, clientY: 112, buttons: 1 });
        h.fire('pointerup', { clientX: 130, clientY: 112 });
        expect(h.deps.drawingsPointerMove).not.toHaveBeenCalled();
        expect(h.deps.apply).toHaveBeenCalled();
        expect(h.deps.onClick).not.toHaveBeenCalled(); // the end of a pan is no click
    });

    it('keeps hover moves away from the drawings', () => {
        const h = harness();
        h.ctl.drawings = false;
        h.fire('pointermove', { clientX: 120 });
        expect(h.deps.drawingsPointerMove).not.toHaveBeenCalled();
        expect(h.deps.onPointerMove).toHaveBeenCalledWith(120, 100); // the crosshair still follows
    });

    it('starts no ruler, marquee, middle-click delete, right-click cancel or settings double-click', () => {
        const h = harness();
        h.ctl.drawings = false;
        h.fire('pointerdown', { shiftKey: true });
        h.fire('pointerup', { shiftKey: true });
        h.fire('pointerdown', { ctrlKey: true });
        h.fire('pointerup', { ctrlKey: true });
        h.fire('pointerdown', { button: 1 });
        h.fire('pointerdown', { button: 2 });
        h.fire('dblclick');
        expect(h.deps.drawingsMeasureStart).not.toHaveBeenCalled();
        expect(h.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(h.deps.drawingsDeleteAt).not.toHaveBeenCalled();
        expect(h.deps.drawingsCancelPlacement).not.toHaveBeenCalled();
        expect(h.deps.drawingsDblClick).not.toHaveBeenCalled();
        expect(h.deps.dataDblClick).toHaveBeenCalledTimes(1);
    });

    it('lets a drawing gesture already under way finish', () => {
        const h = harness();
        h.fire('pointerdown');
        h.ctl.drawings = false;
        h.fire('pointermove', { clientX: 130 });
        h.fire('pointerup', { clientX: 130 });
        expect(h.deps.drawingsPointerMove).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsPointerUp).toHaveBeenCalledTimes(1);
        expect(h.deps.onClick).not.toHaveBeenCalled();
    });
});

describe('NativeRenderer drawingsInteractive feature', () => {
    it('is advertised and on by default', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('drawingsInteractive');
        expect(r.readFeature('drawingsInteractive')).toBe(true);
    });

    it('toggles without a mount, and null restores the default', () => {
        const r = new NativeRenderer();
        r.applyFeature('drawingsInteractive', false);
        expect(r.readFeature('drawingsInteractive')).toBe(false);
        r.applyFeature('drawingsInteractive', null);
        expect(r.readFeature('drawingsInteractive')).toBe(true);
    });

    it('never reaches the saved config', () => {
        const r = new NativeRenderer();
        const before = JSON.stringify(r.getConfig());
        r.applyFeature('drawingsInteractive', false);
        expect(JSON.stringify(r.getConfig())).toBe(before);
    });
});
