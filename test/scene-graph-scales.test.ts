import { describe, it, expect } from 'vitest';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';

function model(id: string, paneId: string, ownScale = false): IndicatorModel {
    return {
        id, title: id, overlay: false, paneHint: 'new', paneId, ownScale,
        series: [{ id: `${id}:l`, title: id, paneId, kind: 'line', points: [], style: { color: '#fff', width: 1, lineStyle: 'solid' } }],
        fills: [], backgrounds: [], priceLines: [], inputs: [], inputValues: {},
    };
}

describe('SceneGraph — per-indicator scale slots', () => {
    it('scaleFor returns the pane scale for a shared indicator and a private scale for a merged one', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0, 3);
        pane.scale = { min: 10, max: 20 };

        const shared = model('a', 'price', false);
        const merged = model('b', 'price', true);
        scene.indicators.set('a', shared);
        scene.indicators.set('b', merged);

        // Shared indicator: draws on the pane's master scale.
        expect(scene.scaleFor(shared, pane)).toBe(pane.scale);

        // Merged indicator: gets its own slot, independent of the pane scale.
        const slot = scene.ensureIndicatorScale('b', pane.scaleTarget);
        slot.scale = { min: 0, max: 100 };
        expect(scene.scaleFor(merged, pane)).toEqual({ min: 0, max: 100 });
        expect(scene.scaleFor(merged, pane)).not.toBe(pane.scale);
    });

    it('ownScaleIndicatorsForPane lists only merged indicators (one axis column each), in z order', () => {
        const scene = new SceneGraph();
        scene.ensurePane('p1', 'study', 1, 1);
        scene.indicators.set('shared', model('shared', 'p1', false));
        scene.indicators.set('m1', model('m1', 'p1', true));
        scene.indicators.set('m2', model('m2', 'p1', true));
        scene.setIndicatorZ('m1', 5);
        scene.setIndicatorZ('m2', 2);

        const merged = scene.ownScaleIndicatorsForPane('p1').map((m) => m.id);
        expect(merged).toEqual(['m2', 'm1']); // sorted by ascending z, shared excluded
    });

    it('dropIndicatorScale removes the private slot (merge → unmerge falls back to the pane scale)', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('price', 'price', 0, 3);
        const m = model('b', 'price', true);
        scene.indicators.set('b', m);
        scene.ensureIndicatorScale('b');
        expect(scene.indicatorScales.has('b')).toBe(true);

        scene.dropIndicatorScale('b');
        expect(scene.indicatorScales.has('b')).toBe(false);
        // With no slot, even a still-ownScale model falls back to the pane scale.
        expect(scene.scaleFor(m, pane)).toBe(pane.scale);
    });

    it('orderPanes reassigns order + reflects in orderedPanes (price stays first)', () => {
        const scene = new SceneGraph();
        scene.ensurePane('price', 'price', 0, 3);
        scene.ensurePane('a', 'study', 1, 1);
        scene.ensurePane('b', 'study', 2, 1);

        scene.orderPanes(['price', 'b', 'a']);
        expect(scene.orderedPanes().map((p) => p.id)).toEqual(['price', 'b', 'a']);
    });

    it('a new pane starts uncollapsed', () => {
        const scene = new SceneGraph();
        const pane = scene.ensurePane('a', 'study', 1, 1);
        expect(pane.collapsed).toBe(false);
    });
});
