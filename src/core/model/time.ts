/**
 * Canonical time in Vela: Unix epoch **milliseconds**.
 *
 * This matches JS `Date` and the bar `openTime` every provider and scripting
 * engine speaks. Each renderer converts to its own unit at its boundary (a
 * second-based adapter divides by 1000).
 */
export type Millis = number;
