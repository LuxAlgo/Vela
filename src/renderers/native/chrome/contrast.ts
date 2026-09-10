import { parseColor } from '../backend/gl/color';

/**
 * White or black text for a colored chip (a price tag, a timeline-mark token), biased
 * toward white so saturated brand colors (the default candle green / red sit at
 * L≈0.22–0.24) read as white, while genuinely light colors (a white or pale candle
 * color) still get dark text. Uses relative luminance with a flip point of 0.4 — higher
 * than `readableText`'s WCAG crossover (~0.18) which perceptually over-picks black on
 * mid-tone fills. Translucent `bg` is composited over `over` first so the choice
 * reflects what's actually seen.
 */
export function tagTextColor(bg: string, over: string): string {
    const [r, g, b, a] = parseColor(bg);
    let R = r;
    let G = g;
    let B = b;
    if (a < 1) {
        const [or, og, ob] = parseColor(over);
        R = r * a + or * (1 - a);
        G = g * a + og * (1 - a);
        B = b * a + ob * (1 - a);
    }
    const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const L = 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
    return L >= 0.4 ? '#000000' : '#ffffff';
}
