// The Fibonacci retracement's ready-made level sets (Classic, Extension, OTE) and how its levels
// show: every set keeps the whole ladder of levels, its unused ones off, and sets which end of
// the swing level 0 sits on.
import { describe, it, expect } from 'vitest';
import { createDrawing, FIB_PRESETS, matchFibPreset, type FibLevels, type FibRetracement, type Projector } from '../src/core/drawings';

/** x = time, y = 200 − price, 300 × 200 px. */
const proj: Projector = {
    xOf: (t) => t,
    yOf: (price, paneId) => (paneId === 'price' ? 200 - price : null),
    pxToPoint: (x, y) => ({ time: x, price: 200 - y }),
    paneIdAtY: () => 'price',
    width: 300,
    height: 200,
};

/** A retracement drawn from a swing low (100) to a swing high (150). */
function fib(): FibRetracement {
    return createDrawing('fibretracement', {
        id: 'f',
        paneId: 'price',
        anchors: [
            { time: 50, price: 100 },
            { time: 150, price: 150 },
        ],
    }) as FibRetracement;
}

function usePreset(d: FibRetracement, key: string): void {
    const p = FIB_PRESETS.find((x) => x.key === key)!;
    d.applySettings({ levels: structuredClone(p.levels), reverse: p.reverse });
}

const priceOf = (d: FibLevels, ratio: number): number | undefined => d.levelLines(proj)!.find((l) => l.ratio === ratio)?.price;

describe('ready-made fib level sets', () => {
    it('the sets are Classic, Extension and OTE, in that order', () => {
        expect(FIB_PRESETS.map((p) => p.label)).toEqual(['Classic', 'Extension', 'OTE']);
    });

    it('a new retracement starts on Classic: the standard pullback levels from the swing high', () => {
        const d = fib();
        expect(matchFibPreset(d.levels, d.reverse)).toBe('classic');
        expect(d.levels.filter((l) => l.enabled).map((l) => l.ratio)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]);
        expect(priceOf(d, 0)).toBe(150);
        expect(priceOf(d, 0.5)).toBe(125);
        expect(priceOf(d, 1)).toBe(100);
    });

    it('every set keeps a long ladder of levels, the unused ones present but off', () => {
        for (const p of FIB_PRESETS) {
            expect(p.levels.length, p.key).toBeGreaterThanOrEqual(24);
            expect(p.levels.some((l) => !l.enabled), p.key).toBe(true);
        }
    });

    it('Extension projects targets beyond the swing high, measured from the swing low', () => {
        const d = fib();
        usePreset(d, 'extension');
        expect(d.reverse).toBe(true);
        expect(priceOf(d, 0)).toBe(100);
        expect(priceOf(d, 1)).toBe(150);
        expect(priceOf(d, 1.618)).toBeCloseTo(180.9);
        expect(priceOf(d, 2.618)).toBeCloseTo(230.9);
    });

    it('OTE marks the 0.62–0.79 entry zone below the swing high, equilibrium at 0.5, and targets above it', () => {
        const d = fib();
        usePreset(d, 'ote');
        expect(d.levels.filter((l) => l.enabled).map((l) => l.ratio).sort((a, b) => a - b)).toEqual([-0.62, -0.27, 0, 0.5, 0.62, 0.705, 0.79, 1]);
        expect(priceOf(d, 0.5)).toBe(125);
        expect(priceOf(d, 0.705)).toBeCloseTo(114.75);
        expect(priceOf(d, -0.27)).toBeCloseTo(163.5);
        expect(priceOf(d, -0.62)).toBeCloseTo(181);
        // The entry zone reads as one band.
        const zone = d.levels.filter((l) => [0.62, 0.705, 0.79].includes(l.ratio)).map((l) => l.color);
        expect(new Set(zone).size).toBe(1);
    });

    it('editing a level makes the set your own; choosing a set again puts it back', () => {
        const d = fib();
        d.applySettings({ 'levels.5.enabled': true });
        expect(matchFibPreset(d.levels, d.reverse)).toBeNull();
        usePreset(d, 'classic');
        expect(matchFibPreset(d.levels, d.reverse)).toBe('classic');
    });

    it('a retracement saved before the longer ladder keeps its own levels', () => {
        const d = createDrawing('fibretracement', {
            paneId: 'price',
            anchors: [
                { time: 50, price: 100 },
                { time: 150, price: 150 },
            ],
            props: { levels: [{ ratio: 0.5, color: '#123456', enabled: true }], reverse: false },
        }) as FibRetracement;
        expect(d.levels).toEqual([{ ratio: 0.5, color: '#123456', enabled: true }]);
    });
});

describe('how fib levels show', () => {
    it('each level reads its ratio and price; either can be turned off', () => {
        const d = fib();
        const text = (): string | undefined => d.entryLines(proj)!.find((l) => l.y1 === 200 - 125)?.numberText;
        expect(text()).toBe('0.5 (125.00)');
        d.applySettings({ showPrices: false });
        expect(text()).toBe('0.5');
        d.applySettings({ showPrices: true, showRatios: false });
        expect(text()).toBe('125.00');
        d.applySettings({ showPrices: false });
        expect(text()).toBe('');
    });

    it('the level text can sit on the right end of the levels', () => {
        const d = fib();
        d.applySettings({ labelSide: 'right' });
        const l = d.entryLines(proj)![0]!;
        expect(l.numberAlign).toBe('right');
        expect(l.numberX).toBe(150 - 4);
    });

    it('levels can extend to the chart edge, and stay clickable there', () => {
        const d = fib();
        expect(d.hitTest(250, 200 - 125, proj, 3)).toBe(false);
        d.applySettings({ 'style.extendRight': true });
        expect(d.levelLines(proj)![0]!.x2).toBe(300);
        expect(d.hitTest(250, 200 - 125, proj, 3)).toBe(true);
        d.applySettings({ 'style.extendLeft': true });
        expect(d.levelLines(proj)![0]!.x1).toBe(0);
    });

    it('the background between levels can be turned off', () => {
        const d = fib();
        expect(d.fillBands(proj).length).toBeGreaterThan(0);
        d.applySettings({ background: false });
        expect(d.fillBands(proj)).toEqual([]);
    });

    it('bands join neighbouring levels by ratio, whatever order the list is in', () => {
        const d = fib();
        usePreset(d, 'ote'); // targets are listed after the retracement levels
        const bands = d.fillBands(proj);
        const tallest = Math.max(...bands.map((b) => b.h));
        expect(tallest).toBeLessThanOrEqual(25); // no band spans the whole drawing
    });

    it('the display settings survive a save and a restore', () => {
        const d = fib();
        d.applySettings({ showRatios: false, labelSide: 'right', background: false });
        const back = createDrawing('fibretracement', { ...d.serialize(), paneId: 'price' }) as FibRetracement;
        expect([back.showRatios, back.labelSide, back.background]).toEqual([false, 'right', false]);
    });
});
