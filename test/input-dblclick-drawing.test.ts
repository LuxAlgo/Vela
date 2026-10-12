import { describe, it, expect, vi } from 'vitest';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// ── a double-click driven by a drawing tool must never reach the pane maximize
// toggle (which collapses the sub panes); a plain cursor double-click still does ──

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

function harness(claims: boolean[]) {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1);
    cs.setBars([1000, 2000, 3000, 4000, 5000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 2 });
    let press = 0;
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
        drawingsClaim: vi.fn(() => claims[press++] ?? false),
        drawingsPointerDown: vi.fn(),
        drawingsPointerUp: vi.fn(),
        drawingsDblClick: vi.fn(() => false),
    } satisfies InputControllerDeps;
    const ctl = new InputController(deps);
    const el = fakeElement();
    ctl.attach(el as unknown as HTMLElement);
    const base = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
    const click = (): void => {
        el.fire('pointerdown', { ...base, timeStamp: 0 });
        el.fire('pointerup', { ...base, timeStamp: 10 });
    };
    const doubleClick = (): void => {
        click();
        click();
        el.fire('dblclick', { ...base, timeStamp: 20 });
    };
    return { deps, doubleClick };
}

describe('double-click while drawing', () => {
    it('a plain cursor double-click still toggles the pane maximize', () => {
        const h = harness([false, false]);
        h.doubleClick();
        expect(h.deps.dataDblClick).toHaveBeenCalledTimes(1);
    });

    it('does not toggle the pane maximize while a tool claims both clicks', () => {
        const h = harness([true, true]);
        h.doubleClick();
        expect(h.deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('does not toggle it when the tool disarmed after the first click (second click unclaimed)', () => {
        const h = harness([true, false]);
        h.doubleClick();
        expect(h.deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('does not toggle it when only the second click was claimed', () => {
        const h = harness([false, true]);
        h.doubleClick();
        expect(h.deps.dataDblClick).not.toHaveBeenCalled();
    });

    it('an earlier tool click does not poison a later cursor double-click', () => {
        const h = harness([true, false, false]);
        h.doubleClick(); // presses 1-2: tool placement pair
        expect(h.deps.dataDblClick).not.toHaveBeenCalled();
        h.doubleClick(); // presses 3 (unclaimed, claims[2]) and 4 (unclaimed)
        expect(h.deps.dataDblClick).toHaveBeenCalledTimes(1);
    });
});
