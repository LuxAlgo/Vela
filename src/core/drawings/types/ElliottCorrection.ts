import { PatternDrawing } from './PatternDrawing';

/** Elliott corrective wave — a 3-point polyline labelled A–C. */
export class ElliottCorrection extends PatternDrawing {
    readonly type = 'elliottcorrection' as const;

    vertexLabels(): readonly string[] {
        return ['A', 'B', 'C'];
    }
}
