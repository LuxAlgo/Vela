// The public vocabulary of Vela's message system (re-exported from `@luxalgo/vela/plugin`).
import type { VelaCoreMessageCatalog } from '../../locales/catalog';
import type { ResolvedFormatters, VelaFormatters } from '../format/types';
import type { MessageValues } from './icu';

export type { MessageValues };

/** A translatable message: a stable id and its English source text (ICU message syntax). */
export interface MessageDescriptor {
    readonly id: string;
    readonly defaultMessage: string;
    /** Values bound to the message's arguments (see `withValues`); values passed to `t()`
     *  take precedence. */
    readonly values?: MessageArgs;
}

/** Values a message's arguments take: text, numbers, or messages, which are translated
 *  first (`withValues(MOVE_TO, { pane: msg('…', 'Main chart') })`). */
export type MessageArgs = Readonly<Record<string, string | number | MessageDescriptor>>;

/** Display text: a plain string renders verbatim (untranslated); a descriptor is translated. */
export type MessageLike = string | MessageDescriptor;

/** One language's messages: id → ICU message. Several packs may share a locale. */
export interface LocalePack {
    /** BCP 47 tag: `'de'`, `'pt-BR'`, `'zh-Hant'`. */
    readonly locale: string;
    /** The direction the language reads in, set on right-to-left packs (`'rtl'`). It is
     *  information for the host: the chrome follows the `direction` option, and
     *  `direction: 'auto'` resolves to the same from the locale's script. */
    readonly direction?: TextDirection;
    readonly messages: Readonly<Record<string, string>>;
}

/**
 * Every message id Vela knows, generated from the `msg()` calls in the source. Plugins
 * and hosts add theirs by augmenting the interface, which types their `messages` overrides:
 *
 * ```ts
 * declare module '@luxalgo/vela/plugin' {
 *     interface VelaMessageCatalog { 'acme.panel.title': string }
 * }
 * ```
 */
export interface VelaMessageCatalog extends VelaCoreMessageCatalog {}

/** A known message id. */
export type VelaMessageId = keyof VelaMessageCatalog & string;

/** A writing direction. */
export type TextDirection = 'ltr' | 'rtl';

/**
 * Language, direction, text and number formatting of a chart, a workspace or the
 * deprecated widget. Every field is optional: with none set the chart reads exactly as
 * before (English, left to right, Western digits, 24-hour clock).
 */
export interface LocalizationOptions {
    /** BCP 47 tag for UI text, dates and numbers. Default `'en'`. Register the matching
     *  pack (`registerLocale`) for translated text; numbers and dates follow the tag
     *  without one. */
    locale?: string;
    /** Direction of the chart's chrome (toolbars, menus, dialogs, panels). `'auto'`
     *  follows the locale's script (Arabic, Hebrew, Persian, Urdu read right to left).
     *  Default `'ltr'`. The plot itself never mirrors: time runs left to right and the
     *  price axis stays on the right. */
    direction?: TextDirection | 'auto';
    /** Per-message overrides on top of the registered packs, for the current locale. */
    messages?: Partial<Record<VelaMessageId, string>>;
    /** Digits of every chart number. Default `'latn'`: Western digits in every language,
     *  Arabic included. `'locale'` uses the locale's own digits; any CLDR numbering
     *  system id (`'arab'`, `'deva'`, …) picks one. */
    numberingSystem?: 'latn' | 'locale' | (string & {});
    /** Clock of chart times. Default `'h23'` (`14:30`); `'h12'` for a 12-hour clock;
     *  `'locale'` follows the locale. */
    hourCycle?: 'h23' | 'h12' | 'locale';
    /** First day of the week in date pickers: 0 Sunday, 1 Monday, 6 Saturday. Default:
     *  the locale's (Sunday for `'en'`). */
    weekStart?: 0 | 1 | 6;
    /** Replace any chart formatter. Each receives the built-in result as `ctx.fallback()`. */
    formatters?: Partial<VelaFormatters>;
}

/**
 * A chart's translator (`chart.i18n`, `ctx.i18n`): its resolved locale settings, message
 * lookup and formatters. One object per chart for the chart's lifetime: after
 * `setLocale` it reads the new settings, so it is safe to keep.
 */
export interface Translator {
    /** The canonical locale tag. */
    readonly locale: string;
    /** The chrome direction (`'auto'` resolved). */
    readonly direction: TextDirection;
    /** The numbering system of chart numbers (`'latn'` unless asked otherwise). */
    readonly numberingSystem: string;
    /** The clock of chart times. */
    readonly hourCycle: 'h23' | 'h12' | 'locale';
    /** The first day of the week in date pickers (0 Sunday, 1 Monday, 6 Saturday). */
    readonly weekStart: 0 | 1 | 6;
    /**
     * Resolve display text. A plain string comes back verbatim. A descriptor resolves
     * through the `messages` overrides, then the registered packs for the locale and its
     * fallbacks (`pt-BR` → `pt` → `en`), then its English `defaultMessage`, and is
     * formatted with `values`. Never throws: a malformed translation falls back to English.
     */
    t(message: MessageLike, values?: MessageArgs): string;
    /** The chart's resolved formatters. */
    readonly format: ResolvedFormatters;
}

/** Payload of the `locale:changed` event. */
export interface LocaleChangedEvent {
    locale: string;
    direction: TextDirection;
}
