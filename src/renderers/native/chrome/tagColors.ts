// Colors for the indicator tags on the price scale: any CSS color a plot carries, read as
// channels so its chips can be tinted and their text kept readable on any chart background.
import { parseColor } from '../backend/gl/color';

/** Red, green, blue and alpha, each 0–1. */
export type Rgba = readonly [number, number, number, number];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** An alpha written as `0.5` or `50%`. */
const alphaOf = (v: string | undefined): number => (v === undefined ? 1 : clamp01(v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const hue = (((h % 360) + 360) % 360) / 360;
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t0: number): number => {
        const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
}

/**
 * The channels of any CSS color. Hex, `rgb()`/`rgba()`, `hsl()`/`hsla()` and `transparent`
 * are read here; every other form (named colors, `color()`, the space-separated syntax) goes
 * through the canvas, which knows them all.
 */
export function cssRgba(css: string): Rgba {
    const s = css.trim().toLowerCase();
    if (s === 'transparent') return [0, 0, 0, 0];
    const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
    if (hex) {
        let h = hex[1]!;
        if (h.length <= 4) h = [...h].map((c) => c + c).join('');
        const byte = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
        return [byte(0), byte(2), byte(4), h.length === 8 ? byte(6) : 1];
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (rgb) return [clamp01(+rgb[1]! / 255), clamp01(+rgb[2]! / 255), clamp01(+rgb[3]! / 255), alphaOf(rgb[4])];
    const hsl = /^hsla?\(\s*(-?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+%?)\s*)?\)$/.exec(s);
    if (hsl) return [...hslToRgb(+hsl[1]!, clamp01(+hsl[2]! / 100), clamp01(+hsl[3]! / 100)), alphaOf(hsl[4])];
    return parseColor(css);
}

/** A CSS `rgba()` string for `color`'s channels at `alpha`. */
export function rgbaCss(color: Rgba, alpha: number): string {
    const byte = (v: number): number => Math.round(clamp01(v) * 255);
    return `rgba(${byte(color[0])}, ${byte(color[1])}, ${byte(color[2])}, ${alpha})`;
}

/** `over` laid over `under` at `alpha`, as the opaque color the eye sees. */
export function blend(under: Rgba, over: Rgba, alpha: number): Rgba {
    const mix = (a: number, b: number): number => a * (1 - alpha) + b * alpha;
    return [mix(under[0], over[0]), mix(under[1], over[1]), mix(under[2], over[2]), 1];
}

/** WCAG relative luminance. */
function luminance(c: Rgba): number {
    const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio between two opaque colors (1–21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The contrast small text needs to read comfortably (WCAG AA). */
export const READABLE_CONTRAST = 4.5;

/**
 * Text in `color` that reads on `background`: the color itself when it already reaches
 * {@link READABLE_CONTRAST}, else the same hue moved toward black (on a light background) or
 * white (on a dark one) just far enough to reach it.
 */
export function readableInk(color: Rgba, background: Rgba): Rgba {
    if (contrastRatio(color, background) >= READABLE_CONTRAST) return color;
    const black: Rgba = [0, 0, 0, 1];
    const white: Rgba = [1, 1, 1, 1];
    const toward = contrastRatio(black, background) >= contrastRatio(white, background) ? black : white;
    for (let step = 1; step <= 20; step += 1) {
        const ink = blend(color, toward, step / 20);
        if (contrastRatio(ink, background) >= READABLE_CONTRAST) return ink;
    }
    return toward;
}
