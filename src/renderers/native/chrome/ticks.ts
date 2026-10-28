/**
 * Clean-room tick generation for the native renderer's axes.
 *  - `priceTicks`: 1/2/5×10ⁿ "nice numbers" for the price axis.
 *  - `timeTicks`: a UTC-aligned ladder for the time axis (crypto/24-7 friendly;
 *    DST/session-aware ticks are a later refinement — see the plan's risk list).
 */
import type { PctScale } from '../core/SceneGraph';
import { ENGLISH_FORMAT } from '../../../core/format/formatters';
import type { FormatSurface, ResolvedFormatters, TimeTickUnit } from '../../../core/format/types';
import { displayZone } from './tz';

export function priceTicks(min: number, max: number, target = 6): number[] {
    if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
    const raw = (max - min) / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    const start = Math.ceil(min / step) * step;
    if (!(step > 0) || start + step === start) return [];
    // Count the ticks up front and index them: accumulating `v += step` can stall
    // when the float spacing changes inside the range (e.g. across a power of two).
    const count = Math.floor((max - start) / step + 1e-6) + 1;
    if (!(count > 0) || count > 1000) return [];
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) {
        out.push(Number((start + i * step).toFixed(decimals)));
    }
    return out;
}

/** Decimals to show for a price, derived from the tick step magnitude. */
export function priceDecimals(min: number, max: number, target = 6): number {
    if (!(max > min)) return 2;
    const raw = (max - min) / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    return Math.max(0, Math.min(8, -Math.floor(Math.log10(step)) + 1));
}

/**
 * Nice ticks for a logarithmic axis. Over a wide range (≥ ~1 decade) it places
 * 1/2/5 per decade; over a narrow range (the common zoomed view) log ≈ linear,
 * so it falls back to dense linear nice-numbers — positioned via the log mapping.
 */
export function logPriceTicks(min: number, max: number, target = 6): number[] {
    if (min <= 0 || !(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
    if (Math.log10(max) - Math.log10(min) < 1.1) return priceTicks(min, max, target);
    const out: number[] = [];
    const startExp = Math.floor(Math.log10(min));
    const endExp = Math.ceil(Math.log10(max));
    for (let e = startExp; e <= endExp; e += 1) {
        for (const m of [1, 2, 5]) {
            const v = m * Math.pow(10, e);
            if (v >= min && v <= max) out.push(v);
        }
    }
    return out;
}

/** Decimals to show for a single price value (for log axes where the step varies). */
export function valueDecimals(v: number): number {
    const a = Math.abs(v);
    if (a >= 100) return 0;
    if (a >= 1) return 2;
    if (a >= 0.01) return 4;
    return 6;
}

/**
 * Decimal places needed to render a tick size exactly (0.01 → 2, 0.5 → 1, 1 → 0).
 * Probes increasing precision until the value round-trips, so it's robust to float
 * noise and to non-power-of-10 ticks (0.25, 0.5). Capped at 8.
 */
export function tickDecimals(tick: number): number {
    if (!(tick > 0) || !Number.isFinite(tick)) return 2;
    for (let d = 0; d <= 8; d += 1) {
        if (Math.abs(Number(tick.toFixed(d)) - tick) <= tick * 1e-6) return d;
    }
    return 8;
}

/**
 * Decimals for a price-axis label, by precedence:
 *  1. the exchange symbol's tick size (`mintick`) when known — the instrument's TRUE
 *     precision, so it doesn't drift with zoom;
 *  2. otherwise the zoom-derived "nice step" formula (the only source before symbol
 *     metadata loads, or for offline / non-exchange data).
 * A result of 0 is floored to 2 so a price never renders as a bare integer.
 */
export function axisDecimals(scale: { min: number; max: number }, heightPx: number, mintick?: number): number {
    const d = mintick != null && mintick > 0 ? tickDecimals(mintick) : priceDecimals(scale.min, scale.max, tickCount(heightPx));
    return d === 0 ? 2 : d;
}

/** Price-axis label density: ~one tick per 50px of pane height (like LwC). */
export function tickCount(paneHeightPx: number): number {
    return Math.max(2, Math.min(16, Math.round(paneHeightPx / 50)));
}

/** Price ticks for a pane: log ticks if logarithmic, else height-adaptive nice numbers. */
export function paneTicks(scale: { min: number; max: number; log?: boolean }, heightPx: number): number[] {
    return scale.log
        ? logPriceTicks(scale.min, scale.max, tickCount(heightPx))
        : priceTicks(scale.min, scale.max, tickCount(heightPx));
}

/** A price → percent-change vs baseline. */
function toPct(price: number, baseline: number): number {
    return (price / baseline - 1) * 100;
}

/** A price → value indexed to 100 at the baseline (`baseline` reads exactly 100). */
function toIndex(price: number, baseline: number): number {
    return (price / baseline) * 100;
}

// Every label below goes through the chart's formatters (`fmt`, from `chart.i18n.format`);
// without them, the built-in English formatting applies.

/** Format a percent change with a sign (`+2.34%` / `-1.20%`). */
export function formatPct(pct: number, fmt: ResolvedFormatters = ENGLISH_FORMAT, surface: FormatSurface = 'priceAxis'): string {
    return fmt.price(pct, { decimals: 2, mode: 'percent', surface });
}

/** Format an indexed-to-100 value (plain number, two decimals, e.g. `103.45`). */
export function formatIndex(idx: number, fmt: ResolvedFormatters = ENGLISH_FORMAT, surface: FormatSurface = 'priceAxis'): string {
    return fmt.price(idx, { decimals: 2, mode: 'indexed', surface });
}

/** Abbreviate a magnitude with a K/M/B suffix (e.g. `1.2M`) — for volume axes, where a
 *  raw `1234567.00` reads poorly. Small values keep up to two decimals, dropping trailing
 *  zeros; a bare `0` stays `0`. */
export function formatCompactValue(v: number, fmt: ResolvedFormatters = ENGLISH_FORMAT, surface: FormatSurface = 'priceAxis'): string {
    return fmt.compact(v, { decimals: 2, trimZeros: true, surface });
}

/**
 * Axis ticks for a pane as `{ price, label }` — the single source both the gridlines
 * (which need the pixel position from `price`) and the axis labels consume, so they
 * always agree. In percent / indexed mode (`pct` set) the ticks are nice ROUND percents
 * or index values mapped back to price; otherwise nice round prices. Linear only for
 * percent/indexed (the affine price↔percent map keeps the geometry identical to a linear
 * price axis). `format:'volume'` abbreviates the labels (K/M/B) — used for a volume-only pane.
 * `format:'none'` yields no ticks at all — an unscaled pane (content not value-mapped) draws
 * neither labels nor the gridlines that would ride them.
 */
export function paneAxisTicks(
    scale: { min: number; max: number; log?: boolean },
    heightPx: number,
    pct?: PctScale,
    mintick?: number,
    format?: 'volume' | 'none',
    fmt: ResolvedFormatters = ENGLISH_FORMAT,
): Array<{ price: number; label: string }> {
    if (format === 'none') return [];
    if (pct) {
        const { baseline, indexed } = pct;
        const lo = Math.min(scale.min, scale.max);
        const hi = Math.max(scale.min, scale.max);
        if (indexed) {
            const iLo = toIndex(lo, baseline);
            const iHi = toIndex(hi, baseline);
            return priceTicks(iLo, iHi, tickCount(heightPx)).map((idx) => ({ price: (baseline * idx) / 100, label: formatIndex(idx, fmt) }));
        }
        const pLo = toPct(lo, baseline);
        const pHi = toPct(hi, baseline);
        return priceTicks(pLo, pHi, tickCount(heightPx)).map((p) => ({ price: baseline * (1 + p / 100), label: formatPct(p, fmt) }));
    }
    if (format === 'volume') {
        return paneTicks(scale, heightPx).map((price) => ({ price, label: formatCompactValue(price, fmt) }));
    }
    return paneTicks(scale, heightPx).map((price) => ({ price, label: formatPriceLabel(scale, heightPx, price, mintick, fmt) }));
}

/** Format a single price for an axis chip in the pane's mode (percent / indexed vs absolute; a
 *  volume pane abbreviates with K/M/B; an unscaled pane yields '' — callers skip the chip). */
export function formatAxisValue(
    scale: { min: number; max: number; log?: boolean },
    heightPx: number,
    value: number,
    pct?: PctScale,
    mintick?: number,
    format?: 'volume' | 'none',
    fmt: ResolvedFormatters = ENGLISH_FORMAT,
    surface: FormatSurface = 'priceAxis',
): string {
    if (format === 'none') return '';
    if (pct) return pct.indexed ? formatIndex(toIndex(value, pct.baseline), fmt, surface) : formatPct(toPct(value, pct.baseline), fmt, surface);
    if (format === 'volume') return formatCompactValue(value, fmt, surface);
    return formatPriceLabel(scale, heightPx, value, mintick, fmt, surface);
}

/**
 * Format a price for an axis/chip. Decimals come from {@link axisDecimals} (exchange
 * tick size when known, else the zoom-derived formula, floored at 2), EXCEPT on wide
 * (multi-decade) log scales which use per-value decimals so tiny + huge prices both
 * read well. Shared by the price axis, the current-price line, and the crosshair so
 * they always agree.
 */
export function formatPriceLabel(
    scale: { min: number; max: number; log?: boolean },
    heightPx: number,
    value: number,
    mintick?: number,
    fmt: ResolvedFormatters = ENGLISH_FORMAT,
    surface: FormatSurface = 'priceAxis',
): string {
    const wideLog = scale.log && Math.log10(scale.max) - Math.log10(scale.min) >= 1.1;
    const valueD = wideLog ? valueDecimals(value) : 0;
    const decimals = wideLog ? (valueD === 0 ? 2 : valueD) : axisDecimals(scale, heightPx, mintick);
    return fmt.price(value, { decimals, mintick, mode: 'price', surface });
}

export interface TimeTick {
    time: number;
    label: string;
    major: boolean;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const STEP_LADDER = [
    SEC, 5 * SEC, 15 * SEC, 30 * SEC,
    MIN, 5 * MIN, 15 * MIN, 30 * MIN,
    HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR,
    DAY, 2 * DAY, WEEK, MONTH, 3 * MONTH, YEAR,
];

/**
 * The crosshair's time-axis chip: `Sun 30 Aug '26 19:00`. Always the full calendar date
 * (weekday, day, month, two-digit year) so the stamp is unambiguous however far the view
 * is scrolled; the wall-clock time is appended only when bars are intraday — on a daily
 * or coarser bar the hh:mm would just echo the bar's open and add noise. A daily or coarser
 * bar reads its UTC date in every zone (see {@link displayZone}).
 */
export function formatTimeStamp(
    ms: number,
    timeZone: string,
    barIntervalMs: number,
    fmt: ResolvedFormatters = ENGLISH_FORMAT,
    surface: FormatSurface = 'crosshair',
): string {
    return fmt.timeStamp(ms, { timeZone: displayZone(timeZone, barIntervalMs), withTime: barIntervalMs < DAY, surface });
}

function pickStep(targetMs: number): number {
    for (const step of STEP_LADDER) if (step >= targetMs) return step;
    return STEP_LADDER[STEP_LADDER.length - 1]!;
}

/**
 * UTC-aligned tick ladder for the time axis. `offsetMs` shifts alignment + labels into
 * a chosen time zone (0 ⇒ UTC): ticks land on local midnights/hours and the returned
 * `time` is the REAL epoch-ms (zoned alignment undone) so the X mapping stays correct.
 */
export function timeTicks(fromMs: number, toMs: number, target = 8, offsetMs = 0, fmt: ResolvedFormatters = ENGLISH_FORMAT): TimeTick[] {
    const span = toMs - fromMs;
    if (!(span > 0)) return [];
    const step = pickStep(span / Math.max(1, target));
    // Work in zoned space so `first`/steps align to local wall-clock, then undo the
    // shift on each tick's `time` for pixel placement on the real (UTC) axis.
    const zFrom = fromMs + offsetMs;
    const zTo = toMs + offsetMs;
    if (step >= MONTH) return calendarTicks(zFrom, zTo, step >= YEAR ? 12 : step >= 3 * MONTH ? 3 : 1, offsetMs, fmt);
    const first = Math.ceil(zFrom / step) * step;
    const clockUnit: TimeTickUnit = step < MIN ? 'second' : step < HOUR ? 'minute' : 'hour';
    const out: TimeTick[] = [];
    for (let zt = first; zt <= zTo; zt += step) {
        const t = zt - offsetMs;
        const d = new Date(zt);
        let unit: TimeTickUnit;
        let major = false;
        if (step < DAY) {
            major = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
            unit = major ? 'day' : clockUnit;
        } else if (step < YEAR) {
            major = d.getUTCDate() === 1;
            unit = major ? 'month' : 'day';
        } else {
            unit = 'year';
            major = true;
        }
        out.push({ time: t, label: fmt.timeTick(t, { unit, major, offsetMs, surface: 'timeAxis' }), major });
    }
    return out;
}

/**
 * Month, quarter and year ticks on real calendar boundaries (the first of the month, in
 * zoned space). Fixed 30/365-day steps drift off the calendar by a day per leap year,
 * which puts each year label weeks before the January it names.
 */
function calendarTicks(zFrom: number, zTo: number, months: number, offsetMs: number, fmt: ResolvedFormatters): TimeTick[] {
    const d0 = new Date(zFrom);
    let idx = d0.getUTCFullYear() * 12 + d0.getUTCMonth();
    if (Date.UTC(Math.floor(idx / 12), idx % 12, 1) < zFrom) idx += 1;
    idx = Math.ceil(idx / months) * months;
    const unit: TimeTickUnit = months === 12 ? 'year' : 'month';
    const out: TimeTick[] = [];
    for (let zt = Date.UTC(Math.floor(idx / 12), idx % 12, 1); zt <= zTo; idx += months, zt = Date.UTC(Math.floor(idx / 12), idx % 12, 1)) {
        const time = zt - offsetMs;
        out.push({ time, label: fmt.timeTick(time, { unit, major: true, offsetMs, surface: 'timeAxis' }), major: true });
    }
    return out;
}
