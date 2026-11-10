import { describe, it, expect, vi } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// ── free panning: with the `freePan` option on, a middle drag pans time and price at once,
// a middle-click still deletes the drawing under it (on release), and the user's switch
// makes a plain left drag pan both ways too. With the option off, nothing changes. ──

/** Bare-bones event-target stand-in — enough surface for InputController.attach(). */
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

/** `manual` = whether the pane under the press is already in manual scale. */
function harness(opts: { freePan?: boolean; freeDrag?: boolean; overDrawing?: boolean; manual?: boolean } = {}) {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1);
    cs.setBars([1000, 2000, 3000, 4000, 5000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 2 });
    let manual = opts.manual ?? false;
    const deps = {
        getCoords: () => cs,
        apply: vi.fn((vp: { barSpacing: number; rightOffset: number }) => cs.setViewport(vp)),
        zoomTo: vi.fn(),
        fling: vi.fn(),
        onPointerMove: vi.fn(),
        onClick: vi.fn(),
        beginPriceScale: vi.fn(),
        priceScaleBy: vi.fn(),
        // A free grab turns the pane manual (the renderer's real behavior); a plain one only
        // pans price when the pane already is.
        beginPricePan: vi.fn((_y: number, free?: boolean) => {
            if (free) manual = true;
            return manual;
        }),
        pricePanBy: vi.fn(),
        resetPriceScale: vi.fn(),
        dataDblClick: vi.fn(),
        paneSeparatorAt: () => false,
        beginPaneResize: vi.fn(),
        paneResizeBy: vi.fn(),
        resetPaneSize: vi.fn(),
        resetView: vi.fn(),
        drawingsClaim: vi.fn(() => opts.overDrawing ?? false),
        drawingsMeasureStart: vi.fn(() => true),
        drawingsMarqueeStart: vi.fn(() => true),
        drawingsDeleteAt: vi.fn(() => opts.overDrawing ?? false),
        drawingsPointerDown: vi.fn(),
        drawingsPointerMove: vi.fn(),
        drawingsPointerUp: vi.fn(),
        drawingsClearTransient: vi.fn(),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    ctl.freePan = opts.freePan ?? false;
    ctl.freeDrag = opts.freeDrag ?? false;
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const base = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 400, clientY: 100, shiftKey: false, ctrlKey: false, metaKey: false, timeStamp: 0 };
    /** Fire an event; returns whether something called preventDefault on it. */
    const fire = (type: string, over: Record<string, unknown> = {}): boolean => {
        let prevented = false;
        el.fire(type, { ...base, ...over, preventDefault: () => (prevented = true) });
        return prevented;
    };
    const rightOffset = (): number => cs.getViewport().rightOffset;
    return { ctl, deps, fire, rightOffset, isManual: () => manual };
}

describe('middle-button drag with free panning on', () => {
    it('pans time like a left drag and moves the pane’s price with the pointer', () => {
        const h = harness({ freePan: true });
        const before = h.rightOffset();
        h.fire('pointerdown', { button: 1 });
        h.fire('pointermove', { clientX: 450, clientY: 130, buttons: 4 });
        // 50px right at 50px per bar ⇒ one bar further back in time, exactly like a left drag.
        expect(h.rightOffset()).toBeCloseTo(before - 1, 6);
        expect(h.deps.beginPricePan).toHaveBeenCalledWith(100, true); // grabbed where it was pressed
        expect(h.isManual()).toBe(true);
        expect(h.deps.pricePanBy).toHaveBeenLastCalledWith(30); // follows the pointer from the press point
        h.fire('pointermove', { clientX: 380, clientY: 60, buttons: 4 });
        expect(h.rightOffset()).toBeCloseTo(before + 0.4, 6);
        expect(h.deps.pricePanBy).toHaveBeenLastCalledWith(-40);
        h.fire('pointerup', { button: 1, clientX: 380, clientY: 60 });
        expect(h.deps.onClick).not.toHaveBeenCalled();
        expect(h.deps.fling).not.toHaveBeenCalled();
    });

    it('a middle press that moves never deletes the drawing it started on', () => {
        const h = harness({ freePan: true, overDrawing: true });
        h.fire('pointerdown', { button: 1 });
        h.fire('pointermove', { clientX: 420, clientY: 100, buttons: 4 });
        h.fire('pointerup', { button: 1, clientX: 420, clientY: 100 });
        expect(h.deps.drawingsDeleteAt).not.toHaveBeenCalled();
        expect(h.deps.drawingsPointerDown).not.toHaveBeenCalled(); // the drawing is not dragged either
        expect(h.deps.apply).toHaveBeenCalled();
    });

    it('a middle-click without movement deletes the drawing on release, not on press', () => {
        const h = harness({ freePan: true, overDrawing: true });
        h.fire('pointerdown', { button: 1 });
        expect(h.deps.drawingsDeleteAt).not.toHaveBeenCalled();
        h.fire('pointermove', { clientX: 401, clientY: 101, buttons: 4 }); // a hand's wobble, inside the drag threshold
        h.fire('pointerup', { button: 1, clientX: 401, clientY: 101 });
        expect(h.deps.drawingsDeleteAt).toHaveBeenCalledTimes(1);
        expect(h.deps.drawingsDeleteAt).toHaveBeenCalledWith(400, 100);
        expect(h.deps.pricePanBy).not.toHaveBeenCalled(); // a click never pans …
        expect(h.isManual()).toBe(false); // … or switches autoscale off
    });

    it('vetoes the browser’s middle-button autoscroll and paste for the press', () => {
        const h = harness({ freePan: true });
        expect(h.fire('pointerdown', { button: 1 })).toBe(true);
        expect(h.fire('mousedown', { button: 1 })).toBe(true);
        h.fire('pointerup', { button: 1 });
        expect(h.fire('auxclick', { button: 1 })).toBe(true);
    });

    it('leaves a middle press on the price axis to the existing behavior', () => {
        const h = harness({ freePan: true });
        h.fire('pointerdown', { button: 1, clientX: 850 });
        h.fire('pointermove', { clientX: 900, clientY: 150, buttons: 4 });
        expect(h.deps.apply).not.toHaveBeenCalled();
        expect(h.deps.beginPricePan).not.toHaveBeenCalled();
    });
});

describe('middle button with free panning off (the default)', () => {
    it('deletes the drawing on press, as before', () => {
        const h = harness({ overDrawing: true });
        expect(h.fire('pointerdown', { button: 1 })).toBe(true);
        expect(h.deps.drawingsDeleteAt).toHaveBeenCalledTimes(1);
        expect(h.fire('mousedown', { button: 1 })).toBe(true);
        h.fire('pointerup', { button: 1 });
        expect(h.deps.drawingsDeleteAt).toHaveBeenCalledTimes(1);
    });

    it('a middle drag does not pan', () => {
        const h = harness();
        h.fire('pointerdown', { button: 1 });
        h.fire('pointermove', { clientX: 450, clientY: 130, buttons: 4 });
        h.fire('pointerup', { button: 1, clientX: 450, clientY: 130 });
        expect(h.deps.apply).not.toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
        expect(h.deps.beginPricePan).not.toHaveBeenCalled();
    });

    it('a plain middle press over empty plot leaves autoscroll to the browser', () => {
        const h = harness();
        expect(h.fire('pointerdown', { button: 1 })).toBe(false);
        expect(h.fire('mousedown', { button: 1 })).toBe(false);
    });
});

describe('the “drag moves price and time together” switch', () => {
    it('makes a plain left drag pan time and price', () => {
        const h = harness({ freePan: true, freeDrag: true });
        const before = h.rightOffset();
        h.fire('pointerdown');
        h.fire('pointermove', { clientX: 450, clientY: 120, buttons: 1 });
        expect(h.rightOffset()).toBeCloseTo(before - 1, 6);
        expect(h.deps.beginPricePan).toHaveBeenLastCalledWith(100, true);
        expect(h.deps.pricePanBy).toHaveBeenLastCalledWith(20);
        h.fire('pointerup', { clientX: 450, clientY: 120 });
        expect(h.deps.onClick).not.toHaveBeenCalled();
    });

    it('a purely vertical left drag pans price too', () => {
        const h = harness({ freePan: true, freeDrag: true });
        h.fire('pointerdown');
        h.fire('pointermove', { clientX: 400, clientY: 160, buttons: 1 });
        expect(h.deps.pricePanBy).toHaveBeenLastCalledWith(60);
        h.fire('pointerup', { clientX: 400, clientY: 160 });
        expect(h.deps.onClick).not.toHaveBeenCalled();
    });

    it('a left click stays a click and keeps autoscale on', () => {
        const h = harness({ freePan: true, freeDrag: true });
        h.fire('pointerdown');
        h.fire('pointerup');
        expect(h.deps.onClick).toHaveBeenCalledWith(400, 100);
        expect(h.isManual()).toBe(false);
        expect(h.deps.beginPricePan).not.toHaveBeenCalledWith(100, true);
    });

    it('off, a left drag on an auto-scaled pane pans time only', () => {
        const h = harness({ freePan: true });
        h.fire('pointerdown');
        h.fire('pointermove', { clientX: 450, clientY: 140, buttons: 1 });
        h.fire('pointerup', { clientX: 450, clientY: 140 });
        expect(h.deps.apply).toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
        expect(h.isManual()).toBe(false);
    });

    it('leaves Ctrl/Cmd-drag to the selection box', () => {
        const h = harness({ freePan: true, freeDrag: true });
        h.fire('pointerdown', { ctrlKey: true });
        h.fire('pointermove', { clientX: 450, clientY: 140, buttons: 1, ctrlKey: true });
        h.fire('pointerup', { clientX: 450, clientY: 140, ctrlKey: true });
        expect(h.deps.drawingsMarqueeStart).toHaveBeenCalledWith(400, 100);
        expect(h.deps.apply).not.toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
    });

    it('leaves Shift-drag to the measure ruler', () => {
        const h = harness({ freePan: true, freeDrag: true });
        h.fire('pointerdown', { shiftKey: true });
        h.fire('pointermove', { clientX: 450, clientY: 140, buttons: 1, shiftKey: true });
        h.fire('pointerup', { clientX: 450, clientY: 140, shiftKey: true });
        expect(h.deps.drawingsMeasureStart).toHaveBeenCalled();
        expect(h.deps.apply).not.toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
    });

    it('leaves a press on a drawing to the drawing', () => {
        const h = harness({ freePan: true, freeDrag: true, overDrawing: true });
        h.fire('pointerdown');
        h.fire('pointermove', { clientX: 450, clientY: 140, buttons: 1 });
        h.fire('pointerup', { clientX: 450, clientY: 140 });
        expect(h.deps.drawingsPointerDown).toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
    });

    it('leaves a one-finger touch pan in time only', () => {
        const h = harness({ freePan: true, freeDrag: true });
        h.fire('pointerdown', { pointerType: 'touch' });
        h.fire('pointermove', { pointerType: 'touch', clientX: 450, clientY: 140 });
        h.fire('pointerup', { pointerType: 'touch', clientX: 450, clientY: 140 });
        expect(h.deps.apply).toHaveBeenCalled();
        expect(h.deps.pricePanBy).not.toHaveBeenCalled();
        expect(h.isManual()).toBe(false);
    });
});
