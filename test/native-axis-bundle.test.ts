import { describe, it, expect } from 'vitest';
import { paneAxisTicks, formatAxisValue, formatPct, timeTicks } from '../src/renderers/native/chrome/ticks';
import { tzOffsetMs, zonedDate } from '../src/renderers/native/chrome/tz';
import { keyToAction } from '../src/renderers/native/core/KeyboardController';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';

describe('percent-scale ticks + labels (item 14a)', () => {
    it('formatPct signs and fixes to 2 decimals', () => {
        expect(formatPct(2.345)).toBe('+2.35%');
        expect(formatPct(-1.2)).toBe('-1.20%');
        expect(formatPct(0)).toBe('+0.00%');
    });

    it('formatAxisValue is absolute price without a descriptor, percent / indexed with one', () => {
        const scale = { min: 90, max: 110 };
        expect(formatAxisValue(scale, 300, 100)).toBe('100.0'); // price mode (no descriptor)
        expect(formatAxisValue(scale, 300, 110, { baseline: 100, indexed: false })).toBe('+10.00%'); // percent vs 100
        expect(formatAxisValue(scale, 300, 100, { baseline: 100, indexed: false })).toBe('+0.00%');
        expect(formatAxisValue(scale, 300, 110, { baseline: 100, indexed: true })).toBe('110.00'); // indexed to 100
        expect(formatAxisValue(scale, 300, 100, { baseline: 100, indexed: true })).toBe('100.00');
    });

    it('paneAxisTicks: price mode returns round prices; percent mode returns %-labels in range', () => {
        const scale = { min: 90, max: 110 };
        const price = paneAxisTicks(scale, 300);
        expect(price.length).toBeGreaterThan(0);
        for (const t of price) {
            expect(t.label).not.toMatch(/%/); // numeric, no % sign
            expect(Number(t.label)).toBeCloseTo(t.price);
        }

        const pct = paneAxisTicks(scale, 300, { baseline: 100, indexed: false });
        expect(pct.length).toBeGreaterThan(0);
        for (const t of pct) {
            expect(t.label).toMatch(/%$/);
            expect(t.price).toBeGreaterThanOrEqual(90 - 1e-9);
            expect(t.price).toBeLessThanOrEqual(110 + 1e-9);
        }
    });

    it('percent ticks map back to price via the baseline (affine)', () => {
        const t = paneAxisTicks({ min: 95, max: 105 }, 300, { baseline: 100, indexed: false }).find((x) => x.label === '+0.00%');
        expect(t).toBeDefined();
        expect(t!.price).toBeCloseTo(100); // 0% ⇒ baseline price
    });

    it('indexed-to-100 ticks are plain numbers centered on 100 at the baseline', () => {
        const ticks = paneAxisTicks({ min: 95, max: 105 }, 300, { baseline: 100, indexed: true });
        expect(ticks.length).toBeGreaterThan(0);
        for (const t of ticks) {
            expect(t.label).not.toMatch(/%/); // plain number, no % sign
            expect(t.price).toBeGreaterThanOrEqual(95 - 1e-9);
            expect(t.price).toBeLessThanOrEqual(105 + 1e-9);
            // index/price stay affine through the baseline: price = baseline * idx / 100
            expect(t.price).toBeCloseTo(Number(t.label));
        }
        const at100 = ticks.find((x) => x.label === '100.00');
        expect(at100).toBeDefined();
        expect(at100!.price).toBeCloseTo(100); // 100 ⇒ baseline price
    });
});

describe('timezone helpers (item 14d)', () => {
    it('UTC offset is zero', () => {
        expect(tzOffsetMs(Date.UTC(2024, 0, 15, 12), 'UTC')).toBe(0);
        expect(tzOffsetMs(Date.UTC(2024, 0, 15, 12), '')).toBe(0);
    });

    it('America/New_York is -5h in winter (EST), -4h in summer (EDT)', () => {
        const H = 3600000;
        expect(tzOffsetMs(Date.UTC(2024, 0, 15, 12), 'America/New_York')).toBe(-5 * H);
        expect(tzOffsetMs(Date.UTC(2024, 6, 15, 12), 'America/New_York')).toBe(-4 * H);
    });

    it('zonedDate reads local wall-clock via getUTC* accessors', () => {
        const d = zonedDate(Date.UTC(2024, 0, 15, 12), 'America/New_York'); // 12:00Z → 07:00 EST
        expect(d.getUTCHours()).toBe(7);
        expect(d.getUTCDate()).toBe(15);
    });

    it('timeTicks with offset=0 matches plain UTC alignment', () => {
        const from = Date.UTC(2024, 0, 1);
        const to = Date.UTC(2024, 0, 3);
        const a = timeTicks(from, to, 8);
        const b = timeTicks(from, to, 8, 0);
        expect(b).toEqual(a);
    });

    it('timeTicks offset shifts the real tick time so labels align to local midnight', () => {
        const from = Date.UTC(2024, 0, 1);
        const to = Date.UTC(2024, 0, 4);
        const H = 3600000;
        const utc = timeTicks(from, to, 4, 0);
        const ny = timeTicks(from, to, 4, -5 * H);
        // Day-step ticks align to local midnight: in NY (EST) that is 05:00Z, not 00:00Z.
        const nyDay = ny.find((t) => /[A-Z][a-z]{2} \d/.test(t.label));
        expect(nyDay).toBeDefined();
        expect(((nyDay!.time % (24 * H)) + 24 * H) % (24 * H)).toBe(5 * H);
        // UTC day ticks land on 00:00Z.
        const utcDay = utc.find((t) => /[A-Z][a-z]{2} \d/.test(t.label));
        expect(utcDay).toBeDefined();
        expect(((utcDay!.time % (24 * H)) + 24 * H) % (24 * H)).toBe(0);
    });
});

describe('keyboard key→action mapping (item 11)', () => {
    it('arrows step the crosshair; shift pans a chunk', () => {
        expect(keyToAction({ key: 'ArrowLeft', shiftKey: false })).toEqual({ kind: 'step', delta: -1 });
        expect(keyToAction({ key: 'ArrowRight', shiftKey: false })).toEqual({ kind: 'step', delta: 1 });
        expect(keyToAction({ key: 'ArrowLeft', shiftKey: true })).toEqual({ kind: 'pan', bars: -10 });
        expect(keyToAction({ key: 'ArrowRight', shiftKey: true })).toEqual({ kind: 'pan', bars: 10 });
    });

    it('Alt+Shift+Right jumps back to the most recent bars', () => {
        expect(keyToAction({ key: 'ArrowRight', shiftKey: true, altKey: true })).toEqual({ kind: 'realtime' });
        // Alt alone (no Shift) is not the realtime shortcut — plain step still wins.
        expect(keyToAction({ key: 'ArrowRight', shiftKey: false, altKey: true })).toEqual({ kind: 'step', delta: 1 });
    });

    it('plus/minus zoom, Home/End jump, 0 resets, Escape clears', () => {
        expect(keyToAction({ key: '+', shiftKey: false })).toEqual({ kind: 'zoom', direction: 1 });
        expect(keyToAction({ key: '=', shiftKey: false })).toEqual({ kind: 'zoom', direction: 1 });
        expect(keyToAction({ key: '-', shiftKey: false })).toEqual({ kind: 'zoom', direction: -1 });
        expect(keyToAction({ key: 'Home', shiftKey: false })).toEqual({ kind: 'edge', edge: 'first' });
        expect(keyToAction({ key: 'End', shiftKey: false })).toEqual({ kind: 'edge', edge: 'last' });
        expect(keyToAction({ key: '0', shiftKey: false })).toEqual({ kind: 'reset' });
        expect(keyToAction({ key: 'Escape', shiftKey: false })).toEqual({ kind: 'clear' });
    });

    it('ignores keys the chart does not own', () => {
        expect(keyToAction({ key: 'a', shiftKey: false })).toBeNull();
        expect(keyToAction({ key: 'Enter', shiftKey: false })).toBeNull();
    });
});

describe('NativeRenderer new feature defaults + setters (items 9, 11, 14)', () => {
    it('exposes the new features with sensible defaults', () => {
        const r = new NativeRenderer();
        for (const f of ['highlights', 'gridlines', 'axisLabels', 'scaleMode', 'timezone', 'keyboard']) {
            expect(r.features).toContain(f);
        }
        expect(r.readFeature('gridlines')).toBe(true);
        expect(r.readFeature('axisLabels')).toBe(true);
        expect(r.readFeature('scaleMode')).toBe('price');
        expect(r.readFeature('timezone')).toBe('UTC');
        expect(r.readFeature('keyboard')).toBe(true);
        expect(r.readFeature('highlights')).toEqual([]);
    });

    it('scaleMode/timezone/toggles are settable without a mount', () => {
        const r = new NativeRenderer();
        r.applyFeature('scaleMode', 'percent');
        expect(r.readFeature('scaleMode')).toBe('percent');
        r.applyFeature('scaleMode', 'price');
        expect(r.readFeature('scaleMode')).toBe('price');
        r.applyFeature('timezone', 'America/New_York');
        expect(r.readFeature('timezone')).toBe('America/New_York');
        r.applyFeature('gridlines', false);
        expect(r.readFeature('gridlines')).toBe(false);
    });

    it('highlights are sanitized: bad entries dropped, sorted by from, default color applied', () => {
        const r = new NativeRenderer();
        r.applyFeature('highlights', [
            { from: 300, to: 400, color: '#abc' },
            { from: 100, to: 200 }, // no color → default
            { from: 500, to: 500 }, // zero-width → dropped
            { from: 'x', to: 10 }, // non-finite → dropped
            null,
        ]);
        const hs = r.readFeature('highlights') as Array<{ from: number; to: number; color: string }>;
        expect(hs.map((h) => h.from)).toEqual([100, 300]);
        expect(hs[0]!.color).toMatch(/rgba\(/); // default fill
        expect(hs[1]!.color).toBe('#abc');
    });
});
