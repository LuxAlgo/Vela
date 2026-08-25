// Indicator drawings following the object tree (src/renderers/native/drawings/
// IndicatorDrawingSlices.ts): an indicator's Pine drawings prepaint into an interleave
// slice keyed just ABOVE the model's z, so they ride the model's row through the pane
// stack — under the candles when the row sits under the candles. The painted result is
// exercised in the browser; the keying + merge rules are the unit-testable part.
import { describe, it, expect } from 'vitest';
import { indicatorSliceKey, mergeSlices } from '../src/renderers/native/drawings/IndicatorDrawingSlices';
import { sliceKeyFor } from '../src/renderers/native/drawings/UserDrawingController';
import { SceneGraph, type DrawingSlice } from '../src/renderers/native/core/SceneGraph';

const canvas = (tag: string): HTMLCanvasElement => ({ tag }) as unknown as HTMLCanvasElement;

describe('indicatorSliceKey', () => {
    it('a model under the candles keys AT the candle boundary: over its own series, under the candles', () => {
        // Default mount: candles z 0, indicator z -1 → boundaries [-1, 0].
        expect(indicatorSliceKey(-1, [-1, 0])).toBe(0);
    });

    it('a model raised above the candles keys past every boundary: over the whole stack', () => {
        expect(indicatorSliceKey(1, [0, 1])).toBe(Infinity);
    });

    it('a model between two others keys at the next series up', () => {
        expect(indicatorSliceKey(-2, [-2, -1, 0])).toBe(-1);
    });

    it('never keys at the model own z — that would composite the drawings UNDER its own series', () => {
        // sliceKeyFor (user drawings) pins a tie under the series; the indicator key must not.
        expect(sliceKeyFor(-1, [-1, 0])).toBe(-1);
        expect(indicatorSliceKey(-1, [-1, 0])).toBeGreaterThan(-1);
    });

    it('follows a reorder end to end through SceneGraph z keys', () => {
        const scene = new SceneGraph();
        scene.candleZ = 0;
        scene.assignIndicatorZ('pine'); // mounts at the bottom: z -1
        const below = indicatorSliceKey(scene.zOf('pine'), [scene.zOf('pine'), scene.candleZ].sort((a, b) => a - b));
        expect(below).toBe(scene.candleZ); // drawings composite under the candles
        scene.bringIndicatorToFront('pine'); // the object tree drags the row above Candles
        const above = indicatorSliceKey(scene.zOf('pine'), [scene.zOf('pine'), scene.candleZ].sort((a, b) => a - b));
        expect(above).toBe(Infinity); // drawings composite over the whole stack
    });
});

describe('mergeSlices', () => {
    it('merges both sources per pane, sorted by beforeZ', () => {
        const ind = new Map<string, DrawingSlice[]>([['price', [{ beforeZ: 5, canvas: canvas('i5') }]]]);
        const usr = new Map<string, DrawingSlice[]>([['price', [{ beforeZ: 0, canvas: canvas('u0') }]]]);
        const merged = mergeSlices(ind, usr).get('price')!;
        expect(merged.map((s) => s.beforeZ)).toEqual([0, 5]);
    });

    it('on a shared key the indicator slice composites first (user drawings stay on top)', () => {
        const ind = new Map<string, DrawingSlice[]>([['price', [{ beforeZ: 0, canvas: canvas('ind') }]]]);
        const usr = new Map<string, DrawingSlice[]>([['price', [{ beforeZ: 0, canvas: canvas('usr') }]]]);
        const merged = mergeSlices(ind, usr).get('price')!;
        expect(merged.map((s) => (s.canvas as unknown as { tag: string }).tag)).toEqual(['ind', 'usr']);
    });

    it('keeps panes that only one source contributes to', () => {
        const ind = new Map<string, DrawingSlice[]>([['study-1', [{ beforeZ: -2, canvas: canvas('i') }]]]);
        const usr = new Map<string, DrawingSlice[]>([['price', [{ beforeZ: 1, canvas: canvas('u') }]]]);
        const merged = mergeSlices(ind, usr);
        expect(merged.get('study-1')!.length).toBe(1);
        expect(merged.get('price')!.length).toBe(1);
    });
});
