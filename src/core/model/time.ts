/**
 * Canonical time in Vela: Unix epoch **milliseconds**.
 *
 * This matches PineTS (`openTime`), JS `Date`, and QFChart's `OHLCV.time`.
 * Each renderer converts to its own unit at its boundary (e.g. the
 * lightweight-charts adapter divides by 1000 to produce `UTCTimestamp`).
 */
export type Millis = number;
