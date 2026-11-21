// Assembles a chart's resolved formatters: the built-in formatting for its settings, with
// any host replacement layered on top. The built-in path allocates nothing beyond its
// result; a host formatter gets a context object with `fallback()` to the built-in.
import { formatClock, formatDuration, formatTimeStamp, formatTimeTick } from './dates';
import { formatCompact, formatPercent, formatPrice } from './numbers';
import type { FormatContext, FormatSettings, FormatSurface, ResolvedFormatters, VelaFormatters } from './types';

/** The built-in formatters for one set of settings. */
export function builtinFormatters(settings: FormatSettings): ResolvedFormatters {
    return {
        price: (value, options) => formatPrice(value, options, settings),
        percent: (value, options) => formatPercent(value, options, settings),
        compact: (value, options) => formatCompact(value, options, settings),
        timeTick: (ms, options) => formatTimeTick(ms, options, settings),
        timeStamp: (ms, options) => formatTimeStamp(ms, options, settings),
        duration: (ms, options) => formatDuration(ms, options, settings),
        clock: (ms, options) => formatClock(ms, options, settings),
    };
}

/** Settings of the default chart: English, Western digits, 24-hour clock. */
export const ENGLISH_SETTINGS: FormatSettings = Object.freeze({ locale: 'en', numberingSystem: 'latn', hourCycle: 'h23', english: true });

/** The default chart's formatters — what every surface uses when no chart hands it its own. */
export const ENGLISH_FORMAT: ResolvedFormatters = builtinFormatters(ENGLISH_SETTINGS);

let warned = false;

/** Run a host formatter; a throw or a non-string result falls back to the built-in one. */
function viaHost<C>(host: (value: number, ctx: C) => string, value: number, ctx: C, fallback: () => string): string {
    try {
        const out = host(value, ctx);
        if (typeof out === 'string') return out;
    } catch (err) {
        if (!warned) {
            warned = true;
            console.warn('[vela] a host formatter threw; the built-in formatting is used instead.', err);
        }
    }
    return fallback();
}

/** The resolved formatters: built-ins for `settings`, replaced per method by `overrides`. */
export function resolveFormatters(settings: FormatSettings, overrides?: Partial<VelaFormatters> | null): ResolvedFormatters {
    const base = builtinFormatters(settings);
    if (!overrides) return base;
    const ctx = (surface: FormatSurface | undefined, defaultSurface: FormatSurface, timeZone: string | undefined, fallback: () => string): FormatContext => ({
        locale: settings.locale,
        timeZone: timeZone ?? 'UTC',
        surface: surface ?? defaultSurface,
        fallback,
    });
    const o = overrides;
    return {
        price(value, options) {
            const fallback = (): string => base.price(value, options);
            if (typeof o.price !== 'function') return fallback();
            return viaHost(o.price, value, { ...ctx(options.surface, 'priceAxis', undefined, fallback), decimals: options.decimals, mintick: options.mintick, mode: options.mode ?? 'price', paneId: options.paneId, grouping: options.grouping ?? false }, fallback);
        },
        percent(value, options) {
            const fallback = (): string => base.percent(value, options);
            if (typeof o.percent !== 'function') return fallback();
            return viaHost(o.percent, value, { ...ctx(options?.surface, 'statusLine', undefined, fallback), decimals: options?.decimals ?? 2, signed: options?.signed ?? true }, fallback);
        },
        compact(value, options) {
            const fallback = (): string => base.compact(value, options);
            if (typeof o.compact !== 'function') return fallback();
            return viaHost(o.compact, value, { ...ctx(options?.surface, 'priceAxis', undefined, fallback), decimals: options?.decimals ?? 2, trimZeros: options?.trimZeros ?? true }, fallback);
        },
        timeTick(ms, options) {
            const fallback = (): string => base.timeTick(ms, options);
            if (typeof o.timeTick !== 'function') return fallback();
            return viaHost(o.timeTick, ms, { ...ctx(options.surface, 'timeAxis', options.timeZone, fallback), unit: options.unit, major: options.major, offsetMs: options.offsetMs ?? 0 }, fallback);
        },
        timeStamp(ms, options) {
            const fallback = (): string => base.timeStamp(ms, options);
            if (typeof o.timeStamp !== 'function') return fallback();
            return viaHost(o.timeStamp, ms, { ...ctx(options?.surface, 'crosshair', options?.timeZone, fallback), withTime: options?.withTime ?? true }, fallback);
        },
        duration(ms, options) {
            const fallback = (): string => base.duration(ms, options);
            if (typeof o.duration !== 'function') return fallback();
            return viaHost(o.duration, ms, { ...ctx(options?.surface, 'lastPrice', undefined, fallback), style: options?.style ?? 'countdown' }, fallback);
        },
        clock(ms, options) {
            const fallback = (): string => base.clock(ms, options);
            if (typeof o.clock !== 'function') return fallback();
            return viaHost(o.clock, ms, { ...ctx(options?.surface, 'clock', options?.timeZone, fallback), seconds: options?.seconds ?? true }, fallback);
        },
    };
}
