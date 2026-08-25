import { describe, it, expect, afterEach } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

/**
 * Device-pixel alignment of the canvas pile — regression guard for the "feathered
 * candles" bug on fractional-dpr displays (Windows 125%/150%).
 *
 * `clientWidth`/`clientHeight` are integer-rounded, so a backing store sized from them
 * (`round(client × dpr)`) can cover a DIFFERENT number of device pixels than the
 * fractional box the canvas is displayed in — the compositor then resamples the whole
 * bitmap, and every device-snapped edge (candle bodies, wicks, gridlines) smears by
 * ~1px. `syncSize` must therefore size the backing store from the plot's REAL box
 * (preferring the resize observer's device-pixel-content-box report when it has one)
 * and pin each canvas's CSS size to `backing / dpr`, so bitmap px == device px.
 *
 * The box's fractional device OFFSET is deliberately NOT compensated: the compositor
 * pixel-snaps a layer's layout position by itself, while an explicit sub-pixel
 * translate joins the composite matrix and resamples the texture — blending every
 * horizontal edge 50/50 (measured in a real browser). syncSize must never write a
 * transform.
 *
 * The scenario below is the measured real-world case: dpr 1.25, plot box
 * 1441.6 × 661.6 CSS px at (44, 38.8). Same node-env stubbing technique as
 * native-anim-settle.test.ts.
 */

type AnyRenderer = Record<string, any>;

const RECT = { left: 44, top: 38.8, width: 1441.6, height: 661.6 };

function setup(): { r: AnyRenderer } {
    (globalThis as { window?: unknown }).window = { devicePixelRatio: 1.25 };
    const renderer = new NativeRenderer();
    const r = renderer as unknown as AnyRenderer;
    const canvas = () => ({ width: 0, height: 0, style: {} });
    r.wrapper = { clientWidth: 1486, clientHeight: 662 };
    r.plot = { style: {}, getBoundingClientRect: () => RECT };
    r.backdropCanvas = canvas();
    r.dataCanvas = canvas();
    r.volumeCanvas = canvas();
    r.vpvrCanvas = canvas();
    r.chromeCanvas = canvas();
    r.drawingsCanvas = canvas();
    r.cursorCanvas = canvas();
    r.extLayers = [{ def: { id: 'x', placement: 'above-data' }, instance: {}, canvas: canvas() }];
    r.layoutPanes = () => {};
    r.didInitialFit = true;
    r.scheduler = { flushNow: () => {} };
    r.animator = { active: false };
    return { r };
}

describe('syncSize pins the canvas pile to the device-pixel grid', () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    afterEach(() => { (globalThis as { window?: unknown }).window = originalWindow; });

    it('sizes the backing store from the real (fractional) plot box, not client sizes', () => {
        const { r } = setup();
        r.syncSize();
        // 1441.6 × 1.25 = 1802 exactly — clientWidth would have rounded to 1442 → 1803.
        expect(r.dataCanvas.width).toBe(1802);
        expect(r.dataCanvas.height).toBe(827);
    });

    it('pins each canvas CSS size to backing / dpr so bitmap px == device px', () => {
        const { r } = setup();
        r.syncSize();
        expect(r.dataCanvas.style.width).toBe('1441.6px');
        expect(r.dataCanvas.style.height).toBe('661.6px');
    });

    it('never writes a transform — offset snapping belongs to the compositor', () => {
        const { r } = setup();
        r.syncSize();
        // An explicit sub-pixel translate would join the composite matrix and resample
        // the texture (50/50-blended horizontal edges); the layout offset is left alone.
        expect(r.dataCanvas.style.transform).toBeUndefined();
    });

    it('applies the same geometry to every canvas in the pile', () => {
        const { r } = setup();
        r.syncSize();
        for (const c of [r.backdropCanvas, r.volumeCanvas, r.vpvrCanvas, r.chromeCanvas, r.drawingsCanvas, r.cursorCanvas, r.extLayers[0].canvas]) {
            expect(c.width).toBe(1802);
            expect(c.height).toBe(827);
            expect(c.style.width).toBe('1441.6px');
        }
    });

    it('feeds the coordinate system the exact CSS size of the aligned canvases', () => {
        const { r } = setup();
        r.syncSize();
        expect(r.coords.width + r.rightAxisW).toBeCloseTo(1441.6, 9);
        expect(r.coords.dpr).toBe(1.25);
    });

    it('prefers the observer-reported device-pixel box over the rounded rect', () => {
        const { r } = setup();
        // The browser's own snapping may land one device px off plain rounding
        // (rect × dpr = 1802) — its report is the truth and must win.
        r.plotDeviceSize = { width: 1801, height: 827 };
        r.syncSize();
        expect(r.dataCanvas.width).toBe(1801);
        expect(r.dataCanvas.style.width).toBe('1440.8px');
    });

    it('rejects a stale device-pixel report that no longer describes the box', () => {
        const { r } = setup();
        // As after the toolbar gutter moved the plot: the stashed report is for the OLD
        // box (off by far more than snapping can explain) — fall back to the rect.
        r.plotDeviceSize = { width: 1700, height: 827 };
        r.syncSize();
        expect(r.dataCanvas.width).toBe(1802);
        expect(r.dataCanvas.style.width).toBe('1441.6px');
    });
});
