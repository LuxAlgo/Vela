// Number formatting shared by the widget chrome (statusline, data readouts) — pure.

/** Sensible decimal count for a price magnitude (crypto-friendly). */
export function decimalsFor(ref: number): number {
    const a = Math.abs(ref);
    return a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
}

/** Locale-formatted price; `'—'` for null/non-finite. */
export function fmtPrice(n: number | null | undefined, dp?: number): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const d = dp ?? decimalsFor(n);
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Signed change + percent ("+123.45 (+1.23%)") from open→close; `''` when unavailable. */
export function fmtChange(open: number | null | undefined, close: number | null | undefined): string {
    if (open == null || close == null || !Number.isFinite(open) || !Number.isFinite(close) || open === 0) return '';
    const diff = close - open;
    const pct = (diff / open) * 100;
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${fmtPrice(diff, decimalsFor(close))} (${sign}${pct.toFixed(2)}%)`;
}
