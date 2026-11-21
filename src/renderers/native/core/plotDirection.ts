// The plot never mirrors: time runs left to right and the price scale stays on the right in
// a page of either direction, so the text painted in chart coordinates (axis labels,
// crosshair chips, script labels and tables, drawing text, marks) reads left to right too.
// A 2D context's `direction` defaults to 'inherit', which follows the page: inside a
// right-to-left page the bidi algorithm would carry a number's sign or percent sign to its
// far end ("7.14%-") and `textAlign: 'start'` would anchor text on its right.

/**
 * Pin a plot canvas to left to right. The attribute reaches every context opened on the
 * canvas, an SDK renderer layer's own included, and outlives the state reset a resize
 * causes. It leaves the DOM chrome over the plot (legend, popups) following the page.
 */
export function pinPlotCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    canvas.dir = 'ltr';
    return canvas;
}

/**
 * Start a frame on a plot canvas: the device-pixel transform, and left-to-right text. A
 * resize resets a context's state, `direction` included, so every frame sets it again
 * rather than once at mount; this also covers the detached drawing-slice canvases, which
 * carry no `dir` of their own.
 */
export function beginPlotFrame(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.direction = 'ltr';
}
