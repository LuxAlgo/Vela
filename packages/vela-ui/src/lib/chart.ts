// What the kit's SVG charts share: round axis steps, a value axis with zero on a tick, compact
// numbers, and the hover tip that sits beside the point it reads.

/** A round step for `range` in about `ticks` steps: 1, 2 or 5 times a power of ten. */
export function niceStep(range: number, ticks: number): number {
    const raw = range / Math.max(1, ticks);
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/**
 * A value axis spanning `lo..hi` in about `count` round steps: its bounds widened to whole
 * steps, and its ticks from bound to bound with zero among them. One step serves both, so no
 * tick falls outside the plot.
 */
export function valueAxis(lo: number, hi: number, count: number): { min: number; max: number; step: number; ticks: number[] } {
    const step = niceStep(hi - lo || 1, count);
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step || step;
    const n = Math.round((max - min) / step);
    // Stepped by index, rounded to the step's precision: no float drift, and zero lands exactly.
    const digits = Math.max(0, -Math.floor(Math.log10(step)) + 2);
    const ticks = Array.from({ length: n + 1 }, (_, i) => Number((min + i * step).toFixed(digits)) || 0);
    return { min, max, step, ticks };
}

/** `1.2k`, `-3.4M`, `0.25`. */
export function compactNumber(v: number): string {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e6) return `${sign}${+(a / 1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${sign}${+(a / 1e3).toFixed(1)}k`;
    return `${sign}${+a.toFixed(2)}`;
}

export function escapeXml(s: string): string {
    return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

/** Fill the tip with a readout and place it beside the point at (x, y), inside the box. */
export function showTip(tip: HTMLElement, content: string | Node, box: { w: number; h: number }, x: number, y: number): void {
    const wasHidden = tip.hidden;
    if (typeof content === 'string') tip.textContent = content;
    else tip.replaceChildren(content);
    tip.hidden = false;
    // A tip that was hidden appears in place instead of gliding from where it last was.
    tip.toggleAttribute('data-instant', wasHidden);
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const GAP = 16;
    const left = x + GAP + tw <= box.w ? x + GAP : Math.max(0, x - GAP - tw);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(0, Math.min(box.h - th, y - th / 2)))}px`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A chart's root (sized by its parent), its SVG and its tip, redrawn as the root resizes. */
export function chartFrame(rootSlot: string, tipSlot: string, className: string | undefined, draw: () => void): { el: HTMLElement; svg: SVGSVGElement; tip: HTMLElement; disconnect(): void } {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const tip = document.createElement('div');
    tip.dataset.slot = tipSlot;
    tip.hidden = true;
    const el = document.createElement('div');
    el.dataset.slot = rootSlot;
    if (className) el.className = className;
    el.append(svg, tip);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
    ro?.observe(el);
    return { el, svg, tip, disconnect: () => ro?.disconnect() };
}
