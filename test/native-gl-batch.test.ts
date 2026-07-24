import { describe, it, expect } from 'vitest';
import { Batch, type RGBA } from '../src/renderers/native/backend/gl/Batch';

const RED: RGBA = [1, 0, 0, 1];
const BLUE: RGBA = [0, 0, 1, 1];
const STRIDE = 8; // floats per vertex: x, y, r, g, b, a, edgeDist, edgeHalf

describe('native WebGL2 · Batch (triangle geometry)', () => {
    it('emits 6 vertices per rect with the right corners + color (solid-fill sentinel)', () => {
        const b = new Batch(2); // tiny initial capacity → exercises growth
        b.rect(2, 3, 10, 4, RED);
        expect(b.vertexCount).toBe(6);
        const v = b.view;
        expect(v.length).toBe(6 * STRIDE);
        // first vertex = top-left corner (2,3) with RED
        expect([v[0], v[1]]).toEqual([2, 3]);
        expect([v[2], v[3], v[4], v[5]]).toEqual([1, 0, 0, 1]);
        expect(v[7]!).toBeLessThan(0); // edgeHalf < 0 ⇒ solid fill, no edge feathering
        // the rect spans x∈[2,12], y∈[3,7]; every vertex within bounds
        for (let i = 0; i < b.vertexCount; i += 1) {
            const x = v[i * STRIDE]!;
            const y = v[i * STRIDE + 1]!;
            expect(x).toBeGreaterThanOrEqual(2);
            expect(x).toBeLessThanOrEqual(12);
            expect(y).toBeGreaterThanOrEqual(3);
            expect(y).toBeLessThanOrEqual(7);
        }
    });

    it('reset() clears the vertex count but reuses the buffer', () => {
        const b = new Batch();
        b.rect(0, 0, 1, 1, RED);
        b.reset();
        expect(b.vertexCount).toBe(0);
        b.tri(0, 0, RED, 1, 0, RED, 0, 1, RED);
        expect(b.vertexCount).toBe(3);
    });

    it('seg feathers a line into a padded width-w quad (6 verts) with edge attrs, skipping zero-length', () => {
        const b = new Batch();
        b.seg(0, 0, 10, 0, 2, RED); // horizontal, width 2 (half 1), padded by 1 on each side → y∈[-2,2]
        expect(b.vertexCount).toBe(6);
        const v = b.view;
        for (let i = 0; i < 6; i += 1) {
            expect(Math.abs(v[i * STRIDE + 1]!)).toBeCloseTo(2, 9); // padded outer edge (half + AA pad)
            expect(Math.abs(v[i * STRIDE + 6]!)).toBeCloseTo(2, 9); // edgeDist = ±(half + pad)
            expect(v[i * STRIDE + 7]!).toBeCloseTo(1, 9); // edgeHalf = the true half-width
        }
        b.reset();
        b.seg(5, 5, 5, 5, 2, RED); // zero length → nothing
        expect(b.vertexCount).toBe(0);
    });

    it('quad4 carries per-corner colors (gradient via interpolation)', () => {
        const b = new Batch();
        b.quad4(0, 0, RED, 1, 0, RED, 1, 1, BLUE, 0, 1, BLUE);
        expect(b.vertexCount).toBe(6);
        // two distinct colors present across the 6 vertices
        const v = b.view;
        const colors = new Set<string>();
        for (let i = 0; i < 6; i += 1) colors.add(`${v[i * STRIDE + 2]},${v[i * STRIDE + 3]},${v[i * STRIDE + 4]},${v[i * STRIDE + 5]}`);
        expect(colors.has('1,0,0,1')).toBe(true);
        expect(colors.has('0,0,1,1')).toBe(true);
    });

    it('dashedSeg with a pattern emits multiple on-dash quads; solid emits one', () => {
        const solid = new Batch();
        solid.dashedSeg(0, 0, 100, 0, 1, RED, null);
        expect(solid.vertexCount).toBe(6); // one quad

        const dashed = new Batch();
        dashed.dashedSeg(0, 0, 100, 0, 1, RED, [6, 4]); // 100px / 10px period → ~10 dashes
        expect(dashed.vertexCount).toBeGreaterThan(6 * 5);
    });

    it('circle emits a triangle fan (3 verts per segment)', () => {
        const b = new Batch();
        b.circle(0, 0, 5, RED, 16);
        expect(b.vertexCount).toBe(16 * 3);
    });
});
