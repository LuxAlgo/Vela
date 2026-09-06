import { describe, expect, it, vi } from 'vitest';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';

function fakeElement() {
    const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
    return {
        addEventListener(type: string, fn: (event: Record<string, unknown>) => void) {
            (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
        },
        removeEventListener(type: string, fn: (event: Record<string, unknown>) => void) {
            listeners.get(type)?.delete(fn);
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        style: { setProperty() {} } as unknown as CSSStyleDeclaration,
        setPointerCapture() {},
        releasePointerCapture() {},
        fire(type: string, event: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
        },
    };
}

function harness(options: { claim?: boolean; marquee?: boolean; separator?: boolean } = {}) {
    const coords = new CoordinateSystem();
    coords.setSize(200, 100, 1);
    coords.setBars([1, 2, 3]);
    coords.setViewport({ barSpacing: 10, rightOffset: 2 });
    const deps = {
        getCoords: () => coords,
        apply: vi.fn(),
        zoomTo: vi.fn(),
        fling: vi.fn(),
        onPointerMove: vi.fn(),
        onClick: vi.fn(),
        beginPriceScale: vi.fn(),
        priceScaleBy: vi.fn(),
        beginPricePan: vi.fn(() => false),
        pricePanBy: vi.fn(),
        resetPriceScale: vi.fn(),
        dataDblClick: vi.fn(),
        paneSeparatorAt: vi.fn(() => options.separator ?? false),
        beginPaneResize: vi.fn(),
        paneResizeBy: vi.fn(),
        resetPaneSize: vi.fn(),
        resetView: vi.fn(),
        drawingsClaim: vi.fn(() => options.claim ?? false),
        drawingsPointerDown: vi.fn(),
        drawingsPointerMove: vi.fn(),
        drawingsPointerUp: vi.fn(),
        drawingsMeasureStart: vi.fn(() => true),
        drawingsMarqueeStart: vi.fn(() => options.marquee ?? true),
        drawingsMarqueeMove: vi.fn(),
        drawingsMarqueeEnd: vi.fn(),
        drawingsMarqueeCancel: vi.fn(),
        drawingsMarqueeClick: vi.fn(),
    } satisfies InputControllerDeps;
    const input = new InputController(deps);
    const element = fakeElement();
    input.attach(element as unknown as HTMLElement);
    const pointer = (
        type: string,
        x: number,
        y: number,
        overrides: Partial<Record<string, unknown>> = {},
    ) => {
        const state = { prevented: false };
        element.fire(type, {
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pointerId: 1,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
            timeStamp: type === 'pointerdown' ? 0 : 10,
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            preventDefault: () => { state.prevented = true; },
            ...overrides,
        });
        return state;
    };
    return { coords, deps, input, element, pointer };
}

describe('InputController drawing marquee', () => {
    it('keeps a modifier press pending through slop, then forwards a normal chart click', () => {
        const h = harness();
        const down = h.pointer('pointerdown', 20, 20);
        h.pointer('pointermove', 22, 22);
        h.pointer('pointerup', 22, 22);

        expect(down.prevented).toBe(true);
        expect(h.deps.drawingsMarqueeStart).toHaveBeenCalledWith(20, 20, false);
        expect(h.deps.drawingsMarqueeMove).not.toHaveBeenCalled();
        expect(h.deps.drawingsMarqueeEnd).not.toHaveBeenCalled();
        expect(h.deps.drawingsMarqueeClick).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsMarqueeCancel).not.toHaveBeenCalled();
        expect(h.deps.onClick).toHaveBeenCalledWith(22, 22);
    });

    it('latches Ctrl/Cmd+Shift union, freezes the current viewport, and owns the drag without pan or fling', () => {
        const h = harness();
        const viewport = h.coords.getViewport();
        h.pointer('pointerdown', 20, 20, { ctrlKey: false, metaKey: true, shiftKey: true });
        h.pointer('pointermove', 80, 70, { ctrlKey: false, metaKey: false, shiftKey: false });
        h.pointer('pointerup', 90, 80, { ctrlKey: false, metaKey: false, shiftKey: false });

        expect(h.deps.drawingsMarqueeStart).toHaveBeenCalledWith(20, 20, true);
        expect(h.deps.apply).toHaveBeenCalledTimes(1);
        expect(h.deps.apply).toHaveBeenCalledWith(viewport);
        expect(h.deps.drawingsMarqueeMove).toHaveBeenCalledWith(80, 70);
        expect(h.deps.drawingsMarqueeEnd).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsMarqueeEnd).toHaveBeenCalledWith(90, 80);
        expect(h.deps.beginPricePan).not.toHaveBeenCalled();
        expect(h.deps.fling).not.toHaveBeenCalled();
        expect(h.deps.drawingsMeasureStart).not.toHaveBeenCalled();
    });

    it('lets a drawing hit or active drawing mode claim the gesture first', () => {
        const h = harness({ claim: true });
        h.pointer('pointerdown', 20, 20, { shiftKey: true });
        h.pointer('pointermove', 80, 70);
        h.pointer('pointerup', 80, 70);

        expect(h.deps.drawingsPointerDown).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsPointerDown).toHaveBeenCalledWith(20, 20, 'strong', true);
        expect(h.deps.drawingsPointerUp).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(h.deps.drawingsMeasureStart).not.toHaveBeenCalled();
    });

    it('does not start on an axis or touch, preserving axis and touch-pan behavior', () => {
        const axis = harness();
        axis.pointer('pointerdown', 210, 50);
        expect(axis.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(axis.deps.beginPriceScale).toHaveBeenCalledWith(210, 50);

        const touch = harness();
        touch.pointer('pointerdown', 20, 20, { pointerType: 'touch' });
        expect(touch.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(touch.deps.beginPricePan).toHaveBeenCalledWith(20);
    });

    it('lets a pane separator keep its resize gesture ahead of a modified marquee', () => {
        const h = harness({ separator: true });
        h.pointer('pointerdown', 20, 50);

        expect(h.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(h.deps.beginPaneResize).toHaveBeenCalledWith(50);
        expect(h.deps.beginPricePan).not.toHaveBeenCalled();
    });

    it('cancels on pointercancel without ending or clicking', () => {
        const h = harness();
        const viewport = h.coords.getViewport();
        h.pointer('pointerdown', 20, 20);
        h.pointer('pointermove', 80, 70);
        h.pointer('pointercancel', 80, 70);

        expect(h.deps.drawingsMarqueeCancel).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsMarqueeEnd).not.toHaveBeenCalled();
        expect(h.deps.onClick).not.toHaveBeenCalled();
        expect(h.deps.apply).toHaveBeenCalledTimes(1);
        expect(h.deps.apply).toHaveBeenCalledWith(viewport);
        expect(h.coords.getViewport()).toEqual(viewport);
    });

    it('leaves an ordinary unmodified data drag on the existing pan path', () => {
        const h = harness();
        h.pointer('pointerdown', 20, 20, { ctrlKey: false });
        h.pointer('pointermove', 80, 20, { ctrlKey: false });
        h.pointer('pointerup', 80, 20, { ctrlKey: false });

        expect(h.deps.drawingsMarqueeStart).not.toHaveBeenCalled();
        expect(h.deps.beginPricePan).toHaveBeenCalledWith(20);
        expect(h.deps.apply).toHaveBeenCalled();
    });

    it('falls back to the existing Shift-measure gesture when marquee support declines', () => {
        const h = harness({ marquee: false });
        h.pointer('pointerdown', 20, 20, { shiftKey: true });
        expect(h.deps.drawingsMarqueeStart).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsMeasureStart).toHaveBeenCalledTimes(1);
    });
});
