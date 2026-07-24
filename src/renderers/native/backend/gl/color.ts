/**
 * CSS color string → straight (non-premultiplied) RGBA floats in [0, 1], cached.
 * The model carries colors as CSS strings (hex/rgb/rgba/hsl/named); the GL pipeline
 * needs float RGBA per vertex. We normalize via a 1×1 canvas2d (paints the color on
 * a transparent pixel and reads it back), which handles every CSS color form
 * uniformly — then cache so each distinct string is parsed at most once.
 */
type Rgba = [number, number, number, number];
const FALLBACK: Rgba = [0, 0, 0, 1];
let probe: CanvasRenderingContext2D | null = null;

// Bounded 2-generation LRU. Per-bar gradients/color-ramps emit a distinct color
// string per bar, so an unbounded cache would grow without limit while panning a
// long history. When the live map fills, it becomes the previous generation and a
// fresh one starts; lookups promote from previous → live, keeping the hot working
// set without re-parse storms and capping total entries at ~2×CAP.
const CAP = 8192;
let cache = new Map<string, Rgba>();
let prev = new Map<string, Rgba>();

export function parseColor(css: string | null | undefined): Rgba {
    if (!css) return FALLBACK;
    let v = cache.get(css);
    if (v) return v;
    v = prev.get(css);
    if (v) {
        cache.set(css, v); // promote into the live generation
        return v;
    }
    v = readBack(css);
    cache.set(css, v);
    if (cache.size >= CAP) {
        prev = cache;
        cache = new Map();
    }
    return v;
}

/**
 * Black or white — whichever is easier to read on `bg` — chosen by WCAG contrast, so chip/label
 * text stays legible on any background (light OR dark) with no hardcoded assumption. A translucent
 * `bg` is composited over `over` (the surface behind it, e.g. the theme background) first, so the
 * pick reflects what's actually seen. Returns `'#000000'` or `'#ffffff'`.
 */
export function readableText(bg: string, over = '#000000'): string {
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
    const L = 0.2126 * linearize(R) + 0.7152 * linearize(G) + 0.0722 * linearize(B);
    const contrastBlack = (L + 0.05) / 0.05; // vs #000
    const contrastWhite = 1.05 / (L + 0.05); // vs #fff
    return contrastBlack >= contrastWhite ? '#000000' : '#ffffff';
}

/** sRGB channel [0,1] → linear-light, for a perceptual (relative-luminance) weighting. */
function linearize(c: number): number {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function readBack(css: string): [number, number, number, number] {
    if (!probe) {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        probe = c.getContext('2d', { willReadFrequently: true });
    }
    if (!probe) return FALLBACK;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = css; // invalid strings leave the previous value (#000) → safe fallback
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [d[0]! / 255, d[1]! / 255, d[2]! / 255, d[3]! / 255];
}
