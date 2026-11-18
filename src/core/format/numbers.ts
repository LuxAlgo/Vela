// Built-in number formatting for chart text. English keeps Vela's established shapes
// (`toFixed` on the axes, en-US grouping in the status line) so its output never moves;
// other languages take their separators, signs and abbreviations from `Intl`. Every
// `Intl` object is cached per locale and options: the status line formats on each
// pointer move and the axes on every frame.
import type { CompactFormatOptions, FormatSettings, PercentFormatOptions, PriceFormatOptions } from './types';

/** LRM, RLM and ALM: `Intl` wraps signs in them for right-to-left pages. Chart numbers
 *  render as left-to-right runs wherever they appear, so the marks are dropped. */
const BIDI_MARKS = /[‎‏؜]/g;

export function stripBidiMarks(text: string): string {
    return text.replace(BIDI_MARKS, '');
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A cached `Intl.NumberFormat` for the settings' locale and numbering system. */
export function numberFormat(settings: Pick<FormatSettings, 'locale' | 'numberingSystem'>, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const key = `${settings.locale}|${settings.numberingSystem}|${JSON.stringify(options)}`;
    let nf = numberFormats.get(key);
    if (!nf) {
        try {
            nf = new Intl.NumberFormat(settings.locale, { ...options, numberingSystem: settings.numberingSystem });
        } catch {
            nf = new Intl.NumberFormat('en', options);
        }
        numberFormats.set(key, nf);
    }
    return nf;
}

/** The symbols an ASCII `toFixed` string maps onto for a locale. */
interface NumberSymbols {
    /** True when the locale writes `toFixed` output unchanged (`.` decimal, `-`, ASCII digits). */
    ascii: boolean;
    decimal: string;
    minus: string;
    digits: readonly string[];
}

const symbolCache = new Map<string, NumberSymbols>();

function numberSymbols(settings: Pick<FormatSettings, 'locale' | 'numberingSystem'>): NumberSymbols {
    const key = `${settings.locale}|${settings.numberingSystem}`;
    let sym = symbolCache.get(key);
    if (sym) return sym;
    const parts = numberFormat(settings, { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 }).formatToParts(-1.5);
    const decimal = stripBidiMarks(parts.find((p) => p.type === 'decimal')?.value ?? '.') || '.';
    const minus = stripBidiMarks(parts.find((p) => p.type === 'minusSign')?.value ?? '-') || '-';
    const plain = numberFormat(settings, { useGrouping: false, maximumFractionDigits: 0 });
    const digits = Array.from({ length: 10 }, (_, d) => stripBidiMarks(plain.format(d)));
    const ascii = decimal === '.' && minus === '-' && digits.every((d, i) => d === String(i));
    sym = { ascii, decimal, minus, digits };
    symbolCache.set(key, sym);
    return sym;
}

/** Rewrite ASCII number text (digits, `.`, `-`) in the locale's symbols. */
export function localizeAscii(text: string, settings: Pick<FormatSettings, 'locale' | 'numberingSystem'>): string {
    const sym = numberSymbols(settings);
    if (sym.ascii) return text;
    let out = '';
    for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 48 && code <= 57) out += sym.digits[code - 48];
        else if (ch === '.') out += sym.decimal;
        else if (ch === '-') out += sym.minus;
        else out += ch;
    }
    return out;
}

/** Only the digits of ASCII text, in the settings' numbering system (clock-like text). */
export function localizeDigits(text: string, settings: Pick<FormatSettings, 'locale' | 'numberingSystem'>): string {
    const sym = numberSymbols(settings);
    if (sym.digits.every((d, i) => d === String(i))) return text;
    return text.replace(/[0-9]/g, (d) => sym.digits[Number(d)]!);
}

const clampDecimals = (d: number): number => (Number.isFinite(d) ? Math.max(0, Math.min(20, Math.trunc(d))) : 2);

/** Decimal places needed to write a tick size, including increments like 0.25.
 * Round-trip within a tolerance for floating-point noise. Capped at eight. */
export function tickDecimals(tick: number): number {
    if (!(tick > 0) || !Number.isFinite(tick)) return 2;
    for (let d = 0; d <= 8; d += 1) {
        if (Math.abs(Number(tick.toFixed(d)) - tick) <= tick * 1e-6) return d;
    }
    return 8;
}

/** A fixed-decimals number without grouping. `toFixed` decides the rounding in every
 *  locale, so a price rounds the same whatever the language. */
export function formatFixed(value: number, decimals: number, settings: FormatSettings): string {
    return localizeAscii(value.toFixed(clampDecimals(decimals)), settings);
}

/** A fixed-decimals number with the locale's group separators (en: `1,234.50`). */
export function formatGrouped(value: number, decimals: number, settings: FormatSettings): string {
    const d = clampDecimals(decimals);
    return stripBidiMarks(numberFormat(settings, { minimumFractionDigits: d, maximumFractionDigits: d }).format(value));
}

/** A plain number for message arguments (`{n}`, `{n, number}`): grouped, up to three
 *  fraction digits, in the settings' numbering system. */
export function formatMessageNumber(value: number, settings: FormatSettings, style?: string): string {
    if (style === 'integer') return stripBidiMarks(numberFormat(settings, { maximumFractionDigits: 0 }).format(value));
    if (style === 'percent') return stripBidiMarks(numberFormat(settings, { style: 'percent' }).format(value));
    return stripBidiMarks(numberFormat(settings, {}).format(value));
}

export function formatPercent(value: number, options: PercentFormatOptions | undefined, settings: FormatSettings): string {
    const d = clampDecimals(options?.decimals ?? 2);
    const signed = options?.signed ?? true;
    if (settings.english) {
        const text = signed ? `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(d)}%` : `${value.toFixed(d)}%`;
        return localizeAscii(text, settings);
    }
    const nf = numberFormat(settings, { style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: signed ? 'always' : 'auto' });
    return stripBidiMarks(nf.format(value / 100));
}

export function formatPrice(value: number, options: PriceFormatOptions, settings: FormatSettings): string {
    const mode = options.mode ?? 'price';
    if (mode === 'percent') return formatPercent(value, { decimals: options.decimals, signed: true }, settings);
    if (mode === 'indexed' || !options.grouping) return formatFixed(value, options.decimals, settings);
    return formatGrouped(value, options.decimals, settings);
}

const COMPACT_STEPS: ReadonlyArray<readonly [number, string]> = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
];

/** A magnitude abbreviated for volume readouts. English keeps Vela's `K`/`M`/`B` with two
 *  decimals (`trimZeros` drops trailing zeros: `1.2M`; without it: `1.20M`); other
 *  languages use the locale's compact notation (`120万`, `1,2 Mio.`). */
export function formatCompact(value: number, options: CompactFormatOptions | undefined, settings: FormatSettings): string {
    const d = clampDecimals(options?.decimals ?? 2);
    const trim = options?.trimZeros ?? true;
    if (settings.english) {
        const a = Math.abs(value);
        let div = 1;
        let suffix = '';
        for (const [step, s] of COMPACT_STEPS) {
            if (a >= step) {
                div = step;
                suffix = s;
                break;
            }
        }
        const scaled = value / div;
        const text = trim ? Number(scaled.toFixed(d)).toString() : scaled.toFixed(d);
        return localizeAscii(text, settings) + suffix;
    }
    const nf = numberFormat(settings, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: d, minimumFractionDigits: trim ? 0 : d });
    return stripBidiMarks(nf.format(value));
}
