import { PatternDrawing } from './PatternDrawing';

/**
 * Head & shoulders — 7 points (start, left shoulder, trough, head, trough, right shoulder,
 * end) with the three peaks labelled and an extended neckline through the two troughs.
 */
export class HeadShoulders extends PatternDrawing {
    readonly type = 'headshoulders' as const;

    vertexLabels(): readonly string[] {
        return ['', 'LS', '', 'H', '', 'RS', ''];
    }

    override necklineIndices(): readonly [number, number] {
        return [2, 4]; // the two troughs flanking the head
    }
}
