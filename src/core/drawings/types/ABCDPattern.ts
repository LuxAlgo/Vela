import { PatternDrawing } from './PatternDrawing';

/** ABCD pattern — 4 points with the BC/AB and CD/BC leg ratios. */
export class ABCDPattern extends PatternDrawing {
    readonly type = 'abcd' as const;

    vertexLabels(): readonly string[] {
        return ['A', 'B', 'C', 'D'];
    }

    override legRatios(): boolean {
        return true;
    }
}
