// The language of the UI kit's own words: a stepper's name, the color picker's opacity
// label, a menu star's name. A kit control takes a translator in its options; a chart
// building many controls at once (a settings dialog) runs the build inside
// `withKitTranslator`, and each control built there keeps that translator, so a popover
// it opens later speaks the same language. Anywhere else the kit speaks English. The scope is
// page-wide, so controls from another copy of the kit built inside it speak it too.
import type { Translator } from './i18n';
import { pageState } from './page';

const scope = pageState('kit-text@1', () => ({ current: null as Translator | null }));

/** Run `build` with `i18n` as the translator of every kit control it creates. */
export function withKitTranslator<T>(i18n: Translator | null | undefined, build: () => T): T {
    const previous = scope.current;
    scope.current = i18n ?? null;
    try {
        return build();
    } finally {
        scope.current = previous;
    }
}

/** The translator of the kit build in progress, or null (English) outside one. */
export function kitTranslator(): Translator | null {
    return scope.current;
}
