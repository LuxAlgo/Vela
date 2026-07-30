import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';

function model(id: string, paneId = 'price'): IndicatorModel {
    return {
        id,
        title: id,
        overlay: true,
        paneHint: 'price',
        paneId,
        series: [],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

function mount(scene: SceneGraph, id: string, paneId = 'price'): void {
    scene.indicators.set(id, model(id, paneId));
    scene.assignIndicatorZ(id);
}

describe('SceneGraph z-order', () => {
    it('defaults each new indicator to the back of the stack — behind the candles and the older ones', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        // Ascending z = paint order: the newest paints first (furthest back), the price on top.
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['c', 'b', 'a']);
        expect(scene.zOf('a')).toBeLessThan(scene.candleZ);
        expect(scene.zOf('b')).toBeLessThan(scene.zOf('a'));
        expect(scene.zOf('c')).toBeLessThan(scene.zOf('b'));
    });

    it('bringIndicatorToFront raises an indicator above all others and the candles', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        scene.bringIndicatorToFront('a');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['c', 'b', 'a']);
        expect(scene.zOf('a')).toBeGreaterThan(scene.candleZ);
    });

    it('sendIndicatorToBack drops an indicator below all others and the candles', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        scene.sendIndicatorToBack('a');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['a', 'c', 'b']);
        expect(scene.zOf('a')).toBeLessThan(scene.zOf('c'));
        expect(scene.zOf('a')).toBeLessThan(scene.candleZ);
    });

    it('setIndicatorZ places candles between overlays (z below candleZ ⇒ behind candles)', () => {
        const scene = new SceneGraph(); // candleZ defaults to 0
        mount(scene, 'a');
        mount(scene, 'b');
        scene.setIndicatorZ('a', -1); // below the candles
        scene.setIndicatorZ('b', 5); // above the candles
        const ordered = scene.orderedIndicatorsForPane('price');
        expect(ordered[0]!.id).toBe('a');
        expect(scene.zOf('a')).toBeLessThan(scene.candleZ);
        expect(scene.zOf('b')).toBeGreaterThanOrEqual(scene.candleZ);
    });

    it('orderedIndicatorsForPane only returns models on the requested pane', () => {
        const scene = new SceneGraph();
        mount(scene, 'a', 'price');
        mount(scene, 'b', 'pane-1');
        mount(scene, 'c', 'price');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['c', 'a']);
        expect(scene.orderedIndicatorsForPane('pane-1').map((m) => m.id)).toEqual(['b']);
    });

    it('seriesBoundaries lists a pane\'s series z keys ascending — candles only on the price pane', () => {
        const scene = new SceneGraph();
        mount(scene, 'a', 'price'); // -1
        mount(scene, 'b', 'pane-1'); // -2
        scene.setIndicatorZ('a', 4);
        expect(scene.seriesBoundaries('price')).toEqual([0, 4]); // candles at 0, a raised to 4
        expect(scene.seriesBoundaries('pane-1')).toEqual([-2]);
    });

    it('forgetIndicatorZ drops the order key on removal', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        scene.forgetIndicatorZ('a');
        expect(scene.indicatorZOrder()).toEqual([]);
    });

    it('indicatorZOrder snapshots {id,z} sorted by z', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        scene.setIndicatorZ('a', 9);
        scene.setIndicatorZ('b', 3);
        expect(scene.indicatorZOrder()).toEqual([
            { id: 'b', z: 3 },
            { id: 'a', z: 9 },
        ]);
    });
});
