import { formatGrouped, tickDecimals } from '../format/numbers';
import type { FormatSettings } from '../format/types';
import { msg } from '../i18n/message';
import { textOf } from '../i18n/text';
import { englishTranslator, formatSettingsOf } from '../i18n/translator';
import type { MessageLike, Translator } from '../i18n/types';
import type { DrawingPoint, Projector } from './geometry';

/** A symbol's price increments on a pane. */
export interface PriceSteps {
    /** The smallest price increment. */
    tick: number;
    /** One pip, for a symbol quoted in pips (a currency pair): moves count in pips, not ticks. */
    pip?: number;
}

/** A move between two values on a pane, before formatting. */
export interface PriceMove {
    /** The move, snapped to whole ticks when the pane's tick size is known. */
    delta: number;
    /** Fraction digits the move reads at. */
    decimals: number;
    /** The move as a percent of the start value's size; null when the start is zero. */
    percent: number | null;
    /** The move in pips or whole ticks; null when the pane's tick size is unknown. */
    steps: { unit: 'pip' | 'tick'; value: number; decimals: number } | null;
}

/** Decimals for a move on a pane with no known tick size, from the size of its values. */
function fallbackDecimals(a: number, b: number): number {
    const size = Math.max(Math.abs(a), Math.abs(b));
    return size >= 1 ? 2 : size >= 0.01 ? 4 : 6;
}

const finitePositive = (n: number | undefined): n is number => n !== undefined && n > 0 && Number.isFinite(n);

/**
 * The move from `from` to `to` on a pane. With a known tick size the move snaps to whole
 * ticks, so the price, the percent and the step count agree with each other. The percent is
 * taken against the start's size, so a rise reads positive on a series below zero too.
 */
export function priceMove(from: number, to: number, proj: Projector, paneId: string): PriceMove {
    const steps = proj.priceSteps?.(paneId);
    const tick = finitePositive(steps?.tick) ? steps!.tick : undefined;
    const ticks = tick ? Math.round((to - from) / tick) : 0;
    const delta = tick ? ticks * tick : to - from;
    const decimals = proj.priceDecimals?.(paneId) ?? (tick ? tickDecimals(tick) || 2 : fallbackDecimals(from, to)); // like the axis: never a bare integer
    const base = Math.abs(from);
    const percent = base > 0 ? (delta / base) * 100 : null;
    let move: PriceMove['steps'] = null;
    if (tick) {
        const pip = steps?.pip;
        move = finitePositive(pip)
            ? { unit: 'pip', value: delta / pip, decimals: Math.max(0, tickDecimals(tick) - tickDecimals(pip)) }
            : { unit: 'tick', value: ticks, decimals: 0 };
    }
    return { delta, decimals, percent, steps: move };
}

/** The measure label's words; numbers come formatted (`count` picks the plural form). */
const MEASURE_TEXT = {
    headline: msg('drawing.measure.headline', '{move} · {percent}%'),
    pips: msg('drawing.measure.pips', '{count, plural, one {{pips} pip} other {{pips} pips}}'),
    ticks: msg('drawing.measure.ticks', '{count, plural, one {{ticks} tick} other {{ticks} ticks}}'),
    bars: msg('drawing.measure.bars', '{count, plural, one {{bars} bar} other {{bars} bars}}'),
};

const SEPARATOR = ' · ';

/** Letters of the right-to-left scripts Vela ships packs for (Hebrew, Arabic). */
const RTL_LETTERS = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const LRI = '\u2066';
const RLI = '\u2067';
const PDI = '\u2069';

/**
 * One label segment from a message. The plot paints left to right, where the bidi algorithm
 * would carry a number's sign to its far end once the number stands beside Arabic or Hebrew
 * words; so in a segment with such words each of its `numbers` is isolated left to right.
 */
function segment(i18n: Translator | undefined, message: MessageLike, args: Record<string, string | number>, numbers: readonly string[]): string {
    const text = textOf(i18n, message, args);
    if (!RTL_LETTERS.test(text)) return text;
    const isolated = { ...args };
    for (const key of numbers) isolated[key] = `${LRI}${String(args[key])}${PDI}`;
    return textOf(i18n, message, isolated);
}

/** A line with Arabic or Hebrew words reads right to left, its first segment on the right. */
const directed = (line: string): string => (RTL_LETTERS.test(line) ? `${RLI}${line}${PDI}` : line);

/** `n` at `decimals` in the locale's digits and grouping: `+` when it rises, a true minus
 *  when it falls, no sign when it rounds to zero. */
function signedNumber(n: number, decimals: number, settings: FormatSettings): string {
    const size = Number(Math.abs(n).toFixed(decimals));
    const text = formatGrouped(size, decimals, settings);
    return size === 0 ? text : `${n > 0 ? '+' : '−'}${text}`;
}

/**
 * The measure label between two points: a headline with the move and its percent, then a
 * detail line with the rest (the pips or the ticks, the bars and the time). `show` drops the
 * price or the time parts. Painters draw every line after the first in a quieter tone.
 */
export function measureLines(
    a: DrawingPoint,
    b: DrawingPoint,
    proj: Projector,
    paneId: string,
    i18n?: Translator,
    show: { price: boolean; time: boolean } = { price: true, time: true },
): string[] {
    const settings = formatSettingsOf(i18n);
    const lines: string[] = [];
    const detail: string[] = [];
    if (show.price) {
        const m = priceMove(a.price, b.price, proj, paneId);
        const change = signedNumber(m.delta, m.decimals, settings);
        let steps: string | null = null;
        if (m.steps) {
            const count = Number(Math.abs(m.steps.value).toFixed(m.steps.decimals));
            const value = signedNumber(m.steps.value, m.steps.decimals, settings);
            steps =
                m.steps.unit === 'pip'
                    ? segment(i18n, MEASURE_TEXT.pips, { count, pips: value }, ['pips'])
                    : segment(i18n, MEASURE_TEXT.ticks, { count, ticks: value }, ['ticks']);
        }
        lines.push(m.percent == null ? change : segment(i18n, MEASURE_TEXT.headline, { move: change, percent: signedNumber(m.percent, 2, settings) }, ['move', 'percent']));
        if (steps) detail.push(steps);
    }
    if (show.time) {
        const bars = proj.barsBetween ? Math.round(proj.barsBetween(a.time, b.time)) : null;
        if (bars != null) detail.push(segment(i18n, MEASURE_TEXT.bars, { count: bars, bars: formatGrouped(bars, 0, settings) }, ['bars']));
        detail.push((i18n ?? englishTranslator()).format.duration(b.time - a.time, { style: 'span', surface: 'drawing' }));
    }
    if (detail.length) lines.push(detail.join(SEPARATOR));
    return lines.map(directed);
}
