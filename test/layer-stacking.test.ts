// SDK layer-canvas stacking (src/renderers/native/core/layerStacking.ts): a layer owned
// by a native indicator (its type equals the layer id) follows that indicator's z key
// against the candles', so the object tree's restacking reaches layer-drawn indicators;
// unowned (chart-type) layers keep their declared placement. The DOM re-slotting and the
// painted result are exercised in the browser; the ordering rules are the unit-testable part.
import { describe, it, expect } from 'vitest';
import { stackLayers } from '../src/renderers/native/core/layerStacking';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';

describe('stackLayers', () => {
    it('unowned layers keep their declared placement', () => {
        const { below, above } = stackLayers(
            [
                { id: 'reveal', placement: 'below-data', ownerZ: null },
                { id: 'grid', placement: 'above-data', ownerZ: null },
            ],
            0,
        );
        expect(below).toEqual(['reveal']);
        expect(above).toEqual(['grid']);
    });

    it('an owned layer slots by its owner z against the candles', () => {
        const entries = [
            { id: 'bubbles', placement: 'above-data' as const, ownerZ: 6 },
            { id: 'tpo', placement: 'above-data' as const, ownerZ: -2 },
        ];
        const { below, above } = stackLayers(entries, 5);
        expect(below).toEqual(['tpo']); // z -2 < candleZ 5 → behind the data canvas
        expect(above).toEqual(['bubbles']); // z 6 ≥ 5 → in front
    });

    it('owner z exactly at candleZ paints in front (matches the series rule "at/above draw in front")', () => {
        expect(stackLayers([{ id: 'a', placement: 'above-data', ownerZ: 5 }], 5).above).toEqual(['a']);
    });

    it('orders each side by z; unowned above-data layers sit directly over the data canvas', () => {
        const { above } = stackLayers(
            [
                { id: 'owned-high', placement: 'above-data', ownerZ: 9 },
                { id: 'style-channel', placement: 'above-data', ownerZ: null }, // key = candleZ 0
                { id: 'owned-low', placement: 'above-data', ownerZ: 3 },
            ],
            0,
        );
        expect(above).toEqual(['style-channel', 'owned-low', 'owned-high']);
    });

    it('unowned below-data layers stay at the very back, behind owned below-candle layers', () => {
        const { below } = stackLayers(
            [
                { id: 'owned-back', placement: 'above-data', ownerZ: -3 },
                { id: 'reveal', placement: 'below-data', ownerZ: null },
            ],
            0,
        );
        expect(below).toEqual(['reveal', 'owned-back']);
    });

    it('ties keep registration order (stable sort)', () => {
        const { above } = stackLayers(
            [
                { id: 'first', placement: 'above-data', ownerZ: 2 },
                { id: 'second', placement: 'above-data', ownerZ: 2 },
            ],
            0,
        );
        expect(above).toEqual(['first', 'second']);
    });
});

describe('SceneGraph.assignIndicatorZTop', () => {
    it('mounts at the top of the stack (above the candles and every series)', () => {
        const scene = new SceneGraph();
        scene.candleZ = 0;
        scene.assignIndicatorZ('series-a'); // bottom: -1
        scene.assignIndicatorZTop('layer-native');
        expect(scene.zOf('layer-native')).toBeGreaterThan(scene.candleZ);
        expect(scene.zOf('layer-native')).toBeGreaterThan(scene.zOf('series-a'));
    });

    it('keeps an existing key, so a restored stacking survives the remount', () => {
        const scene = new SceneGraph();
        scene.setIndicatorZ('layer-native', -7); // e.g. restored from a persisted config
        scene.assignIndicatorZTop('layer-native');
        expect(scene.zOf('layer-native')).toBe(-7);
    });

    it('successive mounts stack in add order, newest in front', () => {
        const scene = new SceneGraph();
        scene.assignIndicatorZTop('a');
        scene.assignIndicatorZTop('b');
        expect(scene.zOf('b')).toBeGreaterThan(scene.zOf('a'));
    });
});
