// Vela's message system: `msg()` descriptors, locale packs, and the per-chart translator.
export { msg, withValues } from './message';
export { sourceText, textOf, upperCase, localizeNumberText, sliceGraphemes, eventTimeText } from './text';
export { registerLocale, registeredLocales } from './registry';
export { createTranslator, englishTranslator, formatSettingsOf, isMessageDescriptor, LocaleState } from './translator';
export { canonicalLocale, fallbackChain, localeDirection } from './locale';
export type {
    MessageDescriptor,
    MessageLike,
    MessageValues,
    MessageArgs,
    LocalePack,
    VelaMessageCatalog,
    VelaMessageId,
    TextDirection,
    LocalizationOptions,
    Translator,
    LocaleChangedEvent,
} from './types';
