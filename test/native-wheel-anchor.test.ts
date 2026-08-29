import { describe, it, expect, vi } from 'vitest';
import { wheelZoomAnchor, isHorizontalWheel, wheelPanRightOffset, wheelPanDelta, InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

function coords(): CoordinateSystem {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1);
    cs.setBars([1000, 2000, 3000, 4000, 5000]); // 5 bars, interval 1000
    cs.setViewport({ barSpacing: 100, rightOffset: 1 });
    return cs;
}

describe('wheelZoomAnchor', () => {
    it('cursor mode pins the logical under the pointer at the cursor pixel', () => {
        const cs = coords();
        const a = wheelZoomAnchor(cs, 300, false);
        expect(a.x).toBe(300);
        expect(a.logical).toBe(cs.xToLogical(300));
    });

    it('right-edge mode pins the right edge logical at the right pixel edge', () => {
        const cs = coords();
        const a = wheelZoomAnchor(cs, 300, true);
        expect(a.x).toBe(cs.width); // 800
        expect(a.logical).toBe(cs.rightEdgeLogical); // (n-1)+rightOffset = 5
    });
});

describe('horizontal wheel / trackpad pans through time', () => {
    it('treats a horizontal-dominant gesture as a pan, a vertical-dominant one as a zoom', () => {
        expect(isHorizontalWheel(30, 4)).toBe(true); // sideways two-finger swipe → pan
        expect(isHorizontalWheel(4, 30)).toBe(false); // normal notch → zoom
        expect(isHorizontalWheel(10, 10)).toBe(false); // ties fall through to zoom
        expect(isHorizontalWheel(0, 0)).toBe(false);
    });

    it('scrolling right (deltaX>0) moves forward toward the latest bars (rightOffset up)', () => {
        // barSpacing 10 ⇒ a 50px swipe pans exactly 5 bars (1:1 with the fingers).
        expect(wheelPanRightOffset(0, 50, 10)).toBeCloseTo(5);
        expect(wheelPanRightOffset(3, -20, 10)).toBeCloseTo(1); // scroll left → back into history
    });
});

describe('Shift+wheel scrolls through history instead of zooming', () => {
    it('a plain vertical notch zooms (null); with shift it pans by deltaY', () => {
        expect(wheelPanDelta(0, 120, false)).toBeNull(); // normal notch → zoom
        expect(wheelPanDelta(0, 120, true)).toBe(120); // shift → pan forward
        expect(wheelPanDelta(0, -120, true)).toBe(-120); // shift + scroll up → back into history
    });

    it('a horizontal-dominant gesture pans by deltaX with or without shift', () => {
        // Browsers that remap Shift+wheel into deltaX land here too.
        expect(wheelPanDelta(120, 0, false)).toBe(120);
        expect(wheelPanDelta(120, 0, true)).toBe(120);
        expect(wheelPanDelta(-30, 4, true)).toBe(-30);
    });
});

describe('wheel over the price axis rescales that scale like a slow drag', () => {
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

    function harness() {
        const deps = {
            getCoords: coords, // 800×200 plot — x>800 is the price-axis strip
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
        } satisfies InputControllerDeps;
        const ctl = new InputController(deps);
        const el = fakeElement();
        ctl.attach(el as unknown as HTMLElement);
        const wheel = (clientX: number, clientY: number, deltaY: number, deltaX = 0): void => {
            el.fire('wheel', { clientX, clientY, deltaY, deltaX, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} });
        };
        return { ctl, deps, wheel };
    }

    it('a notch over the axis strip grabs that scale and rescales it as a ~25px drag', () => {
        const h = harness();
        h.wheel(820, 100, 100); // scroll down → expand the span (zoom out), like a downward drag
        expect(h.deps.beginPriceScale).toHaveBeenCalledWith(820, 100);
        expect(h.deps.priceScaleBy).toHaveBeenCalledWith(25); // deltaY 100 × 0.25 px/delta
        expect(h.deps.zoomTo).not.toHaveBeenCalled();
        h.wheel(820, 100, -100); // scroll up → compress (zoom in)
        expect(h.deps.priceScaleBy).toHaveBeenLastCalledWith(-25);
    });

    it('a wheel over the data area still time-zooms and never touches the price scale', () => {
        const h = harness();
        h.wheel(400, 100, 100);
        expect(h.deps.zoomTo).toHaveBeenCalledTimes(1);
        expect(h.deps.beginPriceScale).not.toHaveBeenCalled();
        expect(h.deps.priceScaleBy).not.toHaveBeenCalled();
    });

    it('axisDrag=false turns the axis wheel back into a plain zoom (like axis presses)', () => {
        const h = harness();
        h.ctl.axisDrag = false;
        h.wheel(820, 100, 100);
        expect(h.deps.beginPriceScale).not.toHaveBeenCalled();
        expect(h.deps.zoomTo).toHaveBeenCalledTimes(1);
    });
});

describe('wheel-zoom anchor defaults to the right edge', () => {
    it('InputController.rightEdgeZoom is true by default', () => {
        expect(new InputController({} as never).rightEdgeZoom).toBe(true);
    });

    it("NativeRenderer reports zoomAnchor 'right' by default", () => {
        expect(new NativeRenderer().readFeature('zoomAnchor')).toBe('right');
    });
});
