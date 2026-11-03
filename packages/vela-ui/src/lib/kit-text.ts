// The language of the UI kit's own words: a stepper's name, the color picker's opacity
// label, a menu star's name. A kit control takes a translator in its options; a chart
// building many controls at once (a settings dialog) runs the build inside
// `withKitTranslator`, and each control built there keeps that translator, so a popover
// it opens later speaks the same language. Anywhere else the kit speaks English.
import type { Translator } from './i18n';

let scoped: Translator | null = null;

/** Run `build` with `i18n` as the translator of every kit control it creates. */
export function withKitTranslator<T>(i18n: Translator | null | undefined, build: () => T): T {
    const previous = scoped;
    scoped = i18n ?? null;
    try {
        return build();
    } finally {
        scoped = previous;
    }
}

/** The translator of the kit build in progress, or null (English) outside one. */
export function kitTranslator(): Translator | null {
    return scoped;
}
