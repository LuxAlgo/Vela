// The chart's translator: resolved locale settings, message lookup and formatters, in one
// object that stays the same across `setLocale` (it re-resolves in place).
import { localeWeekStart } from '../format/calendar';
import { resolveFormatters } from '../format/formatters';
import { formatMessageNumber } from '../format/numbers';
import type { FormatSettings, ResolvedFormatters } from '../format/types';
import { formatMessage, type MessageValues } from './icu';
import { canonicalLocale, fallbackChain, languageOf, localeDirection, resolveNumberingSystem } from './locale';
import { messagesFor } from './registry';
import type { LocalizationOptions, MessageArgs, MessageLike, TextDirection, Translator } from './types';

/** True for a {@link MessageDescriptor}-shaped value. */
export function isMessageDescriptor(m: unknown): m is { id: string; defaultMessage: string } {
    return typeof m === 'object' && m !== null && typeof (m as { id?: unknown }).id === 'string' && typeof (m as { defaultMessage?: unknown }).defaultMessage === 'string';
}

const LOCALIZATION_KEYS = ['locale', 'direction', 'messages', 'numberingSystem', 'hourCycle', 'weekStart', 'formatters'] as const;

/** The localization fields an options object carries: present keys only, so an explicit
 *  `undefined` reaches `setLocale` as "restore the default". */
export function pickLocalization(options: LocalizationOptions): LocalizationOptions {
    const out: Record<string, unknown> = {};
    for (const key of LOCALIZATION_KEYS) if (key in options) out[key] = options[key];
    return out as LocalizationOptions;
}

let warnedSyntax = false;

/** Message arguments with nested messages resolved through `resolve` (null when none). */
export function resolveArgs(args: MessageArgs | undefined, resolve: (m: MessageLike) => string): MessageValues | undefined {
    if (!args) return undefined;
    let out: Record<string, string | number> | null = null;
    for (const key of Object.keys(args)) {
        const v = args[key]!;
        if (typeof v === 'object' && v !== null) {
            out ??= { ...(args as Record<string, string | number>) };
            out[key] = resolve(v);
        }
    }
    return out ?? (args as MessageValues);
}

/** The concrete translator. Hosts receive it as {@link Translator}. */
export class LocaleState implements Translator {
    private opts: LocalizationOptions;
    private settings!: FormatSettings;
    private chain!: string[];
    private resolvedDirection!: TextDirection;
    private resolvedWeekStart!: 0 | 1 | 6;
    private formatters!: ResolvedFormatters;
    private readonly runtime = {
        locale: 'en',
        formatNumber: (value: number, style?: string): string => formatMessageNumber(value, this.settings, style),
    };

    constructor(options: LocalizationOptions = {}) {
        this.opts = { ...options };
        this.resolve();
    }

    /** The options as last set (unresolved). */
    get options(): Readonly<LocalizationOptions> {
        return this.opts;
    }

    /** Whether the host chose a locale; Vela stamps `lang` only then. */
    get localeExplicit(): boolean {
        return this.opts.locale !== undefined;
    }

    /** Whether the host chose a direction; Vela stamps `dir` only then. */
    get directionExplicit(): boolean {
        return this.opts.direction !== undefined;
    }

    /** Apply a change: fields present in `next` replace (an explicit `undefined` restores
     *  the default), absent fields keep their current value. */
    update(next: LocalizationOptions | string): void {
        const patch: LocalizationOptions = typeof next === 'string' ? { locale: next } : next;
        this.opts = { ...this.opts, ...patch };
        for (const key of Object.keys(this.opts) as Array<keyof LocalizationOptions>) {
            if (this.opts[key] === undefined) delete this.opts[key];
        }
        this.resolve();
    }

    private resolve(): void {
        const o = this.opts;
        const locale = canonicalLocale(o.locale);
        const numberingSystem = resolveNumberingSystem(locale, o.numberingSystem);
        const hourCycle = o.hourCycle === 'h12' || o.hourCycle === 'locale' ? o.hourCycle : 'h23';
        this.settings = { locale, numberingSystem, hourCycle, english: languageOf(locale) === 'en' };
        this.chain = fallbackChain(locale);
        this.resolvedDirection = o.direction === 'rtl' || o.direction === 'ltr' ? o.direction : o.direction === 'auto' ? localeDirection(locale) : 'ltr';
        this.resolvedWeekStart = o.weekStart === 0 || o.weekStart === 1 || o.weekStart === 6 ? o.weekStart : localeWeekStart(locale);
        this.runtime.locale = locale;
        this.formatters = resolveFormatters(this.settings, o.formatters);
    }

    get locale(): string {
        return this.settings.locale;
    }

    get direction(): TextDirection {
        return this.resolvedDirection;
    }

    get numberingSystem(): string {
        return this.settings.numberingSystem;
    }

    get hourCycle(): 'h23' | 'h12' | 'locale' {
        return this.settings.hourCycle;
    }

    get weekStart(): 0 | 1 | 6 {
        return this.resolvedWeekStart;
    }

    get format(): ResolvedFormatters {
        return this.formatters;
    }

    /** The resolved settings the built-in formatters and calendar helpers read. */
    get formatSettings(): FormatSettings {
        return this.settings;
    }

    t(message: MessageLike, args?: MessageArgs): string {
        if (typeof message === 'string') return message;
        if (!isMessageDescriptor(message)) return message == null ? '' : String(message);
        const { id, defaultMessage } = message;
        const bound = (message as { values?: MessageArgs }).values;
        const values = resolveArgs(bound ? (args ? { ...bound, ...args } : bound) : args, (m) => this.t(m));
        const override = (this.opts.messages as Readonly<Record<string, string | undefined>> | undefined)?.[id];
        const source = typeof override === 'string' ? override : (messagesFor(this.chain).get(id) ?? defaultMessage);
        try {
            return formatMessage(source, values, this.runtime);
        } catch (err) {
            if (!warnedSyntax) {
                warnedSyntax = true;
                console.warn(`[vela] message "${id}" could not be formatted; the English text is used instead.`, err);
            }
            if (source === defaultMessage) return defaultMessage;
            try {
                return formatMessage(defaultMessage, values, this.runtime);
            } catch {
                return defaultMessage;
            }
        }
    }
}

/**
 * A standalone translator for UI built outside a chart (a kit component, a host panel).
 * Charts, workspaces and widgets carry their own as `i18n`.
 */
export function createTranslator(options?: LocalizationOptions): Translator {
    return new LocaleState(options);
}

let english: LocaleState | null = null;

/** The English translator components fall back to when none is handed in. */
export function englishTranslator(): LocaleState {
    english ??= new LocaleState();
    return english;
}

/** The format settings behind any translator (Vela's own, or a host implementation). */
export function formatSettingsOf(i18n: Translator | null | undefined): FormatSettings {
    if (i18n instanceof LocaleState) return i18n.formatSettings;
    if (!i18n) return englishTranslator().formatSettings;
    return { locale: i18n.locale, numberingSystem: i18n.numberingSystem, hourCycle: i18n.hourCycle, english: languageOf(i18n.locale) === 'en' };
}
