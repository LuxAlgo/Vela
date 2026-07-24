import { PatternDrawing } from './PatternDrawing';

/** Elliott impulse wave — a 5-point polyline labelled 1–5. */
export class ElliottImpulse extends PatternDrawing {
    readonly type = 'elliottimpulse' as const;

    vertexLabels(): readonly string[] {
        return ['1', '2', '3', '4', '5'];
    }
}
