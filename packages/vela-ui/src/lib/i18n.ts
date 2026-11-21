// The kit's own words (a stepper's name, the color picker's opacity label): a message is a
// stable id and its English text, and a translator resolves it. Any object with a `t` method
// fits, Vela's translator included; without one the kit speaks English.

export interface MessageDescriptor {
    readonly id: string;
    readonly defaultMessage: string;
}

export interface Translator {
    t(message: MessageDescriptor | string): string;
    /** The locale tag (default English). Names months and weekdays in the date picker. */
    readonly locale?: string;
    /** The numbering system of digits (default `latn`). */
    readonly numberingSystem?: string;
    /** The first day of the week in date pickers (0 Sunday, 1 Monday, 6 Saturday). */
    readonly weekStart?: 0 | 1 | 6;
}

/** Declare a message. The build extracts every call with literal arguments into the English
 *  catalog, so keep both arguments string literals. */
export function msg(id: string, defaultMessage: string): MessageDescriptor {
    return Object.freeze({ id, defaultMessage });
}

/** A message in the translator's language, or its English text without one. */
export function textOf(i18n: Translator | null | undefined, message: MessageDescriptor | string): string {
    if (i18n) return i18n.t(message);
    return typeof message === 'string' ? message : message.defaultMessage;
}
