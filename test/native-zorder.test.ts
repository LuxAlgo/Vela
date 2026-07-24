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
    it('defaults to mount order (insertion), so later indicators draw in front', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['a', 'b', 'c']);
        expect(scene.zOf('a')).toBeLessThan(scene.zOf('b'));
        expect(scene.zOf('b')).toBeLessThan(scene.zOf('c'));
    });

    it('bringIndicatorToFront raises an indicator above all others and the candles', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        scene.bringIndicatorToFront('a');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['b', 'c', 'a']);
        expect(scene.zOf('a')).toBeGreaterThan(scene.candleZ);
    });

    it('sendIndicatorToBack drops an indicator below all others and the candles', () => {
        const scene = new SceneGraph();
        mount(scene, 'a');
        mount(scene, 'b');
        mount(scene, 'c');
        scene.sendIndicatorToBack('c');
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['c', 'a', 'b']);
        expect(scene.zOf('c')).toBeLessThan(scene.candleZ);
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
        expect(scene.orderedIndicatorsForPane('price').map((m) => m.id)).toEqual(['a', 'c']);
        expect(scene.orderedIndicatorsForPane('pane-1').map((m) => m.id)).toEqual(['b']);
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
