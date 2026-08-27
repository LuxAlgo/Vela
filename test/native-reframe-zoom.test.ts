// How the view is framed when the bar series is REPLACED (a symbol/timeframe switch).
// The pinned behavior: the first-ever series fits the content, but a replacement keeps
// the user's zoom (bar spacing) and only re-anchors the newest bars at the default
// right offset — a pan aimed at another market's time range is meaningless, the zoom
// is a preference. A view-preserving replacement (backfill, preview swap) touches
// neither.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { defaultViewport } from '../src/renderers/native/core/ViewportState';
import type { OHLCV } from '../src/core/model/ohlcv';

const T0 = 1_700_000_000_000;
const STEP = 60_000;

const mkBars = (n: number): OHLCV[] =>
    Array.from({ length: n }, (_, i) => ({ time: T0 + i * STEP, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

const WIDTH = 800;

/* eslint-disable @typescript-eslint/no-explicit-any -- the viewport lives behind the renderer's coords; reading it IS the behavior under test */
function makeRenderer() {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(WIDTH, 200, 1); // unmounted but sized — the framing math is pure
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    return { r, viewport: () => anyR.coords.getViewport(), setViewport: (barSpacing: number, rightOffset: number) => anyR.coords.setViewport({ barSpacing, rightOffset }) };
}

describe('framing across series replacements', () => {
    it('the FIRST series fits the content — there is no zoom to keep yet', () => {
        const { r, viewport } = makeRenderer();
        r.setBars(mkBars(500));
        const v = viewport();
        expect(v.barSpacing).toBeCloseTo(WIDTH / 206, 3); // fit: 200 visible bars + the default right offset
        expect(v.rightOffset).toBe(6);
    });

    it('a replacement keeps the zoom and resets the placement to the newest bars', () => {
        const { r, viewport, setViewport } = makeRenderer();
        r.setBars(mkBars(500));
        setViewport(12, 20); // the user zoomed and panned away
        r.setBars(mkBars(150)); // symbol switch — new series, no preserveView
        const v = viewport();
        expect(v.barSpacing).toBe(12); // zoom kept — NOT re-fit to the 150-bar depth
        expect(v.rightOffset).toBe(defaultViewport().rightOffset); // pan reset to the newest bars
    });

    it('the kept zoom is not clamped to the new series depth — a progressive head is still backfilling', () => {
        const { r, viewport, setViewport } = makeRenderer();
        r.setBars(mkBars(500));
        setViewport(2, 6); // zoomed far out: ~400 bars in view
        r.setBars(mkBars(100)); // a progressive first paint, held to the threshold
        expect(viewport().barSpacing).toBe(2); // the fit-all floor would have doubled it
    });

    it('a view-preserving replacement leaves zoom AND placement untouched', () => {
        const { r, viewport, setViewport } = makeRenderer();
        r.setBars(mkBars(150));
        setViewport(12, 20);
        r.setBars(mkBars(300), { preserveView: true }); // deeper snapshot of the same series
        expect(viewport()).toEqual({ barSpacing: 12, rightOffset: 20 });
    });
});
