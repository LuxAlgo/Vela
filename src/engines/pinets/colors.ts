/**
 * Pine `na` color (and fully-transparent colors) mean "hide this segment".
 * Detect them so the model carries no color rather than a bogus one.
 */
export function isVisibleColor(color: unknown): color is string {
    if (typeof color !== 'string') return false;
    const s = color.trim();
    if (!s) return false;
    const lower = s.toLowerCase();
    if (lower === 'na' || lower === 'nan') return false;
    // #RRGGBBAA with AA === 00 → invisible
    const hex8 = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})$/.exec(s);
    if (hex8 && parseInt(hex8[1] ?? 'ff', 16) === 0) return false;
    // rgba(…, 0)
    if (/rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(s)) return false;
    return true;
}

/** Returns the color string if visible, else the fallback (default undefined). */
export function normColor(color: unknown, fallback?: string): string | undefined {
    return isVisibleColor(color) ? color.trim() : fallback;
}
