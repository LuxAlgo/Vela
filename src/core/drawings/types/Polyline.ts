import { PathDrawing } from './PathDrawing';

/** A polyline: click each vertex, double-click to finish. Every vertex is an editable handle. */
export class Polyline extends PathDrawing {
    readonly type = 'polyline' as const;
}
