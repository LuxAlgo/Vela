// What the renderer does when the bar array's HEAD moves under mounted indicators — the
// other half of a depth change (the core half lives in set-market.test.ts). Two regressions
// are pinned here: a model whose anchor is older than the new first bar must be placed with
// a NEGATIVE offset (it used to be pinned at index 0, drawing the whole plot shifted left),
// and a value patch must be able to CLEAR an anchor, not only change it.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { IndicatorModel } from '../src/core/model/indicator';
import type { ValuePatch } from '../src/core/model/patch';

const T0 = 1_700_000_000_000;
const STEP = 60_000;

const mkBars = (n: number, from = 0): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: T0 + (from + i) * STEP, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

/** A model whose dense line series spans bars [from, from+n) of the same grid. */
function model(id: string, n: number, from = 0): IndicatorModel {
    return {
        id,
        title: id,
        overlay: true,
        paneHint: 'price',
        paneId: 'price',
        anchorTime: T0 + from * STEP,
        series: [
            {
                id: `${id}:line`,
                title: id,
                paneId: 'price',
                kind: 'line',
                points: Array.from({ length: n }, (_, i) => ({ time: T0 + (from + i) * STEP, value: from + i })),
                style: { color: '#f00', width: 1, lineStyle: 'solid' },
            },
        ],
        fills: [],
        backgrounds: [],
        priceLines: [],
        inputs: [],
        inputValues: {},
    };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the offset map is renderer-private; reading it IS the regression */
function makeRenderer() {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1); // unmounted but sized — the index math is pure
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    anyR.syncTables = () => {}; // mount-owned DOM overlay, irrelevant to index math
    return {
        r,
        anyR,
        offsetOf: (id: string): number => anyR.scene.offsetOf(id),
        /** Mount without the DOM half of `mountIndicator` (legend, panes, tables): the
         *  scene entry plus the anchor derivation are all this file is about. */
        mount(model: IndicatorModel): { id: string } {
            anyR.scene.indicators.set(model.id, model);
            anyR.refreshAnchorOffset(model);
            return { id: model.id };
        },
    };
}

describe('a mounted model when the chart head moves FORWARD (a shallower series)', () => {
    it('is placed with a negative offset — its leading values are skipped, not shifted onto bar 0', () => {
        const { r, offsetOf, mount } = makeRenderer();
        r.setBars(mkBars(100));
        mount(model('m', 100)); // whole-chart model: no offset
        expect(offsetOf('m')).toBe(0);

        // The array is trimmed to its newest 40 bars — the model still holds all 100 values,
        // now starting 60 bars before the chart does.
        r.setBars(mkBars(40, 60), { preserveView: true });
        expect(offsetOf('m')).toBe(-60);
    });

    it('the offset tracks the head exactly, in both directions, across successive moves', () => {
        const { r, offsetOf, mount } = makeRenderer();
        r.setBars(mkBars(100));
        mount(model('m', 100));

        r.setBars(mkBars(70, 30), { preserveView: true });
        expect(offsetOf('m')).toBe(-30);
        r.setBars(mkBars(90, 10), { preserveView: true }); // older bars come back
        expect(offsetOf('m')).toBe(-10);
        r.setBars(mkBars(100), { preserveView: true }); // fully restored → whole-chart again
        expect(offsetOf('m')).toBe(0);
    });

    it('a model that ran over a SUFFIX still gets its positive offset (unchanged path)', () => {
        const { r, offsetOf, mount } = makeRenderer();
        r.setBars(mkBars(100));
        mount(model('late', 40, 60)); // anchored at bar 60
        expect(offsetOf('late')).toBe(60);
    });

    it('a model whose values all predate the chart is pushed entirely off the array', () => {
        const { r, offsetOf, mount } = makeRenderer();
        r.setBars(mkBars(100));
        mount(model('old', 20)); // covers bars 0..19 only
        r.setBars(mkBars(40, 60), { preserveView: true }); // chart now starts at bar 60
        // Every value is older than the head: the offset skips the whole array, so nothing
        // is drawn — the honest outcome, versus painting 20 stale values over fresh bars.
        expect(offsetOf('old')).toBe(-20);
    });
});

describe('logical interaction anchors follow a front trim', () => {
    it('shift DOWN by the trimmed count, mirroring the prepend case', () => {
        const { r, anyR } = makeRenderer();
        r.setBars(mkBars(100));
        anyR.zoomAnchorLogical = 90;
        anyR.hoverLogical = 80;
        r.setBars(mkBars(40, 60), { preserveView: true });
        expect(anyR.zoomAnchorLogical).toBe(30); // 90 − 60
        expect(anyR.hoverLogical).toBe(20);
    });
});

describe('a value patch can CLEAR an anchor', () => {
    it('null re-derives the offset as whole-chart; an omitted key leaves it alone', () => {
        const { r, offsetOf, mount } = makeRenderer();
        r.setBars(mkBars(100));
        const handle = mount(model('m', 40, 60));
        expect(offsetOf('m')).toBe(60);

        // The script re-ran over the WHOLE chart: the patch says so with null.
        const cleared: ValuePatch = { kind: 'value', indicatorId: 'm', dirty: { from: 0, to: 0 }, anchorTime: null, series: [] };
        r.updateIndicator(handle, cleared);
        expect(offsetOf('m')).toBe(0);

        // A patch that states an anchor again moves it back…
        r.updateIndicator(handle, { kind: 'value', indicatorId: 'm', dirty: { from: 0, to: 0 }, anchorTime: T0 + 60 * STEP, series: [] });
        expect(offsetOf('m')).toBe(60);
        // …and one that omits the key changes nothing.
        r.updateIndicator(handle, { kind: 'value', indicatorId: 'm', dirty: { from: 0, to: 0 }, series: [] });
        expect(offsetOf('m')).toBe(60);
    });
});
