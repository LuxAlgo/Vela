import { PatternDrawing } from './PatternDrawing';

/** Harmonic XABCD pattern — 5 points, leg ratios + a tinted body (Gartley / Bat / Crab / …). */
export class XABCD extends PatternDrawing {
    readonly type = 'xabcd' as const;

    vertexLabels(): readonly string[] {
        return ['X', 'A', 'B', 'C', 'D'];
    }

    override legRatios(): boolean {
        return true;
    }

    override fillTriangles(): ReadonlyArray<readonly [number, number, number]> {
        return [
            [0, 1, 2],
            [2, 3, 4],
        ];
    }
}
