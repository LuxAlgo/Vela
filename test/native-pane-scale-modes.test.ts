import { describe, it, expect } from 'vitest';
import { SceneGraph, paneScaleMode, paneLogScale, paneInvert, percentBaselineFor, percentScaleFor } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

/** A scene with a price pane and one study pane — the minimum to prove scale independence. */
function makeScene() {
    const scene = new SceneGraph();
    const price = scene.ensurePane('price', 'price', 0, 3);
    const study = scene.ensurePane('s1', 'study', 1, 1);
    return { scene, price, study };
}

describe('per-pane scale mode / log independence', () => {
    it('defaults: the price pane follows the scene, study panes are regular + linear', () => {
        const { scene, price, study } = makeScene();
        expect(paneScaleMode(scene, price)).toBe('price');
        expect(paneScaleMode(scene, study)).toBe('price');
        expect(paneLogScale(scene, price)).toBe(false);
        expect(paneLogScale(scene, study)).toBe(false);
    });

    it('a study pane switching to percent / log does NOT touch the price pane', () => {
        const { scene, price, study } = makeScene();
        study.scaleMode = 'percent';
        study.logScale = true;
        expect(paneScaleMode(scene, study)).toBe('percent');
        expect(paneLogScale(scene, study)).toBe(true);
        // the price pane stays on the (default) scene setting — no leak from the study pane
        expect(paneScaleMode(scene, price)).toBe('price');
        expect(paneLogScale(scene, price)).toBe(false);
    });

    it('the price pane follows the scene-level setting; study panes ignore it', () => {
        const { scene, price, study } = makeScene();
        scene.scaleMode = 'percent';
        scene.logScale = true;
        expect(paneScaleMode(scene, price)).toBe('percent');
        expect(paneLogScale(scene, price)).toBe(true);
        // the study pane keeps its own default — the scene (price) toggle didn't leak into it
        expect(paneScaleMode(scene, study)).toBe('price');
        expect(paneLogScale(scene, study)).toBe(false);
    });

    it('percentBaselineFor gates on each pane\'s own mode + baseline', () => {
        const { scene, price, study } = makeScene();
        price.percentBaseline = 100;
        study.percentBaseline = 50;
        // regular ⇒ no baseline (absolute axis) on either pane
        expect(percentBaselineFor(scene, price)).toBeUndefined();
        expect(percentBaselineFor(scene, study)).toBeUndefined();
        // each pane opts into percent independently, using its own reference value
        scene.scaleMode = 'percent'; // price pane only
        study.scaleMode = 'percent'; // study pane only
        expect(percentBaselineFor(scene, price)).toBe(100);
        expect(percentBaselineFor(scene, study)).toBe(50);
    });

    it('percentScaleFor describes percent vs indexed per pane, and gates on a usable baseline', () => {
        const { scene, price, study } = makeScene();
        price.percentBaseline = 100;
        study.percentBaseline = 50;
        // absolute ⇒ no descriptor
        expect(percentScaleFor(scene, price)).toBeUndefined();
        // percent ⇒ indexed:false
        scene.scaleMode = 'percent';
        expect(percentScaleFor(scene, price)).toEqual({ baseline: 100, indexed: false });
        // indexed ⇒ indexed:true, independent per pane
        study.scaleMode = 'indexed';
        expect(percentScaleFor(scene, study)).toEqual({ baseline: 50, indexed: true });
        expect(percentScaleFor(scene, price)).toEqual({ baseline: 100, indexed: false });
        // a zero/non-finite baseline falls back to absolute even in percent/indexed mode
        study.percentBaseline = 0;
        expect(percentScaleFor(scene, study)).toBeUndefined();
    });
});

describe('per-pane inverted axis', () => {
    it('defaults to normal orientation; each pane flips independently', () => {
        const { scene, price, study } = makeScene();
        expect(paneInvert(scene, price)).toBe(false);
        expect(paneInvert(scene, study)).toBe(false);
        study.invert = true; // study pane only
        expect(paneInvert(scene, study)).toBe(true);
        expect(paneInvert(scene, price)).toBe(false); // no leak
        scene.invertScale = true; // price pane follows the scene flag
        expect(paneInvert(scene, price)).toBe(true);
    });

    it('priceToY flips high-at-top → high-at-bottom, and yToPrice round-trips', () => {
        const coords = new CoordinateSystem();
        const bounds = { top: 0, height: 100 };
        const normal = { min: 0, max: 100 };
        const inverted = { min: 0, max: 100, invert: true };
        // normal: max sits at the top edge, min at the bottom
        expect(coords.priceToY(100, normal, bounds)).toBeCloseTo(0);
        expect(coords.priceToY(0, normal, bounds)).toBeCloseTo(100);
        // inverted: the axis is mirrored
        expect(coords.priceToY(100, inverted, bounds)).toBeCloseTo(100);
        expect(coords.priceToY(0, inverted, bounds)).toBeCloseTo(0);
        // and the inverse transform stays consistent
        expect(coords.yToPrice(0, inverted, bounds)).toBeCloseTo(0);
        expect(coords.yToPrice(100, inverted, bounds)).toBeCloseTo(100);
        expect(coords.yToPrice(coords.priceToY(42, inverted, bounds), inverted, bounds)).toBeCloseTo(42);
    });
});
