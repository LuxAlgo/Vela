import { describe, it, expect } from 'vitest';
import { rescaleAround, shiftScale } from '../src/renderers/native/core/manualScale';
import { InputController, type InputControllerDeps } from '../src/renderers/native/core/InputController';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

describe('manual price-scale math', () => {
    it('rescaleAround keeps the center fixed and scales the span by the factor', () => {
        const out = rescaleAround({ min: 100, max: 200 }, 2);
        expect((out.min + out.max) / 2).toBeCloseTo(150); // center preserved
        expect(out.max - out.min).toBeCloseTo(200); // span doubled (zoom out)
    });

    it('rescaleAround factor < 1 compresses the span (zoom in)', () => {
        const out = rescaleAround({ min: 0, max: 100 }, 0.5);
        expect((out.min + out.max) / 2).toBeCloseTo(50);
        expect(out.max - out.min).toBeCloseTo(50);
    });

    it('rescaleAround works in log space about the geometric center', () => {
        const out = rescaleAround({ min: 10, max: 1000, log: true }, 2);
        expect(out.log).toBe(true);
        expect(Math.sqrt(out.min * out.max)).toBeCloseTo(100); // geometric center fixed
        // log-span doubled: original 2 decades → 4 decades
        expect(Math.log10(out.max) - Math.log10(out.min)).toBeCloseTo(4);
    });

    it('shiftScale moves both bounds up in price when dragged DOWN (dy>0)', () => {
        const out = shiftScale({ min: 100, max: 200 }, 50, 100); // span 100 over 100px ⇒ 1 price/px
        expect(out.min).toBeCloseTo(150);
        expect(out.max).toBeCloseTo(250);
    });

    it('shiftScale preserves the span', () => {
        const start = { min: 100, max: 200 };
        const out = shiftScale(start, -30, 100);
        expect(out.max - out.min).toBeCloseTo(start.max - start.min);
        expect(out.min).toBeCloseTo(70);
    });

    it('shiftScale on zero height is a no-op copy', () => {
        const out = shiftScale({ min: 1, max: 2 }, 10, 0);
        expect(out).toEqual({ min: 1, max: 2, log: undefined });
    });
});

function coords(): CoordinateSystem {
    const cs = new CoordinateSystem();
    cs.setSize(800, 200, 1); // data plot is 800×200; right strip x>800, bottom strip y>200
    cs.setBars([1000, 2000, 3000]);
    cs.setViewport({ barSpacing: 50, rightOffset: 1 });
    return cs;
}

function stubDeps(cs: CoordinateSystem, separatorAt: (y: number) => boolean = () => false): InputControllerDeps {
    const noop = (): void => {};
    return {
        getCoords: () => cs,
        apply: noop,
        zoomTo: noop,
        fling: noop,
        onPointerMove: noop,
        onClick: noop,
        beginPriceScale: noop,
        priceScaleBy: noop,
        beginPricePan: () => false,
        pricePanBy: noop,
        resetPriceScale: noop,
        dataDblClick: noop,
        paneSeparatorAt: separatorAt,
        beginPaneResize: noop,
        paneResizeBy: noop,
        resetPaneSize: noop,
        resetView: noop,
    };
}

describe('InputController.regionAt axis hit-testing', () => {
    it('classifies the right price-axis strip, bottom time-axis strip, and data plot', () => {
        const ic = new InputController(stubDeps(coords()));
        expect(ic.regionAt(850, 100)).toBe('price'); // x>800
        expect(ic.regionAt(400, 250)).toBe('time'); // y>200
        expect(ic.regionAt(400, 100)).toBe('data');
        expect(ic.regionAt(850, 250)).toBe('data'); // bottom-right corner ⇒ neither axis
    });

    it('treats everything as data when axisDrag is disabled', () => {
        const ic = new InputController(stubDeps(coords()));
        ic.axisDrag = false;
        expect(ic.regionAt(850, 100)).toBe('data');
        expect(ic.regionAt(400, 250)).toBe('data');
    });
});

describe('NativeRenderer new feature defaults', () => {
    it('axisDrag defaults on; candleZOrder 0; dataWindow off; seriesOrder empty', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('axisDrag');
        expect(r.features).toContain('candleZOrder');
        expect(r.features).toContain('seriesOrder');
        expect(r.features).toContain('dataWindow');
        expect(r.readFeature('axisDrag')).toBe(true);
        expect(r.readFeature('candleZOrder')).toBe(0);
        expect(r.readFeature('dataWindow')).toBe(false);
        expect(r.readFeature('seriesOrder')).toEqual([]);
    });

    it('candleZOrder is settable without a mount', () => {
        const r = new NativeRenderer();
        r.applyFeature('candleZOrder', 3);
        expect(r.readFeature('candleZOrder')).toBe(3);
    });

    it('candleVisible defaults on and toggles the hide flag', () => {
        const r = new NativeRenderer();
        expect(r.features).toContain('candleVisible');
        expect(r.readFeature('candleVisible')).toBe(true);
        r.applyFeature('candleVisible', false);
        expect(r.readFeature('candleVisible')).toBe(false);
        r.applyFeature('candleVisible', true);
        expect(r.readFeature('candleVisible')).toBe(true);
    });
});
