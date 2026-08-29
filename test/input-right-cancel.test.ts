import { describe, it, expect, vi } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// ── right-click cancel: a right press aborts an in-progress drawing placement and
// vetoes the companion contextmenu, so the host's chart menu never opens over it ──

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

function harness(cancelPlacement: () => boolean) {
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
        drawingsCancelPlacement: vi.fn(cancelPlacement),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const rightPress = (): { prevented: boolean } => {
        const e = { button: 2, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, timeStamp: 0, prevented: false };
        el.fire('pointerdown', { ...e, preventDefault: () => (e.prevented = true) });
        return e;
    };
    const contextmenu = (): { prevented: boolean; stopped: boolean } => {
        const e = { prevented: false, stopped: false };
        el.fire('contextmenu', { preventDefault: () => (e.prevented = true), stopPropagation: () => (e.stopped = true) });
        return e;
    };
    return { deps, el, rightPress, contextmenu };
}

describe('right-click drawing cancel', () => {
    it('a right press that cancels a placement swallows the companion contextmenu', () => {
        const h = harness(() => true);
        const press = h.rightPress();
        expect(h.deps.drawingsCancelPlacement).toHaveBeenCalledTimes(1);
        expect(press.prevented).toBe(true);
        expect(h.deps.apply).not.toHaveBeenCalled(); // never starts a pan gesture
        const menu = h.contextmenu();
        expect(menu.prevented).toBe(true);
        expect(menu.stopped).toBe(true); // the host's chart menu (an ancestor listener) never sees it
    });

    it('a plain right press (nothing placing) leaves the contextmenu to the host', () => {
        const h = harness(() => false);
        const press = h.rightPress();
        expect(press.prevented).toBe(false);
        const menu = h.contextmenu();
        expect(menu.prevented).toBe(false);
        expect(menu.stopped).toBe(false);
    });

    it('the veto covers exactly ONE contextmenu — the next press starts clean', () => {
        let placing = true;
        const h = harness(() => placing);
        h.rightPress();
        expect(h.contextmenu().stopped).toBe(true);
        placing = false; // the placement is gone — a second right-click is a normal one
        h.rightPress();
        expect(h.contextmenu().stopped).toBe(false);
    });
});

describe('Shift+click measure start forwards the magnet mode', () => {
    function measureHarness(snap: 'off' | 'weak' | 'strong') {
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
            drawingsSnapMode: () => snap,
            drawingsMeasureStart: vi.fn(() => true),
        } satisfies InputControllerDeps;
        const ctl = new InputController(deps);
        const el = fakeElement();
        ctl.attach(el as unknown as HTMLElement);
        return { deps, el };
    }

    it('passes the sticky magnet mode into the measure-start callback', () => {
        const h = measureHarness('strong');
        const e = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, timeStamp: 0, shiftKey: true, ctrlKey: false, metaKey: false, preventDefault() {} };
        h.el.fire('pointerdown', e);
        expect(h.deps.drawingsMeasureStart).toHaveBeenCalledWith(100, 100, 'strong');
    });

    it('Ctrl/Cmd on the same press forces strong even when the magnet is off', () => {
        const h = measureHarness('off');
        const e = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: 50, timeStamp: 0, shiftKey: true, ctrlKey: true, metaKey: false, preventDefault() {} };
        h.el.fire('pointerdown', e);
        expect(h.deps.drawingsMeasureStart).toHaveBeenCalledWith(40, 50, 'strong');
    });
});
