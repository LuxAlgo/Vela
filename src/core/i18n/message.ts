import type { MessageArgs, MessageDescriptor } from './types';

/**
 * Declare a translatable message: a stable, dotted id and its English text in ICU message
 * syntax (`'{count, plural, one {# bar} other {# bars}}'`). The descriptor is inert data;
 * a translator's `t()` resolves it. The build extracts every `msg()` call with literal
 * arguments into the English catalog, so keep both arguments string literals.
 */
export function msg(id: string, defaultMessage: string): MessageDescriptor {
    return Object.freeze({ id, defaultMessage });
}

/**
 * A message with values bound to its arguments, for display text declared before its
 * values are known to the code that renders it (`withValues(BAND, { n: 2 })` reads
 * "Band #2"). A translator formats the bound values; values passed to `t()` win.
 */
export function withValues(message: MessageDescriptor, values: MessageArgs): MessageDescriptor {
    return Object.freeze({ id: message.id, defaultMessage: message.defaultMessage, values: { ...message.values, ...values } });
}
