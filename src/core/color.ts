// Color math shared by every layer (core defaults, renderer chrome, UI kit tokens, widget).
// Pure string/number work with no DOM dependency, so it is safe for the headless core.

interface Rgb {
    r: number;
    g: number;
    b: number;
}

/** Parse `#RGB` / `#RRGGBB` / `#RRGGBBAA` / `rgb()` / `rgba()` into 0-255 channels. */
export function parseRgb(color: string): Rgb | null {
    const s = color.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1]!;
        return {
            r: parseInt(h[0]! + h[0]!, 16),
            g: parseInt(h[1]! + h[1]!, 16),
            b: parseInt(h[2]! + h[2]!, 16),
        };
    }
    m = /^#([0-9a-f]{6})[0-9a-f]{0,2}$/i.exec(s);
    if (m) {
        const h = m[1]!;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(s);
    if (rgb) {
        return { r: parseFloat(rgb[1]!), g: parseFloat(rgb[2]!), b: parseFloat(rgb[3]!) };
    }
    return null;
}

/** Apply an alpha to any parseable color → an `rgba(...)` string. Unparseable input is
 *  returned unchanged so callers can pass through `transparent`, `currentColor`, etc. */
export function withAlpha(color: string, alpha: number): string {
    const c = parseRgb(color);
    if (!c) return color;
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Flatten `top` at `alpha` over `base` into an OPAQUE color. Panels and menus float above
 *  the chart, so their surface must not let candles show through — a translucent wash is not
 *  interchangeable with the flattened result here. */
export function mix(base: string, top: string, alpha: number): string {
    const b = parseRgb(base);
    const t = parseRgb(top);
    if (!b || !t) return base;
    const c = (x: number, y: number) => Math.round(x + (y - x) * alpha);
    return `rgb(${c(b.r, t.r)},${c(b.g, t.g)},${c(b.b, t.b)})`;
}

/** `#rrggbb` for any parseable color; `fallback` when it cannot be parsed (native color
 *  inputs only accept six-digit hex). */
export function toHex6(color: string, fallback = '#888888'): string {
    const c = parseRgb(color);
    if (!c) return fallback;
    const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Perceived-dark check (relative luminance below mid-gray). Unparseable input counts as
 *  dark — the dark palette is Vela's default, so it is the safer assumption. */
export function isDarkColor(color: string): boolean {
    const c = parseRgb(color);
    if (!c) return true;
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
}
