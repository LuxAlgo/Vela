// Chart numbers and dates in the chart's locale: English keeps today's shapes, every
// language keeps Western digits, the Gregorian calendar and a 24-hour clock unless the host
// asks otherwise, and a host can replace any formatter.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator } from '../src/plugin';
import { formatAxisValue, formatTimeStamp, paneAxisTicks, timeTicks } from '../src/renderers/native/chrome/ticks';
import { countdownText } from '../src/renderers/native/chrome/countdown';
import { datePickerController } from '../src/ui/components/date-picker';
import type { PctScale } from '../src/renderers/native/core/SceneGraph';

afterEach(() => vi.restoreAllMocks());

const SEP_5_2026_1430 = Date.UTC(2026, 8, 5, 14, 30);
const scale = { min: 58_000, max: 59_000 };

describe('a chart with no locale', () => {
    const f = createTranslator().format;

    it("keeps today's English shapes on the axes, chips and readouts", () => {
        expect(f.price(58_732.5, { decimals: 2 })).toBe('58732.50');
        expect(f.price(58_732.5, { decimals: 2, grouping: true })).toBe('58,732.50');
        expect(f.price(5, { decimals: 2, mode: 'percent' })).toBe('+5.00%');
        expect(f.price(-1.2, { decimals: 2, mode: 'percent' })).toBe('-1.20%');
        expect(f.price(103.456, { decimals: 2, mode: 'indexed' })).toBe('103.46');
        expect(f.compact(1_234_567)).toBe('1.23M');
        expect(f.compact(1_200_000)).toBe('1.2M');
        expect(f.compact(1_200_000, { trimZeros: false })).toBe('1.20M');
        expect(f.timeTick(SEP_5_2026_1430, { unit: 'minute', major: false })).toBe('14:30');
        expect(f.timeTick(SEP_5_2026_1430, { unit: 'day', major: true })).toBe('Sep 5');
        expect(f.timeTick(SEP_5_2026_1430, { unit: 'month', major: true })).toBe('Sep');
        expect(f.timeTick(SEP_5_2026_1430, { unit: 'year', major: true })).toBe('2026');
        expect(f.timeStamp(Date.UTC(2031, 0, 3, 9, 5))).toBe("Fri 3 Jan '31 09:05");
        expect(f.duration(299_000)).toBe('04:59');
        expect(f.duration(3_665_000)).toBe('1:01:05');
        expect(f.duration(2 * 86_400_000 + 4 * 3_600_000, { style: 'span' })).toBe('2d 4h');
    });

    it('formats the same through the chart formatters as through the built-in defaults', () => {
        const pct: PctScale = { baseline: 58_500, indexed: false } as PctScale;
        expect(paneAxisTicks(scale, 300, undefined, 0.5, undefined, f)).toEqual(paneAxisTicks(scale, 300, undefined, 0.5));
        expect(paneAxisTicks(scale, 300, pct, 0.5, undefined, f)).toEqual(paneAxisTicks(scale, 300, pct, 0.5));
        expect(formatAxisValue(scale, 300, 58_732.5, undefined, 0.01, 'volume', f)).toBe(formatAxisValue(scale, 300, 58_732.5, undefined, 0.01, 'volume'));
        expect(timeTicks(SEP_5_2026_1430, SEP_5_2026_1430 + 3 * 86_400_000, 8, 0, f)).toEqual(timeTicks(SEP_5_2026_1430, SEP_5_2026_1430 + 3 * 86_400_000, 8, 0));
        expect(formatTimeStamp(SEP_5_2026_1430, 'America/New_York', 60_000, f)).toBe("Sat 5 Sep '26 10:30");
        expect(countdownText(0, 300_000, 1_000, f)).toBe('04:59');
    });

    it('keeps the date picker in English with weeks from Sunday', () => {
        const c = datePickerController({ value: '2026-09-10', today: new Date(2026, 8, 24), i18n: createTranslator() });
        expect(c.header().month).toBe('September');
        expect(c.weekdays()).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
        expect(c.cells().filter((x) => x.blank)).toHaveLength(2); // 1 Sep 2026 is a Tuesday
        expect(c.navLabels()).toEqual({ prev: 'Previous month', next: 'Next month' });
    });
});

describe('digits', () => {
    it('Arabic in Saudi Arabia shows Western digits by default, and Arabic-Indic digits on request', () => {
        const latn = createTranslator({ locale: 'ar-SA' });
        expect(latn.numberingSystem).toBe('latn');
        expect(latn.format.price(58_732.5, { decimals: 2, grouping: true })).toBe('58,732.50');
        expect(latn.format.timeTick(SEP_5_2026_1430, { unit: 'minute', major: false })).toBe('14:30');

        const native = createTranslator({ locale: 'ar-SA', numberingSystem: 'locale' });
        expect(native.numberingSystem).toBe('arab');
        expect(native.format.price(58_732.5, { decimals: 2, grouping: true })).toBe('٥٨٬٧٣٢٫٥٠');
        expect(native.format.price(-1.5, { decimals: 1 })).toBe('-١٫٥');
        expect(native.format.duration(299_000)).toBe('٠٤:٥٩');
        expect(createTranslator({ locale: 'ar', numberingSystem: 'arab' }).format.timeTick(SEP_5_2026_1430, { unit: 'minute', major: false })).toBe('١٤:٣٠');
    });

    it('chart numbers carry no bidi control marks in right-to-left languages', () => {
        for (const locale of ['ar', 'he', 'fa', 'ar-SA']) {
            const f = createTranslator({ locale }).format;
            for (const text of [f.price(-58_732.5, { decimals: 2, grouping: true }), f.percent(-1.2), f.price(-3, { decimals: 2, mode: 'percent' }), f.compact(-1_234_567)]) {
                expect(text).not.toMatch(/[‎‏؜]/);
            }
        }
    });
});

describe('calendar and clock', () => {
    it('Thai dates count Gregorian years, not Buddhist ones', () => {
        const f = createTranslator({ locale: 'th' }).format;
        expect(f.timeTick(SEP_5_2026_1430, { unit: 'year', major: true })).toBe('2026');
        expect(f.timeStamp(SEP_5_2026_1430)).toContain('26');
        expect(f.timeStamp(SEP_5_2026_1430)).not.toContain('69');
        const c = datePickerController({ value: '2026-09-10', i18n: createTranslator({ locale: 'th' }) });
        expect(c.header().year).toBe('2026');
    });

    it('the clock is 24-hour in every language by default, and 12-hour on request', () => {
        for (const locale of ['en', 'en-US', 'ko', 'hi', 'ar']) {
            expect(createTranslator({ locale }).format.timeTick(Date.UTC(2026, 0, 1, 21, 5), { unit: 'minute', major: false })).toBe('21:05');
        }
        expect(createTranslator({ hourCycle: 'h12' }).format.timeTick(Date.UTC(2026, 0, 1, 21, 5), { unit: 'minute', major: false })).toBe('9:05 PM');
    });

    it('a tick labels the wall-clock time the axis aligned it with', () => {
        const f = createTranslator({ locale: 'de' }).format;
        expect(f.timeTick(Date.UTC(2026, 0, 1, 21, 5), { unit: 'minute', major: false, offsetMs: 3_600_000 })).toBe('22:05');
    });
});

describe('separators and abbreviations', () => {
    it('German prices take German separators; axis prices stay ungrouped to fit the gutter', () => {
        const f = createTranslator({ locale: 'de' }).format;
        expect(f.price(58_732.5, { decimals: 2 })).toBe('58732,50');
        expect(f.price(58_732.5, { decimals: 2, grouping: true })).toBe('58.732,50');
        expect(f.price(2.5, { decimals: 2, mode: 'percent' })).toBe('+2,50 %');
    });

    it('a price rounds the same in every language', () => {
        for (const locale of ['de', 'fr', 'ja', 'ar', 'hi']) {
            const f = createTranslator({ locale }).format;
            expect(f.price(1.005, { decimals: 2 }).replace(',', '.')).toBe((1.005).toFixed(2));
            expect(f.price(2.675, { decimals: 2 }).replace(',', '.')).toBe((2.675).toFixed(2));
        }
    });

    it("India groups in lakhs and crores", () => {
        expect(createTranslator({ locale: 'en-IN' }).format.price(12_345_678.9, { decimals: 2, grouping: true })).toBe('1,23,45,678.90');
    });

    it("volumes use the locale's compact abbreviations", () => {
        expect(createTranslator({ locale: 'ja' }).format.compact(1_234_567)).toBe('123.46万');
        expect(createTranslator({ locale: 'de' }).format.compact(1_234_567)).toBe('1,23 Mio.');
    });
});

describe('week start and direction', () => {
    it("the date picker's week starts on the locale's first day, or the host's choice", () => {
        expect(datePickerController({ i18n: createTranslator({ locale: 'de' }) }).weekdays()[0]).toBe('Mo');
        expect(createTranslator({ locale: 'en' }).weekStart).toBe(0);
        expect(createTranslator({ locale: 'en-GB' }).weekStart).toBe(1);
        expect(createTranslator({ locale: 'ar' }).weekStart).toBe(6);
        expect(createTranslator({ locale: 'de', weekStart: 0 }).weekStart).toBe(0);
        const sundayDe = datePickerController({ value: '2026-09-10', i18n: createTranslator({ locale: 'de', weekStart: 0 }) });
        expect(sundayDe.weekdays()[0]).toBe('So');
        expect(sundayDe.cells().filter((x) => x.blank)).toHaveLength(2);
        const mondayDe = datePickerController({ value: '2026-09-10', i18n: createTranslator({ locale: 'de' }) });
        expect(mondayDe.cells().filter((x) => x.blank)).toHaveLength(1);
    });

    it("the date picker writes the year first where the locale does", () => {
        const ja = datePickerController({ value: '2026-09-10', i18n: createTranslator({ locale: 'ja' }) });
        expect(ja.yearFirst).toBe(true);
        expect(ja.header()).toMatchObject({ month: '9月', year: '2026年' });
        expect(datePickerController({ i18n: createTranslator({ locale: 'fr' }) }).yearFirst).toBe(false);
    });

    it("direction 'auto' follows the script, and the default stays left to right in every language", () => {
        expect(createTranslator({ locale: 'ar', direction: 'auto' }).direction).toBe('rtl');
        expect(createTranslator({ locale: 'he', direction: 'auto' }).direction).toBe('rtl');
        expect(createTranslator({ locale: 'fa', direction: 'auto' }).direction).toBe('rtl');
        expect(createTranslator({ locale: 'ja', direction: 'auto' }).direction).toBe('ltr');
        expect(createTranslator({ locale: 'ar' }).direction).toBe('ltr');
        expect(createTranslator({ locale: 'de', direction: 'rtl' }).direction).toBe('rtl');
    });
});

describe('host formatters', () => {
    it('a host formatter replaces a built-in one and can fall back to it', () => {
        const t = createTranslator({
            locale: 'de',
            formatters: {
                price: (v, ctx) => (ctx.surface === 'statusLine' ? `€ ${ctx.fallback()}` : ctx.fallback()),
                compact: (v) => `${Math.round(v / 1000)}k`,
            },
        });
        expect(t.format.price(5, { decimals: 2, surface: 'statusLine' })).toBe('€ 5,00');
        expect(t.format.price(5, { decimals: 2 })).toBe('5,00');
        expect(t.format.compact(12_345)).toBe('12k');
        expect(t.format.percent(1)).toBe('+1,00 %');
    });

    it('a host formatter that throws or returns no text falls back to the built-in one', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const t = createTranslator({
            formatters: {
                price: () => {
                    throw new Error('boom');
                },
                timeTick: () => 42 as unknown as string,
            },
        });
        expect(t.format.price(1.5, { decimals: 2 })).toBe('1.50');
        expect(t.format.timeTick(SEP_5_2026_1430, { unit: 'minute', major: false })).toBe('14:30');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('a host formatter learns where the value appears', () => {
        const seen: string[] = [];
        const t = createTranslator({
            formatters: {
                timeStamp: (ms, ctx) => {
                    seen.push(`${ctx.surface} ${ctx.timeZone} ${ctx.locale} ${ctx.withTime}`);
                    return ctx.fallback();
                },
            },
        });
        formatTimeStamp(SEP_5_2026_1430, 'Asia/Tokyo', 3_600_000, t.format);
        // A daily bar's date reads in UTC whatever the display zone.
        formatTimeStamp(SEP_5_2026_1430, 'Asia/Tokyo', 86_400_000, t.format);
        expect(seen).toEqual(['crosshair Asia/Tokyo en true', 'crosshair UTC en false']);
    });
});
