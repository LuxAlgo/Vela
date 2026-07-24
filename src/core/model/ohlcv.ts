import type { Millis } from './time';

/** A single price bar. `time` is the bar's open time in epoch ms. */
export interface OHLCV {
    time: Millis;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}
