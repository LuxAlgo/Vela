import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

/** The default baseline level (percent of pane height) so no explicit price is set. */
function sceneWithLevel(level: number): SceneGraph {
    const scene = new SceneGraph();
    scene.style.baseline.baselineLevel = level;
    return scene;
}

const bounds = { top: 0, height: 400 };

describe('SceneGraph.baselinePriceFor — auto level placement', () => {
    it('linear scale: level% lands at level% of the pane height', () => {
        const scene = sceneWithLevel(50);
        const scale = { min: 100, max: 200, log: false };
        const coords = new CoordinateSystem();
        const price = scene.baselinePriceFor(scale);
        // 50% between 100 and 200.
        expect(price).toBeCloseTo(150, 6);
        // …and that price draws at the vertical midpoint.
        expect(coords.priceToY(price, scale, bounds)).toBeCloseTo(200, 6);
    });

    it('log scale: level% lands at level% of the pane HEIGHT, not of the price range', () => {
        const scene = sceneWithLevel(50);
        const scale = { min: 100, max: 200, log: true };
        const coords = new CoordinateSystem();
        const price = scene.baselinePriceFor(scale);
        // In log space the midpoint is the geometric mean, NOT the arithmetic 150.
        expect(price).toBeCloseTo(Math.sqrt(100 * 200), 6);
        // The whole point: it must still draw at half the pane height.
        expect(coords.priceToY(price, scale, bounds)).toBeCloseTo(200, 6);
    });

    it('log scale: an off-center level still lands at that fraction of the height', () => {
        const scene = sceneWithLevel(25);
        const scale = { min: 100, max: 200, log: true };
        const coords = new CoordinateSystem();
        const price = scene.baselinePriceFor(scale);
        // 25% up from the bottom → 75% down from the top → y = 300 of 400.
        expect(coords.priceToY(price, scale, bounds)).toBeCloseTo(300, 6);
    });

    it('an explicit baselineValue overrides the level on either scale', () => {
        const scene = sceneWithLevel(50);
        scene.baselineValue = 123.45;
        expect(scene.baselinePriceFor({ min: 100, max: 200, log: false })).toBe(123.45);
        expect(scene.baselinePriceFor({ min: 100, max: 200, log: true })).toBe(123.45);
    });
});
