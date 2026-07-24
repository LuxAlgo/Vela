import { describe, it, expect } from 'vitest';
import { wheelZoomAnchor, isHorizontalWheel, wheelPanRightOffset, InputController } from '../src/renderers/native/core/InputController';
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

describe('wheel-zoom anchor defaults to the right edge', () => {
    it('InputController.rightEdgeZoom is true by default', () => {
        expect(new InputController({} as never).rightEdgeZoom).toBe(true);
    });

    it("NativeRenderer reports zoomAnchor 'right' by default", () => {
        expect(new NativeRenderer().readFeature('zoomAnchor')).toBe('right');
    });
});
