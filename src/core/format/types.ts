// The formatting vocabulary of chart text: what every built-in formatter receives, and the
// shape a host implements to replace one (`LocalizationOptions.formatters`).

/** Where a formatted value appears. Formatters may style a surface differently. */
export type FormatSurface =
    | 'priceAxis'
    | 'crosshair'
    | 'lastPrice'
    | 'statusLine'
    | 'dataWindow'
    | 'legend'
    | 'drawing'
    | 'timeAxis'
    | 'tooltip'
    | 'replay'
    | 'clock';

/** The calendar unit a time-axis tick marks. */
export type TimeTickUnit = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

/** What every host formatter receives besides its own fields. */
export interface FormatContext {
    /** The chart's locale (a BCP 47 tag). */
    readonly locale: string;
    /** The display time zone (an IANA id, or `'UTC'`). The date of a daily or coarser bar
     *  reads in `'UTC'` whatever the display zone. */
    readonly timeZone: string;
    /** Where the value appears. */
    readonly surface: FormatSurface;
    /** The built-in formatting of the same value — return it to keep the default. */
    fallback(): string;
}

/** Options of {@link ResolvedFormatters.price}. */
export interface PriceFormatOptions {
    surface?: FormatSurface;
    /** Fraction digits to show (the symbol's tick size or the axis zoom decides them). */
    decimals: number;
    /** The symbol's tick size, when known. */
    mintick?: number;
    /** `'price'` (default) formats a price; `'percent'` a percent change, signed;
     *  `'indexed'` a value indexed to 100. */
    mode?: 'price' | 'percent' | 'indexed';
    /** The pane the value belongs to. */
    paneId?: string;
    /** Insert the locale's group separators (`1,234.50`). Default false: axis labels stay
     *  ungrouped so they fit the fixed-width price gutter. */
    grouping?: boolean;
}

/** Options of {@link ResolvedFormatters.percent}. */
export interface PercentFormatOptions {
    surface?: FormatSurface;
    /** Fraction digits. Default 2. */
    decimals?: number;
    /** Always show the sign, `+` included. Default true. */
    signed?: boolean;
}

/** Options of {@link ResolvedFormatters.compact}. */
export interface CompactFormatOptions {
    surface?: FormatSurface;
    /** Maximum fraction digits. Default 2. */
    decimals?: number;
    /** Drop trailing zeros (`1.2M`); false keeps every digit (`1.20M`). Default true. */
    trimZeros?: boolean;
}

/** Options of {@link ResolvedFormatters.timeTick}. */
export interface TimeTickFormatOptions {
    surface?: FormatSurface;
    /** The calendar unit the tick marks. */
    unit: TimeTickUnit;
    /** A major tick (a day, month or year boundary) rather than an intermediate one. */
    major: boolean;
    /** The display time zone. Default `'UTC'`. */
    timeZone?: string;
    /** The zone's UTC offset in ms that the axis aligned the tick with (sampled once per
     *  visible range). `new Date(ms + offsetMs)` read with UTC getters is the wall-clock
     *  time the label names. Default 0. */
    offsetMs?: number;
}

/** Options of {@link ResolvedFormatters.timeStamp}. */
export interface TimeStampFormatOptions {
    surface?: FormatSurface;
    /** Append the time of day. Default true; false on daily and coarser bars. */
    withTime?: boolean;
    /** The display time zone. Default `'UTC'`. */
    timeZone?: string;
}

/** Options of {@link ResolvedFormatters.clock}. */
export interface ClockFormatOptions {
    surface?: FormatSurface;
    /** The zone whose wall clock to read (an IANA id). Default `'UTC'`. */
    timeZone?: string;
    /** Show the seconds. Default true. */
    seconds?: boolean;
}

/** Options of {@link ResolvedFormatters.duration}. */
export interface DurationFormatOptions {
    surface?: FormatSurface;
    /** `'countdown'` (default) reads like a clock (`04:59`, `1:01:05`); `'span'` names
     *  the units (`2d 4h`). */
    style?: 'countdown' | 'span';
}

/**
 * The resolved formatters of a chart (`chart.i18n.format`): the built-in formatting for
 * the chart's locale, with any host replacement applied. Every method returns plain text
 * without bidi control marks; right-to-left pages isolate numbers where they render.
 */
export interface ResolvedFormatters {
    /** A price, a percent change or an indexed value at a fixed number of decimals. */
    price(value: number, options: PriceFormatOptions): string;
    /** A percent value (`2.34` reads `+2.34%`). */
    percent(value: number, options?: PercentFormatOptions): string;
    /** A large magnitude abbreviated (`1.2M`, `120万`). */
    compact(value: number, options?: CompactFormatOptions): string;
    /** A time-axis label. */
    timeTick(ms: number, options: TimeTickFormatOptions): string;
    /** A full date, with the time of day unless `withTime` is false. */
    timeStamp(ms: number, options?: TimeStampFormatOptions): string;
    /** A length of time. */
    duration(ms: number, options?: DurationFormatOptions): string;
    /** A time of day in a zone, like a clock (`14:05:09`). */
    clock(ms: number, options?: ClockFormatOptions): string;
}

/** What a host price formatter receives. */
export type PriceFormatContext = FormatContext & {
    readonly decimals: number;
    readonly mintick?: number;
    readonly mode: 'price' | 'percent' | 'indexed';
    readonly paneId?: string;
    readonly grouping: boolean;
};
/** What a host percent formatter receives. */
export type PercentFormatContext = FormatContext & { readonly decimals: number; readonly signed: boolean };
/** What a host compact formatter receives. */
export type CompactFormatContext = FormatContext & { readonly decimals: number; readonly trimZeros: boolean };
/** What a host time-tick formatter receives. */
export type TimeTickFormatContext = FormatContext & { readonly unit: TimeTickUnit; readonly major: boolean; readonly offsetMs: number };
/** What a host time-stamp formatter receives. */
export type TimeStampFormatContext = FormatContext & { readonly withTime: boolean };
/** What a host duration formatter receives. */
export type DurationFormatContext = FormatContext & { readonly style: 'countdown' | 'span' };
/** What a host clock formatter receives. */
export type ClockFormatContext = FormatContext & { readonly seconds: boolean };

/**
 * Host replacements for chart formatting (`LocalizationOptions.formatters`). Supply any
 * subset; each receives the value and its context, and `ctx.fallback()` returns the
 * built-in result. A formatter that throws or returns a non-string falls back to the
 * built-in one.
 */
export interface VelaFormatters {
    price(value: number, ctx: PriceFormatContext): string;
    percent(value: number, ctx: PercentFormatContext): string;
    compact(value: number, ctx: CompactFormatContext): string;
    timeTick(ms: number, ctx: TimeTickFormatContext): string;
    timeStamp(ms: number, ctx: TimeStampFormatContext): string;
    duration(ms: number, ctx: DurationFormatContext): string;
    clock(ms: number, ctx: ClockFormatContext): string;
}

/** The resolved settings the built-in formatters read. */
export interface FormatSettings {
    /** Canonical BCP 47 tag. */
    readonly locale: string;
    /** Resolved numbering system id (`'latn'`, `'arab'`, …). */
    readonly numberingSystem: string;
    readonly hourCycle: 'h23' | 'h12' | 'locale';
    /** The locale's language is English: Vela's own English shapes apply. */
    readonly english: boolean;
}
