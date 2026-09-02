import { describe, it, expect } from 'vitest';
import { logPriceTicks, valueDecimals, priceTicks, tickDecimals, axisDecimals, formatPriceLabel, formatAxisValue, formatTimeStamp } from '../src/renderers/native/chrome/ticks';

describe('native ticks · logPriceTicks', () => {
    it('places 1/2/5 per decade over a wide (multi-decade) range', () => {
        const ticks = logPriceTicks(1, 1000);
        expect(ticks).toContain(1);
        expect(ticks).toContain(2);
        expect(ticks).toContain(5);
        expect(ticks).toContain(10);
        expect(ticks).toContain(100);
        expect(ticks).toContain(1000);
        // strictly increasing, all within range
        for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    });

    it('falls back to dense linear nice-numbers over a sub-decade range (zoomed view)', () => {
        const ticks = logPriceTicks(73, 179, 12); // ~0.4 decade → would be just "100" with 1/2/5
        expect(ticks.length).toBeGreaterThanOrEqual(4); // dense, not sparse
        expect(ticks).toEqual(priceTicks(73, 179, 12)); // identical to the linear nice-number set
    });

    it('returns nothing for a non-positive or degenerate range', () => {
        expect(logPriceTicks(0, 100)).toEqual([]);
        expect(logPriceTicks(-5, 5)).toEqual([]);
        expect(logPriceTicks(100, 100)).toEqual([]);
    });
});

describe('native ticks · valueDecimals', () => {
    it('shows fewer decimals as magnitude grows', () => {
        expect(valueDecimals(250)).toBe(0);
        expect(valueDecimals(12.5)).toBe(2);
        expect(valueDecimals(0.05)).toBe(4);
        expect(valueDecimals(0.0001)).toBe(6);
    });
});

describe('native ticks · tickDecimals', () => {
    it('counts the decimals needed to render a tick size exactly', () => {
        expect(tickDecimals(1)).toBe(0);
        expect(tickDecimals(0.1)).toBe(1);
        expect(tickDecimals(0.01)).toBe(2); // robust to float noise (0.01 isn't exact in binary)
        expect(tickDecimals(0.001)).toBe(3);
        expect(tickDecimals(0.00001)).toBe(5);
        expect(tickDecimals(0.5)).toBe(1); // non-power-of-10 ticks
        expect(tickDecimals(0.25)).toBe(2);
        expect(tickDecimals(0.05)).toBe(2);
    });

    it('falls back to 2 for a missing / invalid tick', () => {
        expect(tickDecimals(0)).toBe(2);
        expect(tickDecimals(-1)).toBe(2);
        expect(tickDecimals(NaN)).toBe(2);
    });
});

describe('native ticks · axisDecimals (tick size vs formula, floor 2)', () => {
    const wide = { min: 58000, max: 67000 }; // zoom-out: the formula gives 0 decimals here

    it('uses the exchange tick size when known, regardless of zoom', () => {
        expect(axisDecimals(wide, 600, 0.01)).toBe(2);
        expect(axisDecimals(wide, 600, 0.001)).toBe(3);
        expect(axisDecimals({ min: 0.5, max: 0.9 }, 600, 0.00001)).toBe(5);
    });

    it('falls back to the zoom-derived formula when the tick size is unknown', () => {
        expect(axisDecimals(wide, 600)).toBe(2); // formula → 0 here, floored to 2
        expect(axisDecimals({ min: 100, max: 101 }, 600)).toBe(axisDecimals({ min: 100, max: 101 }, 600, undefined));
    });

    it('floors a zero-decimal result at 2 (never a bare integer), from either source', () => {
        expect(axisDecimals(wide, 600, 1)).toBe(2); // tick=1 → 0 decimals → floored to 2
        expect(axisDecimals(wide, 600)).toBe(2); // formula → 0 → floored to 2
    });
});

describe('native ticks · formatPriceLabel / formatAxisValue', () => {
    it('renders the exchange precision when a tick size is supplied', () => {
        expect(formatPriceLabel({ min: 58000, max: 67000 }, 600, 58732, 0.01)).toBe('58732.00');
        expect(formatPriceLabel({ min: 58000, max: 67000 }, 600, 58732)).toBe('58732.00'); // formula floored to 2
        expect(formatAxisValue({ min: 0.5, max: 0.9 }, 600, 0.6234, undefined, 0.0001)).toBe('0.6234');
    });

    it('percent mode ignores the tick size (always ±x.xx%)', () => {
        expect(formatAxisValue({ min: 100, max: 110 }, 600, 105, { baseline: 100, indexed: false }, 0.01)).toBe('+5.00%');
    });

    it('indexed mode ignores the tick size (plain number to 2 decimals)', () => {
        expect(formatAxisValue({ min: 100, max: 110 }, 600, 105, { baseline: 100, indexed: true }, 0.01)).toBe('105.00');
    });
});

describe('native ticks · formatTimeStamp (crosshair time chip)', () => {
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    const sun30Aug26_19h = Date.UTC(2026, 7, 30, 19, 0); // a Sunday

    it('reads weekday, day, short month, two-digit year and hh:mm on intraday bars', () => {
        expect(formatTimeStamp(sun30Aug26_19h, 'UTC', HOUR)).toBe("Sun 30 Aug '26 19:00");
        expect(formatTimeStamp(Date.UTC(2031, 0, 3, 9, 5), 'UTC', 60_000)).toBe("Fri 3 Jan '31 09:05");
    });

    it('drops hh:mm on daily and coarser bars', () => {
        expect(formatTimeStamp(sun30Aug26_19h, 'UTC', DAY)).toBe("Sun 30 Aug '26");
        expect(formatTimeStamp(sun30Aug26_19h, 'UTC', 7 * DAY)).toBe("Sun 30 Aug '26");
        expect(formatTimeStamp(sun30Aug26_19h, 'UTC', 12 * HOUR)).toBe("Sun 30 Aug '26 19:00");
    });

    it('zero-pads the year and renders the wall clock in the chosen time zone', () => {
        expect(formatTimeStamp(Date.UTC(2005, 11, 31, 23, 30), 'UTC', HOUR)).toBe("Sat 31 Dec '05 23:30");
        // 23:30 UTC on Dec 31 is already Jan 1 in Tokyo (UTC+9) — date, weekday and year roll.
        expect(formatTimeStamp(Date.UTC(2005, 11, 31, 23, 30), 'Asia/Tokyo', HOUR)).toBe("Sun 1 Jan '06 08:30");
    });

    it('treats an unknown bar interval (no bars yet) as intraday', () => {
        expect(formatTimeStamp(sun30Aug26_19h, 'UTC', 0)).toBe("Sun 30 Aug '26 19:00");
    });
});
