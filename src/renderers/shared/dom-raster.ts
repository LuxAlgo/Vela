// Best-effort SYNCHRONOUS rasterization of DOM chrome overlays for the PNG export —
// the indicator legend, a host status line, the symbol watermark. Screenshot export is
// a synchronous port (`screenshot(): string | null`), so a full HTML renderer is out of
// reach; what a chart overlay actually carries is text on (rounded) color chips, and
// that subset rasterizes faithfully with plain canvas calls:
//   - element backgrounds and borders (border-radius honored, '50%' reads as a circle),
//   - text nodes in their computed font/color, at their measured on-screen rects,
//   - already-loaded <img>s (clipped by their radius) — but only when drawing them
//     leaves the canvas untainted: a cross-origin ticker icon must not poison the
//     whole export (`toDataURL` would throw at the end),
//   - inline SVG icons, through the geometry subset the icon registry actually uses
//     (path / circle / rect / line / polyline / polygon, fill + stroke from computed
//     style, so `currentColor` and inheritance resolve for free). Elements carrying a
//     `transform` are skipped — honest absence beats a wrongly placed glyph.

/** How the overlay's viewport coordinates map onto the export canvas. */
export interface OverlayRasterFrame {
    /** The canvas' top-left in viewport coordinates (the plot's bounding rect). */
    left: number;
    top: number;
    /** Device-pixel ratio of the export canvas (canvas px per CSS px). */
    dpr: number;
}

/** True when a computed color actually puts ink down (not transparent). */
function hasInk(color: string): boolean {
    if (!color || color === 'transparent') return false;
    const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(color);
    return m ? parseFloat(m[1]!) > 0.001 : true;
}

/** Uniform corner radius in px — '50%' (and any percentage) resolves against the box. */
function cornerRadius(cs: CSSStyleDeclaration, w: number, h: number): number {
    const raw = cs.borderTopLeftRadius;
    const v = parseFloat(raw) || 0;
    const px = raw.endsWith('%') ? (v / 100) * Math.min(w, h) : v;
    return Math.max(0, Math.min(px, Math.min(w, h) / 2));
}

/** Trace a rounded rect (falls back to a plain rect where roundRect is missing). */
function tracePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
}

/** Probe-draw on a throwaway canvas: a cross-origin image without CORS taints whatever
 *  it lands on, and `toDataURL` then throws for the WHOLE export — test it in isolation. */
function canDrawUntainted(img: HTMLImageElement): boolean {
    try {
        const probe = img.ownerDocument.createElement('canvas');
        probe.width = 1;
        probe.height = 1;
        const ctx = probe.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0, 1, 1);
        probe.toDataURL();
        return true;
    } catch {
        return false;
    }
}

/**
 * Draw `root`'s subtree onto `ctx`. Coordinates come from live layout
 * (`getBoundingClientRect`), so what lands on the canvas is what is on screen —
 * hidden segments (`display:none`), folded legend rows and zero-size boxes are
 * skipped, and subtree opacity multiplies down (the 5%-alpha watermark stays 5%).
 */
export function rasterizeOverlay(ctx: CanvasRenderingContext2D, root: Element, frame: OverlayRasterFrame): void {
    const win = root.ownerDocument.defaultView;
    if (!win) return;
    ctx.save();
    ctx.scale(frame.dpr, frame.dpr);

    const drawText = (node: Text, cs: CSSStyleDeclaration, alpha: number): void => {
        const text = node.textContent?.replace(/\s+/g, ' ').trim();
        if (!text) return;
        const range = node.ownerDocument.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = cs.color;
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, r.left - frame.left, r.top - frame.top + r.height / 2);
    };

    const drawImg = (img: HTMLImageElement, cs: CSSStyleDeclaration, alpha: number): void => {
        if (!img.complete || img.naturalWidth <= 0 || !canDrawUntainted(img)) return;
        const r = img.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const x = r.left - frame.left;
        const y = r.top - frame.top;
        ctx.save();
        ctx.globalAlpha = alpha;
        tracePath(ctx, x, y, r.width, r.height, cornerRadius(cs, r.width, r.height));
        ctx.clip();
        ctx.drawImage(img, x, y, r.width, r.height);
        ctx.restore();
    };

    const drawSvgShapes = (parent: Element, alpha: number): void => {
        for (const el of parent.children) {
            if (el.hasAttribute('transform')) continue;
            const tag = el.tagName.toLowerCase();
            if (tag === 'g') {
                drawSvgShapes(el, alpha);
                continue;
            }
            const num = (name: string): number => parseFloat(el.getAttribute(name) ?? '0') || 0;
            let path: Path2D | null = null;
            if (tag === 'path') {
                const d = el.getAttribute('d');
                if (d) path = new Path2D(d);
            } else if (tag === 'circle') {
                path = new Path2D();
                path.arc(num('cx'), num('cy'), num('r'), 0, Math.PI * 2);
            } else if (tag === 'ellipse') {
                path = new Path2D();
                path.ellipse(num('cx'), num('cy'), num('rx'), num('ry'), 0, 0, Math.PI * 2);
            } else if (tag === 'rect') {
                path = new Path2D();
                path.rect(num('x'), num('y'), num('width'), num('height'));
            } else if (tag === 'line') {
                path = new Path2D();
                path.moveTo(num('x1'), num('y1'));
                path.lineTo(num('x2'), num('y2'));
            } else if (tag === 'polyline' || tag === 'polygon') {
                const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
                if (pts.length < 4 || pts.some(Number.isNaN)) continue;
                path = new Path2D();
                path.moveTo(pts[0]!, pts[1]!);
                for (let i = 2; i + 1 < pts.length; i += 2) path.lineTo(pts[i]!, pts[i + 1]!);
                if (tag === 'polygon') path.closePath();
            }
            if (!path) continue;
            const cs = win.getComputedStyle(el);
            if (cs.fill && cs.fill !== 'none' && hasInk(cs.fill)) {
                ctx.globalAlpha = alpha * (parseFloat(cs.fillOpacity) || 1);
                ctx.fillStyle = cs.fill;
                ctx.fill(path);
            }
            const sw = parseFloat(cs.strokeWidth) || 0;
            if (cs.stroke && cs.stroke !== 'none' && hasInk(cs.stroke) && sw > 0) {
                ctx.globalAlpha = alpha * (parseFloat(cs.strokeOpacity) || 1);
                ctx.strokeStyle = cs.stroke;
                ctx.lineWidth = sw;
                if (cs.strokeLinecap === 'round' || cs.strokeLinecap === 'square' || cs.strokeLinecap === 'butt') ctx.lineCap = cs.strokeLinecap;
                if (cs.strokeLinejoin === 'round' || cs.strokeLinejoin === 'bevel' || cs.strokeLinejoin === 'miter') ctx.lineJoin = cs.strokeLinejoin;
                ctx.stroke(path);
            }
        }
    };

    const drawSvg = (svg: SVGSVGElement, parentAlpha: number): void => {
        const r = svg.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        const cs = win.getComputedStyle(svg);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const alpha = parentAlpha * (parseFloat(cs.opacity) || 1);
        if (alpha <= 0.001) return;
        const vb = svg.viewBox.baseVal;
        const vw = vb && vb.width > 0 ? vb.width : r.width;
        const vh = vb && vb.height > 0 ? vb.height : r.height;
        ctx.save();
        ctx.translate(r.left - frame.left, r.top - frame.top);
        ctx.scale(r.width / vw, r.height / vh);
        if (vb) ctx.translate(-vb.x, -vb.y);
        drawSvgShapes(svg, alpha);
        ctx.restore();
    };

    const drawElement = (el: HTMLElement, parentAlpha: number): void => {
        const cs = win.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const alpha = parentAlpha * (parseFloat(cs.opacity) || 1);
        if (alpha <= 0.001) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            const x = r.left - frame.left;
            const y = r.top - frame.top;
            const radius = cornerRadius(cs, r.width, r.height);
            if (hasInk(cs.backgroundColor)) {
                ctx.globalAlpha = alpha;
                ctx.fillStyle = cs.backgroundColor;
                tracePath(ctx, x, y, r.width, r.height, radius);
                ctx.fill();
            }
            const bw = parseFloat(cs.borderTopWidth) || 0;
            if (bw > 0 && cs.borderTopStyle !== 'none' && hasInk(cs.borderTopColor)) {
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = cs.borderTopColor;
                ctx.lineWidth = bw;
                tracePath(ctx, x + bw / 2, y + bw / 2, r.width - bw, r.height - bw, Math.max(0, radius - bw / 2));
                ctx.stroke();
            }
        }
        for (const child of el.childNodes) {
            if (child.nodeType === 3) drawText(child as Text, cs, alpha);
            else if (child instanceof win.HTMLImageElement) drawImg(child, win.getComputedStyle(child), alpha);
            else if (child instanceof win.SVGSVGElement) drawSvg(child, alpha);
            else if (child instanceof win.HTMLElement) drawElement(child, alpha);
        }
    };

    if (root instanceof win.HTMLElement) drawElement(root, 1);
    ctx.restore();
}
