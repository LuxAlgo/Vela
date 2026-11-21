// Display text versus stored identity. A `MessageLike` renders through a translator, while
// the code that keys on a name (series ids, persisted option values, script-readable
// titles) reads its English source text, which no locale pack or override can change.
import { ENGLISH_SETTINGS } from '../format/formatters';
import { formatMessageNumber, localizeAscii } from '../format/numbers';
import { formatMessage } from './icu';
import { englishTranslator, formatSettingsOf, isMessageDescriptor, LocaleState, resolveArgs } from './translator';
import type { MessageArgs, MessageLike, Translator } from './types';

const ENGLISH_RUNTIME = {
    locale: 'en',
    formatNumber: (value: number, style?: string): string => formatMessageNumber(value, ENGLISH_SETTINGS, style),
};

/**
 * The English source text of display text, with its bound values: what identities key on.
 * Registered packs and `messages` overrides never change it. A plain string comes back as is.
 */
export function sourceText(message: MessageLike | null | undefined, values?: MessageArgs): string {
    if (message == null) return '';
    if (typeof message === 'string') return message;
    if (!isMessageDescriptor(message)) return String(message);
    const bound = message.values;
    const all = resolveArgs(bound ? (values ? { ...bound, ...values } : bound) : values, (m) => sourceText(m));
    try {
        return formatMessage(message.defaultMessage, all, ENGLISH_RUNTIME);
    } catch {
        return message.defaultMessage;
    }
}

/** Display text through `i18n`, or in English when no translator is at hand. */
export function textOf(i18n: Translator | null | undefined, message: MessageLike, values?: MessageArgs): string {
    return (i18n ?? englishTranslator()).t(message, values);
}

/** Upper-case text by the casing rules of `locale` (Turkish dotted İ, …); a tag the engine
 *  rejects falls back to the default rules. */
export function upperCase(text: string, locale: string | undefined): string {
    try {
        return text.toLocaleUpperCase(locale);
    } catch {
        return text.toUpperCase();
    }
}

/** Number text written with ASCII digits, `.` and `-` (a ratio, a `toFixed` price), in the
 *  digits and separators of `i18n`'s locale; unchanged in English. */
export function localizeNumberText(text: string, i18n: Translator | null | undefined): string {
    return localizeAscii(text, formatSettingsOf(i18n));
}

/**
 * When something happened (an alert fired), as a wall-clock time in the viewer's own zone.
 * Until the host chooses a locale it reads as the page has always written it (the browser's
 * conventions); once it does, it follows the chart's clock, digits and hour cycle.
 */
export function eventTimeText(ms: number, i18n: Translator | null | undefined): string {
    if (!i18n || (i18n instanceof LocaleState && !i18n.localeExplicit)) return new Date(ms).toLocaleTimeString();
    let timeZone: string | undefined;
    try {
        timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        timeZone = undefined;
    }
    return i18n.format.clock(ms, { surface: 'clock', ...(timeZone ? { timeZone } : {}) });
}

/**
 * The first `count` user-perceived characters of `text` (grapheme clusters: an emoji, a
 * letter with its accents, a Thai syllable stays whole), for truncating display text
 * without splitting a character in two. Counts code points where `Intl.Segmenter` is missing.
 */
export function sliceGraphemes(text: string, count: number): string {
    if (count <= 0) return '';
    // Printable ASCII has one character per UTF-16 unit: a plain slice is exact.
    if (/^[ -~]*$/.test(text)) return text.slice(0, count);
    const graphemes = textSegmenter(undefined, 'grapheme');
    if (graphemes) {
        let out = '';
        let n = 0;
        for (const { segment } of graphemes.segment(text)) {
            if (n++ >= count) break;
            out += segment;
        }
        return out;
    }
    return Array.from(text).slice(0, count).join('');
}

/** The part of `Intl.Segmenter` Vela uses (declared here: the ES2020 library types predate it). */
export interface TextSegmenter {
    segment(text: string): Iterable<{ segment: string; index: number; isWordLike?: boolean }>;
}

type SegmenterConstructor = new (locale?: string, options?: { granularity: 'grapheme' | 'word' }) => TextSegmenter;

const segmenters = new Map<string, TextSegmenter | null>();

/** An `Intl.Segmenter` for `locale` (graphemes or words), or null where the engine has none. */
export function textSegmenter(locale: string | undefined, granularity: 'grapheme' | 'word'): TextSegmenter | null {
    const key = `${locale ?? ''}|${granularity}`;
    let s = segmenters.get(key);
    if (s === undefined) {
        const Ctor = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
        try {
            s = Ctor ? new Ctor(locale, { granularity }) : null;
        } catch {
            s = null;
        }
        segmenters.set(key, s);
    }
    return s;
}
