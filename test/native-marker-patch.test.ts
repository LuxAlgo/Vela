// A marker series is patched like the other series kinds: a value patch carries its whole
// marker set, and the renderer swaps it into the mounted model. Without that, markers for
// bars that arrive after the mount (a history backfill, live bars) never reach the scene.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { MarkerPoint } from '../src/core/model/series';
import type { ValuePatch } from '../src/core/model/patch';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

const marker = (i: number): MarkerPoint => ({ time: T0 + i * HOUR, position: 'aboveBar', shape: 'triangleup', color: '#f23645' });

function markerModel(markers: MarkerPoint[]): IndicatorModel {
    return {
        id: 'fractals',
        title: 'Fractals',
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        series: [{ id: 'fractals:markers', title: 'Fractals', paneId: 'price', kind: 'markers', markers }],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

describe('a value patch on a marker series', () => {
    it('replaces the mounted markers with the ones the patch carries', () => {
        const r = new NativeRenderer();
        const internals = r as unknown as { scene: SceneGraph; scheduler: { invalidate(): void } };
        internals.scheduler = { invalidate: () => {} }; // unmounted: there is no frame to schedule
        // The scene half of `mountIndicator`, without its DOM (legend, panes, tables).
        internals.scene.indicators.set('fractals', markerModel([marker(2)]));

        // Later bars confirmed two more markers; the patch carries the whole set.
        const markers = [marker(2), marker(9), marker(14)];
        const patch: ValuePatch = {
            kind: 'value',
            indicatorId: 'fractals',
            dirty: { from: T0, to: T0 + 14 * HOUR },
            series: [{ seriesId: 'fractals:markers', kind: 'markers', markers }],
        };
        r.updateIndicator({ id: 'fractals' }, patch);

        const series = internals.scene.indicators.get('fractals')?.series[0];
        expect(series?.kind === 'markers' ? series.markers : null).toEqual(markers);
    });
});
