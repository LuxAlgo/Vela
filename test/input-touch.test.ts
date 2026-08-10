import { describe, it, expect, vi } from 'vitest';
import { InputController, pinchBarSpacing, pinchPinnedRightOffset, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { clampBarSpacing } from '../src/renderers/native/core/ViewportState';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

describe('pinch zoom math', () => {
    it('scales barSpacing by the finger-distance ratio', () => {
        expect(pinchBarSpacing(10, 100, 200)).toBeCloseTo(20); // fingers spread 2× ⇒ zoom in 2×
        expect(pinchBarSpacing(10, 200, 100)).toBeCloseTo(5); // fingers close 2× ⇒ zoom out 2×
        expect(pinchBarSpacing(10, 100, 100)).toBeCloseTo(10);
    });

    it('clamps to the viewport zoom bounds', () => {
        expect(pinchBarSpacing(10, 100, 1e9)).toBe(clampBarSpacing(Number.MAX_VALUE));
        expect(pinchBarSpacing(10, 1e9, 1)).toBe(clampBarSpacing(0));
    });

    it('never divides by a degenerate start distance', () => {
        expect(Number.isFinite(pinchBarSpacing(10, 0, 50))).toBe(true);
    });

    it('pinchPinnedRightOffset keeps the anchor logical under the anchor pixel', () => {
        const cs = new CoordinateSystem();
        cs.setSize(800, 200, 1);
        cs.setBars([1000, 2000, 3000, 4000, 5000]);
        cs.setViewport({ barSpacing: 50, rightOffset: 2 });
        const midX = 300;
        const anchor = cs.xToLogical(midX);
        // Zoom to a new spacing, pinning `anchor` at midX (pitch multiplier is 1 here).
        const barSpacing = 80;
        const rightOffset = pinchPinnedRightOffset(anchor, cs.barCount, cs.width, midX, barSpacing);
        cs.setViewport({ barSpacing, rightOffset });
        expect(cs.logicalToX(anchor)).toBeCloseTo(midX);
    });

    it('a pure pan (same spacing, moved midpoint) shifts the view with the fingers', () => {
        const cs = new CoordinateSystem();
        cs.setSize(800, 200, 1);
        cs.setBars([1000, 2000, 3000, 4000, 5000]);
        cs.setViewport({ barSpacing: 50, rightOffset: 2 });
        const anchor = cs.xToLogical(300);
        const rightOffset = pinchPinnedRightOffset(anchor, cs.barCount, cs.width, 400, 50);
        cs.setViewport({ barSpacing: 50, rightOffset });
        expect(cs.logicalToX(anchor)).toBeCloseTo(400); // the anchored bar followed the fingers
    });
});

// ── touch double-tap: two clean taps route through the dblclick semantics ──

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
        setPointerCapture() {},
        releasePointerCapture() {},
        fire(type: string, e: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
        },
    };
}

function touchHarness() {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1); // data area 800×200; price axis right of x=800, time axis below y=200
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
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    ctl.axisDrag = true; // axis strips classify as 'price'/'time' regions
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const tap = (x: number, y: number, t: number): void => {
        const base = { button: 0, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y };
        el.fire('pointerdown', { ...base, timeStamp: t });
        el.fire('pointerup', { ...base, timeStamp: t + 40 });
    };
    /** A REAL finger tap: the contact wobbles `w` px between touch-down and lift. */
    const wobbleTap = (x: number, y: number, t: number, w = 5): void => {
        const base = { button: 0, pointerId: 1, pointerType: 'touch' };
        el.fire('pointerdown', { ...base, clientX: x, clientY: y, timeStamp: t });
        el.fire('pointermove', { ...base, clientX: x + w, clientY: y + w, timeStamp: t + 20 });
        el.fire('pointerup', { ...base, clientX: x + w, clientY: y + w, timeStamp: t + 40 });
    };
    const mouseDrag = (x: number, y: number, t: number, d: number): void => {
        const base = { button: 0, pointerId: 2, pointerType: 'mouse' };
        el.fire('pointerdown', { ...base, clientX: x, clientY: y, timeStamp: t });
        el.fire('pointermove', { ...base, clientX: x + d, clientY: y, timeStamp: t + 20 });
        el.fire('pointerup', { ...base, clientX: x + d, clientY: y, timeStamp: t + 40 });
    };
    return { deps, tap, wobbleTap, mouseDrag };
}

describe('touch double-tap (the touch dblclick)', () => {
    it('data area: a quick tap pair toggles pane maximize (dataDblClick), one tap does not', () => {
        const { deps, tap } = touchHarness();
        tap(400, 100, 0);
        expect(deps.dataDblClick).not.toHaveBeenCalled();
        tap(405, 104, 150);
        expect(deps.dataDblClick).toHaveBeenCalledTimes(1);
    });

    it('price axis: a tap pair resets that scale to auto', () => {
        const { deps, tap } = touchHarness();
        tap(820, 100, 0);
        tap(820, 102, 120);
        expect(deps.resetPriceScale).toHaveBeenCalledTimes(1);
        expect(deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('time axis: a tap pair fits the view to content', () => {
        const { deps, tap } = touchHarness();
        tap(400, 210, 0);
        tap(398, 211, 200);
        expect(deps.resetView).toHaveBeenCalledTimes(1);
    });

    it('taps too far apart in time or space stay two singles', () => {
        const { deps, tap } = touchHarness();
        tap(400, 100, 0);
        tap(400, 100, 500); // beyond the pairing window
        expect(deps.dataDblClick).not.toHaveBeenCalled();
        tap(200, 100, 600);
        tap(300, 100, 700); // beyond the position slop
        expect(deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('a third quick tap starts a fresh pair instead of double-firing', () => {
        const { deps, tap } = touchHarness();
        tap(400, 100, 0);
        tap(400, 100, 100);
        tap(400, 100, 200);
        expect(deps.dataDblClick).toHaveBeenCalledTimes(1);
    });

    it('taps that wobble a few px (a real finger) still tap, click, and pair', () => {
        const { deps, wobbleTap } = touchHarness();
        wobbleTap(400, 100, 0);
        expect(deps.onClick).toHaveBeenCalledTimes(1); // the wobble is not a drag on touch
        wobbleTap(402, 103, 150);
        expect(deps.dataDblClick).toHaveBeenCalledTimes(1);
    });

    it('a touch travelling past the touch slop is a pan, not a tap', () => {
        const { deps, wobbleTap } = touchHarness();
        wobbleTap(400, 100, 0, 12);
        wobbleTap(400, 100, 150, 12);
        expect(deps.onClick).not.toHaveBeenCalled();
        expect(deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('the mouse keeps its strict 2px click slop', () => {
        const { deps, mouseDrag } = touchHarness();
        mouseDrag(400, 100, 0, 5); // 5px is a click on touch but a drag for a mouse
        expect(deps.onClick).not.toHaveBeenCalled();
    });
});
