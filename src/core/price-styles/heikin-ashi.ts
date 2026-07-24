import type { OHLCV } from '../model/ohlcv';

/**
 * Heikin Ashi: a 1:1, time-preserving DISPLAY transform of the raw bar stream.
 *
 *   haClose = (O + H + L + C) / 4
 *   haOpen  = (prevHaOpen + prevHaClose) / 2   (seeded (O + C) / 2 on the first bar)
 *   haHigh  = max(H, haOpen, haClose)
 *   haLow   = min(L, haOpen, haClose)
 *
 * Time and volume carry through unchanged. The series is RECURSIVE — each bar needs the
 * previous DERIVED bar — so a full series computes front-to-back ({@link heikinAshiFull})
 * and a live tick derives in O(1) from the previous view bar ({@link heikinAshiNext}).
 * Synthetic by construction: derived values are never stored back into any data cache.
 */

/** Derive one Heikin Ashi bar from a raw bar + the PREVIOUS DERIVED bar (undefined = series start). */
export function heikinAshiNext(raw: OHLCV, prevHa: OHLCV | undefined): OHLCV {
    const haClose = (raw.open + raw.high + raw.low + raw.close) / 4;
    const haOpen = prevHa ? (prevHa.open + prevHa.close) / 2 : (raw.open + raw.close) / 2;
    return {
        time: raw.time,
        open: haOpen,
        high: Math.max(raw.high, haOpen, haClose),
        low: Math.min(raw.low, haOpen, haClose),
        close: haClose,
        ...(raw.volume != null ? { volume: raw.volume } : {}),
    };
}

/** Derive the full Heikin Ashi series (front-to-back; index-aligned 1:1 with `raw`). */
export function heikinAshiFull(raw: readonly OHLCV[]): OHLCV[] {
    const out: OHLCV[] = new Array(raw.length);
    let prev: OHLCV | undefined;
    for (let i = 0; i < raw.length; i += 1) {
        prev = heikinAshiNext(raw[i]!, prev);
        out[i] = prev;
    }
    return out;
}
