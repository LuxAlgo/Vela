import { PathDrawing } from './PathDrawing';

/** A connected multi-point polyline that ends in an arrowhead (the painter adds the head). */
export class Path extends PathDrawing {
    readonly type = 'path' as const;
}
