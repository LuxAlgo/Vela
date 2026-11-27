/**
 * A price shown in another unit, relative to a reference price: the conversions behind a
 * settings field's unit switch. A drawing always stores the price itself.
 */

export type PriceUnit = 'price' | 'points' | 'percent' | 'ticks';

/**
 * Clear the binary-float noise arithmetic leaves on numbers of `scale`'s size
 * (`100.3 - 100.1`). The decimals kept follow the size (fourteen significant digits of it),
 * so a price of a few millionths keeps its own.
 */
function clean(n: number, scale: number): number {
    const magnitude = Math.floor(Math.log10(Math.max(Math.abs(scale), Number.MIN_VALUE)));
    return Number(n.toFixed(Math.max(0, Math.min(20, 13 - magnitude))));
}

function usable(n: number | null | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

/**
 * The units a price can be shown in against `base`. Points need a reference price, percent
 * a non-zero one, and ticks a known tick size.
 */
export function priceUnits(base: number | null | undefined, tick?: number | null): PriceUnit[] {
    const out: PriceUnit[] = ['price'];
    if (!usable(base)) return out;
    out.push('points');
    if (base !== 0) out.push('percent');
    if (usable(tick) && tick > 0) out.push('ticks');
    return out;
}

/** `price` in `unit`. A unit that cannot be computed (see {@link priceUnits}) gives the
 *  price back, so a finite price always reads as a finite number. */
export function priceInUnit(price: number, base: number | null | undefined, unit: PriceUnit, tick?: number | null): number {
    if (unit === 'price' || !priceUnits(base, tick).includes(unit)) return clean(price, price);
    const b = base as number;
    const scale = Math.max(Math.abs(price), Math.abs(b));
    const offset = clean(price - b, scale);
    if (unit === 'points') return offset;
    if (unit === 'percent') return clean((offset / b) * 100, (scale / Math.abs(b)) * 100);
    return clean(offset / (tick as number), scale / (tick as number));
}

/** The price a `value` typed in `unit` stands for: the inverse of {@link priceInUnit}. */
export function priceFromUnit(value: number, base: number | null | undefined, unit: PriceUnit, tick?: number | null): number {
    if (unit === 'price' || !priceUnits(base, tick).includes(unit)) return value;
    const b = base as number;
    const offset = unit === 'points' ? value : unit === 'percent' ? (b * value) / 100 : value * (tick as number);
    return clean(b + offset, Math.max(Math.abs(b), Math.abs(offset)));
}
