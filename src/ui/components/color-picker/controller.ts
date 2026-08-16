// Color-picker CONTROLLER — color math only. No DOM.

import { ACCENT_BRIGHT } from '../../../core/palette';

/** Split a color into its `#RRGGBB` part + alpha 0..1 (handles `#RGB`, `#RRGGBB(AA)`, `rgba()`). */
export function splitColor(color: string): { hex6: string; alpha: number } {
    const s = String(color ?? '').trim();
    let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (m) return { hex6: `#${m[1]!.toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1]!.toLowerCase();
        return { hex6: `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`, alpha: 1 };
    }
    const rgba = /^rgba?\(([^)]+)\)/i.exec(s);
    if (rgba) {
        const p = rgba[1]!.split(',').map((v) => v.trim());
        const hx = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        const a = p[3] != null ? Math.max(0, Math.min(1, parseFloat(p[3]))) : 1;
        return { hex6: `#${hx(parseInt(p[0] ?? '0', 10))}${hx(parseInt(p[1] ?? '0', 10))}${hx(parseInt(p[2] ?? '0', 10))}`, alpha: a };
    }
    return { hex6: ACCENT_BRIGHT, alpha: 1 };
}

/** Combine a `#RRGGBB` + alpha into `#RRGGBB` (opaque) or `#RRGGBBAA`. */
export function combineColor(hex6: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    if (a >= 0.999) return hex6;
    return `${hex6}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

/** Composite `fg` over `bg` at `alpha`, returning an opaque `#rrggbb`. */
export function blendOver(fg: string, bg: string, alpha: number): string {
    const rgb = (c: string): [number, number, number] => {
        const n = parseInt(splitColor(c).hex6.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [fr, fgc, fb] = rgb(fg);
    const [br, bgc, bb] = rgb(bg);
    const a = Math.max(0, Math.min(1, alpha));
    const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(fr * a + br * (1 - a))}${h(fgc * a + bgc * (1 - a))}${h(fb * a + bb * (1 - a))}`;
}

/** HSL (h 0-360, s/l 0-100) → `#rrggbb`. */
export function hslHex(h: number, s: number, l: number): string {
    const sn = s / 100;
    const ln = l / 100;
    const k = (n: number): number => (n + h / 30) % 12;
    const a = sn * Math.min(ln, 1 - ln);
    const f = (n: number): number => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** A swatch palette: a grayscale row, then hue columns × shade rows. */
export function buildPalette(): string[][] {
    const grays = [100, 90, 80, 68, 56, 45, 35, 25, 14, 0].map((l) => hslHex(0, 0, l));
    const hues = [4, 28, 50, 96, 140, 174, 200, 224, 270, 322];
    const levels: Array<[number, number]> = [
        [82, 56],
        [58, 84],
        [62, 74],
        [66, 62],
        [70, 50],
        [64, 39],
        [54, 29],
    ];
    return [grays, ...levels.map(([s, l]) => hues.map((h) => hslHex(h, s, l)))];
}

/** The alpha checkerboard laid under translucent colors. Its grays are fixed on purpose:
 *  it stands for "nothing here", so it must not shift with the theme. */
export function transparencyChecker(size: number): string {
    return `repeating-conic-gradient(#9aa0a6 0% 25%, #d3d6da 0% 50%) 0 0 / ${size}px ${size}px`; // palette-exempt: these grays stand for transparency itself
}

export type ColorFieldShape = 'square' | 'circle';

export interface ColorPickerControllerOptions {
    color?: string;
    onChange?: (value: string) => void;
}

export interface ColorPickerController {
    hex6: string;
    alpha: number;
    combined(): string;
    setHex(hex: string): void;
    setAlpha(a: number): void;
}

export function colorPickerController(opts: ColorPickerControllerOptions = {}): ColorPickerController {
    const parsed = splitColor(opts.color ?? ACCENT_BRIGHT);
    let hex6 = parsed.hex6;
    let alpha = parsed.alpha;
    return {
        get hex6() { return hex6; },
        get alpha() { return alpha; },
        combined() { return combineColor(hex6, alpha); },
        setHex(hex: string) { hex6 = splitColor(hex).hex6; },
        setAlpha(a: number) { alpha = Math.max(0, Math.min(1, a)); },
    };
}
