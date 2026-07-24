import { describe, it, expect } from 'vitest';
import { resizeSplit, MIN_PANE_PX, type PaneSplit } from '../src/renderers/native/core/paneResize';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

describe('pane-resize math (resizeSplit)', () => {
    // A 75/25 price:study split: combined span [0, 400], weights 3 + 1.
    const split: PaneSplit = { combinedTop: 0, combinedHeight: 400, combinedWeight: 4, startBoundaryY: 300 };

    it('preserves the combined weight so sibling panes keep their size', () => {
        const { above, below } = resizeSplit(split, -120); // drag the boundary up 120px
        expect(above + below).toBeCloseTo(split.combinedWeight);
    });

    it('dragging down grows the upper pane, up grows the lower pane', () => {
        const base = resizeSplit(split, 0);
        const down = resizeSplit(split, 60);
        const up = resizeSplit(split, -60);
        expect(down.above).toBeGreaterThan(base.above);
        expect(up.above).toBeLessThan(base.above);
    });

    it('maps the new boundary to weights proportionally', () => {
        // Move boundary from 300 to 200 ⇒ upper pane is 200/400 of the span ⇒ weight 2.
        const { above, below } = resizeSplit(split, -100);
        expect(above).toBeCloseTo(2);
        expect(below).toBeCloseTo(2);
    });

    it('clamps so neither pane shrinks below the minimum height', () => {
        const farUp = resizeSplit(split, -10_000); // upper pane wants to vanish
        const upperPx = (farUp.above / split.combinedWeight) * split.combinedHeight;
        expect(upperPx).toBeCloseTo(MIN_PANE_PX);

        const farDown = resizeSplit(split, 10_000); // lower pane wants to vanish
        const lowerPx = (farDown.below / split.combinedWeight) * split.combinedHeight;
        expect(lowerPx).toBeCloseTo(MIN_PANE_PX);
    });

    it('degrades to an even split when the span is too small to honor the minimum twice', () => {
        const tiny: PaneSplit = { combinedTop: 0, combinedHeight: 20, combinedWeight: 2, startBoundaryY: 0 };
        const { above, below } = resizeSplit(tiny, -10_000);
        expect(above).toBeCloseTo(below); // both pinned to the midpoint
    });
});

describe('InputController separator region classification', () => {
    function makeController(opts: { separator?: boolean } = {}): { input: InputController; calls: string[] } {
        const calls: string[] = [];
        const coords = { width: 800, height: 400 };
        const deps: InputControllerDeps = {
            getCoords: () => coords as unknown as ReturnType<InputControllerDeps['getCoords']>,
            apply: () => {},
            zoomTo: () => {},
            fling: () => {},
            onPointerMove: () => {},
            onClick: () => {},
            beginPriceScale: () => calls.push('beginPriceScale'),
            priceScaleBy: () => {},
            beginPricePan: () => {
                calls.push('beginPricePan');
                return false;
            },
            pricePanBy: () => {},
            resetPriceScale: () => calls.push('resetPriceScale'),
            dataDblClick: () => calls.push('dataDblClick'),
            paneSeparatorAt: () => Boolean(opts.separator),
            beginPaneResize: () => calls.push('beginPaneResize'),
            paneResizeBy: () => calls.push('paneResizeBy'),
            resetPaneSize: () => calls.push('resetPaneSize'),
            resetView: () => calls.push('resetView'),
        };
        return { input: new InputController(deps), calls };
    }

    it('classifies a point on a separator inside the data area as "separator"', () => {
        const { input } = makeController({ separator: true });
        expect(input.regionAt(400, 300)).toBe('separator');
    });

    it('classifies a normal data-area point (no separator) as "data"', () => {
        const { input } = makeController({ separator: false });
        expect(input.regionAt(400, 300)).toBe('data');
    });

    it('lets a separator win over the price-axis strip where they cross (grabbable over the scale)', () => {
        const { input } = makeController({ separator: true });
        // The separator spans the full width, so a separator y in the right gutter (x > width)
        // resolves to 'separator' — you can grab the divider over the scale, not scale the axis.
        expect(input.regionAt(820, 300)).toBe('separator');
    });

    it('classifies the right price-axis strip when not on a separator y', () => {
        const { input } = makeController({ separator: false });
        expect(input.regionAt(820, 300)).toBe('price'); // x > width, no separator here
    });

    it('classifies the bottom time-axis strip (below the panes) as "time"', () => {
        const { input } = makeController({ separator: true });
        expect(input.regionAt(400, 420)).toBe('time'); // y > height → below any separator
    });

    it('ignores separators when paneResize is disabled', () => {
        const { input } = makeController({ separator: true });
        input.paneResize = false;
        expect(input.regionAt(400, 300)).toBe('data');
    });
});

describe('InputController double-click routing by region', () => {
    // A minimal element stub (this suite runs in the node env — no jsdom). It records the
    // listeners `attach` wires up and can fire them with a synthetic MouseEvent-like object.
    function fakeEl(): { addEventListener: (t: string, fn: (e: unknown) => void) => void; removeEventListener: (t: string, fn: (e: unknown) => void) => void; getBoundingClientRect: () => DOMRect; fire: (t: string, e: unknown) => void } {
        const listeners = new Map<string, Array<(e: unknown) => void>>();
        return {
            addEventListener: (t, fn) => { const a = listeners.get(t) ?? []; a.push(fn); listeners.set(t, a); },
            removeEventListener: (t, fn) => { listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)); },
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }) as DOMRect,
            fire: (t, e) => { for (const fn of listeners.get(t) ?? []) fn(e); },
        };
    }

    function makeController(): { input: InputController; calls: string[]; el: ReturnType<typeof fakeEl> } {
        const calls: string[] = [];
        const coords = { width: 800, height: 400 };
        const el = fakeEl();
        const deps: InputControllerDeps = {
            getCoords: () => coords as unknown as ReturnType<InputControllerDeps['getCoords']>,
            apply: () => {},
            zoomTo: () => {},
            fling: () => {},
            onPointerMove: () => {},
            onClick: () => {},
            beginPriceScale: () => {},
            priceScaleBy: () => {},
            beginPricePan: () => false,
            pricePanBy: () => {},
            resetPriceScale: () => calls.push('resetPriceScale'),
            dataDblClick: () => calls.push('dataDblClick'),
            paneSeparatorAt: () => false,
            beginPaneResize: () => {},
            paneResizeBy: () => {},
            resetPaneSize: () => calls.push('resetPaneSize'),
            resetView: () => calls.push('resetView'),
        };
        const input = new InputController(deps);
        input.attach(el as unknown as HTMLElement);
        return { input, calls, el };
    }

    const dbl = (el: ReturnType<typeof fakeEl>, clientX: number, clientY: number): void => {
        el.fire('dblclick', { clientX, clientY });
    };

    it('double-clicking the time-axis strip fits the view to content (resetView)', () => {
        const { el, calls } = makeController();
        dbl(el, 400, 420); // y > height ⇒ time strip
        expect(calls).toEqual(['resetView']);
    });

    it('double-clicking the data area toggles the pane (dataDblClick), not the view reset', () => {
        const { el, calls } = makeController();
        dbl(el, 400, 200); // inside the plot
        expect(calls).toEqual(['dataDblClick']);
    });

    it('double-clicking the price axis resets that pane scale', () => {
        const { el, calls } = makeController();
        dbl(el, 820, 200); // x > width ⇒ price strip
        expect(calls).toEqual(['resetPriceScale']);
    });
});

describe('NativeRenderer paneResize feature', () => {
    it('is advertised and enabled by default', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('paneResize');
        expect(r.readFeature('paneResize')).toBe(true);
    });

    it('can be toggled off and back on without a mount', () => {
        const r = new NativeRenderer();
        r.applyFeature('paneResize', false);
        expect(r.readFeature('paneResize')).toBe(false);
        r.applyFeature('paneResize', true);
        expect(r.readFeature('paneResize')).toBe(true);
    });
});
