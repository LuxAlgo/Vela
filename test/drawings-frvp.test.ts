import { describe, it, expect } from 'vitest';
import {
    createDrawing,
    deserializeDrawing,
    getDrawingType,
    buildToolbar,
    buildEstimatedProfile,
    computeFixedRangeProfile,
    FixedRangeVolumeProfile,
    type Projector,
    type FrvpBar,
} from '../src/core/drawings';

const HR = 3600_000;

/** Flat OHLC bars (H=L=C=price) with a per-bar volume, one per hour from t=0. */
function bars(rows: Array<[price: number, volume?: number]>): FrvpBar[] {
    return rows.map(([p, v], i) => ({
        time: i * HR,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: v ?? 0,
    }));
}

/** Linear projector (x = time/HR, y = 1000 − price) that serves `data` via barsInRange. */
function fakeProjector(data: FrvpBar[]): Projector {
    return {
        xOf: (t) => t / HR,
        yOf: (price) => 1000 - price,
        pxToPoint: (x, y) => ({ time: x * HR, price: 1000 - y }),
        paneIdAtY: () => 'price',
        barsInRange: (from, to) => data.filter((b) => b.time >= Math.min(from, to) && b.time <= Math.max(from, to)),
        width: 500,
        height: 1000,
    };
}

describe('drawings/frvp math (estimation)', () => {
    it('adds a bar\'s full volume to every row that contains any OHLC price', () => {
        // One up bar spanning 100→110: O=100, H=110, L=100, C=110 → hits the edge rows of a 2-row profile.
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 110, low: 100, close: 110, volume: 1000 },
        ];
        const p = buildEstimatedProfile(data, 2, 0.7)!;
        expect(p.rows).toHaveLength(2);
        // Both rows receive the full 1000 (estimation does not conserve volume across rows).
        expect(p.rows[0]!.up + p.rows[0]!.down).toBeCloseTo(1000, 6);
        expect(p.rows[1]!.up + p.rows[1]!.down).toBeCloseTo(1000, 6);
        expect(p.rows[0]!.up).toBeCloseTo(1000, 6); // close >= open → up
    });

    it('splits up/down volume by bar direction', () => {
        const data: FrvpBar[] = [
            { time: 0, open: 100, high: 100, low: 100, close: 105, volume: 400 },
            { time: HR, open: 105, high: 105, low: 100, close: 100, volume: 600 },
        ];
        const p = buildEstimatedProfile(data, 10, 0.7)!;
        const up = p.rows.reduce((s, r) => s + r.up, 0);
        const down = p.rows.reduce((s, r) => s + r.down, 0);
        expect(up).toBeGreaterThan(0);
        expect(down).toBeGreaterThan(0);
    });

    it('grows the value area around the POC to cover the requested volume fraction', () => {
        const data = bars([
            [100, 100],
            [101, 100],
            [102, 800],
            [103, 100],
            [104, 100],
        ]);
        const p = buildEstimatedProfile(data, 5, 0.7)!;
        const total = p.rows.reduce((s, r) => s + r.up + r.down, 0);
        let va = 0;
        for (let k = p.vaFrom; k <= p.vaTo; k += 1) va += p.rows[k]!.up + p.rows[k]!.down;
        expect(va).toBeGreaterThanOrEqual(total * 0.7 - 1e-6);
        expect(p.vaFrom).toBeLessThanOrEqual(p.poc);
        expect(p.vaTo).toBeGreaterThanOrEqual(p.poc);
    });

    it('returns null when the window holds no volume', () => {
        expect(buildEstimatedProfile([], 24, 0.7)).toBeNull();
        expect(buildEstimatedProfile(bars([[100, 0]]), 24, 0.7)).toBeNull();
    });

    it('builds developing POC / VA series on the final price grid', () => {
        // Loud volume at the high end arrives last — developing POC should migrate upward.
        const data = bars([
            [100, 100],
            [102, 100],
            [110, 800],
        ]);
        const r = computeFixedRangeProfile(data, 10, 0.7, true)!;
        expect(r.developingPoc).toHaveLength(3);
        expect(r.developingVaHigh).toHaveLength(3);
        expect(r.developingVaLow).toHaveLength(3);
        expect(r.developingPoc[0]!.time).toBe(0);
        expect(r.developingPoc[2]!.time).toBe(2 * HR);
        // Final developing POC matches the finished profile's POC mid-price.
        const finalPocPrice = r.profile.rows[r.profile.poc]!.price + r.profile.rowH / 2;
        expect(r.developingPoc[2]!.price).toBeCloseTo(finalPocPrice, 6);
        // POC after the loud bar is higher than after the first low bar.
        expect(r.developingPoc[2]!.price).toBeGreaterThan(r.developingPoc[0]!.price);
    });
});

describe('drawings/FixedRangeVolumeProfile', () => {
    it('registers in the measure group as a two-anchor tool', () => {
        expect(getDrawingType('fixedrangevp')?.group).toBe('measure');
        expect(getDrawingType('fixedrangevp')?.label).toBe('Fixed Range Volume Profile');
        const d = createDrawing('fixedrangevp', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 0 },
                { time: HR, price: 0 },
            ],
        })! as FixedRangeVolumeProfile;
        expect(d.anchorSchema()).toMatchObject({ min: 2, max: 2 });
        expect(d.frvp.rows).toBe(24);
        expect(d.frvp.valueAreaPct).toBe(70);
        expect(d.frvp.widthPct).toBe(35);
        expect(d.frvp.anchor).toBe('left');
        expect(d.frvp.upColor).toBe('#089981BF');
        expect(d.frvp.downColor).toBe('#f23645BF');
        expect(d.frvp.vaUpColor).toBe('#08998166');
        expect(d.frvp.vaDownColor).toBe('#f2364566');
        expect(d.frvp.vahColor).toBe('#787B86');
        expect(d.frvp.valColor).toBe('#787B86');
        expect(d.frvp.pocColor).toBe('#2962FF');
        expect(d.frvp.developingPocStyle).toBe('dotted');
        expect(d.frvp.developingVaStyle).toBe('dotted');
        expect(d.frvp.developingPocColor).toBe('#2962FF');
        expect(d.frvp.developingVaColor).toBe('#2962FF');
    });

    it('appears under the Volume section next to Anchored VWAP', () => {
        const { definition } = buildToolbar(true);
        const measure = definition.groups.find((g) => g.id === 'measurements');
        expect(measure?.sections?.find((s) => s.label === 'Volume')?.tools.map((t) => t.type)).toEqual([
            'anchoredvwap',
            'fixedrangevp',
        ]);
    });

    it('recomputes the profile when an anchor moves (live re-anchor)', () => {
        const data = bars([
            [100, 100],
            [110, 500],
            [105, 100],
            [120, 900],
        ]);
        const proj = fakeProjector(data);
        const d = createDrawing('fixedrangevp', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 999 },
                { time: 2 * HR, price: 999 },
            ],
        })! as FixedRangeVolumeProfile;
        const first = d.compute(proj)!;
        // Widen the range to include the loud bar at t=3h → POC should move.
        d.anchors[1] = { time: 3 * HR, price: 999 };
        const second = d.compute(proj)!;
        expect(second.profile.maxTotal).toBeGreaterThanOrEqual(first.profile.maxTotal);
        // Layout places handles on the POC line at the time bounds.
        const L = d.layout(proj)!;
        expect(L.x0).toBe(0);
        expect(L.x1).toBe(3);
        expect(d.handlePoints(proj)).toHaveLength(2);
    });

    it('round-trips cosmetics through serialize / deserialize', () => {
        const d = createDrawing('fixedrangevp', {
            paneId: 'price',
            anchors: [
                { time: 0, price: 10 },
                { time: HR, price: 20 },
            ],
        })! as FixedRangeVolumeProfile;
        d.frvp.rows = 48;
        d.frvp.anchor = 'left';
        d.frvp.showDevelopingPoc = true;
        d.frvp.widthPct = 50;
        const doc = d.serialize();
        const restored = deserializeDrawing(doc)! as FixedRangeVolumeProfile;
        expect(restored).toBeInstanceOf(FixedRangeVolumeProfile);
        expect(restored.frvp.rows).toBe(48);
        expect(restored.frvp.anchor).toBe('left');
        expect(restored.frvp.showDevelopingPoc).toBe(true);
        expect(restored.frvp.widthPct).toBe(50);
    });

    it('exposes all settings via frvp.* schema paths (gear panel)', () => {
        const d = createDrawing('fixedrangevp', { paneId: 'price' })!;
        const paths = d.schema().fields.map((f) => f.path);
        expect(paths).toContain('frvp.rows');
        expect(paths).toContain('frvp.valueAreaPct');
        expect(paths).toContain('frvp.widthPct');
        expect(paths).toContain('frvp.anchor');
        expect(paths).toContain('frvp.showPoc');
        expect(paths).toContain('frvp.showDevelopingVa');
        expect(d.editableLevels()).toBeNull();
    });
});
