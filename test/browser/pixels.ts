export type RGB = readonly [number, number, number];

/** Match unpremultiplied Chromium pixels without confusing a gold study with red candles. */
export function countColor(pixels: Uint8ClampedArray, color: RGB): number {
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! < 40) continue;
        if (color.every((channel, index) => Math.abs(pixels[i + index]! - channel) <= 3)) count++;
    }
    return count;
}
