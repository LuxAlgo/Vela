// Vela's message system: plain strings stay verbatim, descriptors translate through the
// registered packs with English as the last fallback, and the ICU subset handles the plural
// rules of every launch language.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslator, msg, registerLocale, registeredLocales } from '../src/plugin';
import { fallbackChain } from '../src/core/i18n/locale';
import en from '../src/locales/en';

const disposers: Array<() => void> = [];
const register = (locale: string, messages: Record<string, string>): (() => void) => {
    const off = registerLocale({ locale, messages });
    disposers.push(off);
    return off;
};

afterEach(() => {
    while (disposers.length) disposers.pop()!();
    vi.restoreAllMocks();
});

const BARS = msg('test.bars', '{count, plural, one {# bar} other {# bars}}');

describe('messages', () => {
    it('a plain string label renders verbatim, braces and all', () => {
        const t = createTranslator({ locale: 'de' });
        expect(t.t('Volume {x}')).toBe('Volume {x}');
        expect(t.t("l'indicateur")).toBe("l'indicateur");
    });

    it("an untranslated message reads its English text, its numbers in the chart's locale", () => {
        const t = createTranslator({ locale: 'de' });
        expect(t.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Keyboard shortcuts');
        expect(t.t(BARS, { count: 1 })).toBe('1 bar');
        expect(t.t(BARS, { count: 1200 })).toBe('1.200 bars');
    });

    it('a registered pack translates a message, and its disposer removes the pack again', () => {
        const t = createTranslator({ locale: 'de' });
        const off = register('de', { 'test.title': 'Tastenkürzel' });
        expect(t.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Tastenkürzel');
        expect(registeredLocales()).toContain('de');
        off();
        expect(t.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Keyboard shortcuts');
        expect(registeredLocales()).not.toContain('de');
        off(); // a second call is harmless
    });

    it('a key missing from a pack falls back to English', () => {
        register('fr', { 'test.title': 'Raccourcis clavier' });
        const t = createTranslator({ locale: 'fr' });
        expect(t.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Raccourcis clavier');
        expect(t.t(msg('test.other', 'Mouse'))).toBe('Mouse');
    });

    it('a regional locale falls back to its language, then to English', () => {
        expect(fallbackChain('pt-BR')).toEqual(['pt-BR', 'pt-Latn', 'pt', 'en']);
        expect(fallbackChain('zh-TW')).toEqual(['zh-TW', 'zh-Hant', 'zh', 'en']);
        expect(fallbackChain('en-IN')).toEqual(['en-IN', 'en-Latn', 'en', 'en-US']);
        expect(fallbackChain('pt-PT')).toEqual(['pt-PT', 'pt-Latn', 'pt', 'pt-BR', 'en']);
        register('pt', { 'test.title': 'Atalhos (pt)' });
        register('zh-Hant', { 'test.title': '鍵盤快捷鍵' });
        register('es', { 'test.title': 'Atajos de teclado' });
        const title = msg('test.title', 'Keyboard shortcuts');
        expect(createTranslator({ locale: 'pt-BR' }).t(title)).toBe('Atalhos (pt)');
        expect(createTranslator({ locale: 'zh-TW' }).t(title)).toBe('鍵盤快捷鍵');
        expect(createTranslator({ locale: 'es-MX' }).t(title)).toBe('Atajos de teclado');
        expect(createTranslator({ locale: 'zh-Hans' }).t(title)).toBe('Keyboard shortcuts');
    });

    it('the more specific pack wins, and the pack registered last wins a tie', () => {
        register('pt', { 'test.title': 'genérico' });
        register('pt-BR', { 'test.title': 'Brasil' });
        expect(createTranslator({ locale: 'pt-BR' }).t(msg('test.title', 'x'))).toBe('Brasil');
        register('pt-BR', { 'test.title': 'Brasil, de novo' });
        expect(createTranslator({ locale: 'pt-BR' }).t(msg('test.title', 'x'))).toBe('Brasil, de novo');
    });

    it("message overrides beat the registered pack, and an English override rewords Vela's English", () => {
        register('de', { 'test.title': 'Tastenkürzel' });
        const t = createTranslator({ locale: 'de', messages: { 'test.title': 'Kurzbefehle' } as never });
        expect(t.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Kurzbefehle');
        const english = createTranslator({ messages: { 'test.title': 'Shortcuts' } as never });
        expect(english.t(msg('test.title', 'Keyboard shortcuts'))).toBe('Shortcuts');
    });

    it('a malformed translation falls back to English instead of breaking the chart', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        register('de', { 'test.bars': '{count, plural, one {# Balken' });
        const t = createTranslator({ locale: 'de' });
        expect(t.t(BARS, { count: 2 })).toBe('2 bars');
        expect(warn).toHaveBeenCalled();
    });

    it('registering a pack is a call: importing one registers nothing', () => {
        expect(registeredLocales()).toEqual([]);
        expect(en.locale).toBe('en');
        const off = registerLocale(en);
        expect(registeredLocales()).toEqual(['en']);
        off();
    });

    it('a pack must carry a locale and its messages', () => {
        expect(() => registerLocale({} as never)).toThrow(TypeError);
        expect(() => registerLocale({ locale: 'de' } as never)).toThrow(TypeError);
    });
});

describe('message syntax', () => {
    const t = createTranslator();

    it('names, numbers and select fill in their values', () => {
        expect(t.t(msg('test.a', 'Delta {value}'), { value: '1.2K' })).toBe('Delta 1.2K');
        expect(t.t(msg('test.b', '{n, number} of {total, number, integer}'), { n: 1234.5, total: 9876.5 })).toBe('1,234.5 of 9,877');
        const side = msg('test.c', '{side, select, buy {Bought} sell {Sold} other {Traded}}');
        expect(t.t(side, { side: 'buy' })).toBe('Bought');
        expect(t.t(side, { side: 'short' })).toBe('Traded');
        expect(t.t(msg('test.d', 'Hello {name}'))).toBe('Hello {name}');
    });

    it('exact matches and offsets win over the plural categories', () => {
        const m = msg('test.e', '{n, plural, offset:1 =0 {nobody} =1 {only {who}} one {{who} and # other} other {{who} and # others}}');
        expect(t.t(m, { n: 0, who: 'Ana' })).toBe('nobody');
        expect(t.t(m, { n: 1, who: 'Ana' })).toBe('only Ana');
        expect(t.t(m, { n: 2, who: 'Ana' })).toBe('Ana and 1 other');
        expect(t.t(m, { n: 5, who: 'Ana' })).toBe('Ana and 4 others');
    });

    it('ordinals pick their own categories', () => {
        const m = msg('test.f', '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
        expect([1, 2, 3, 4, 11, 21, 22].map((n) => t.t(m, { n }))).toEqual(['1st', '2nd', '3rd', '4th', '11th', '21st', '22nd']);
    });

    it("an apostrophe in a translation needs no escaping, and quoted braces stay literal", () => {
        register('fr', { 'test.g': "l'indicateur {name}", 'test.h': "'{name}' n''est pas {name}" });
        const fr = createTranslator({ locale: 'fr' });
        expect(fr.t(msg('test.g', 'the {name} indicator'), { name: 'RSI' })).toBe("l'indicateur RSI");
        expect(fr.t(msg('test.h', 'x'), { name: 'RSI' })).toBe("{name} n'est pas RSI");
    });
});

describe('plural rules of the launch languages', () => {
    it('Arabic picks among six forms', () => {
        register('ar', {
            'test.bars': '{count, plural, zero {لا أشرطة} one {شريط واحد} two {شريطان} few {# أشرطة} many {# شريطًا} other {# شريط}}',
        });
        const ar = createTranslator({ locale: 'ar' });
        expect([0, 1, 2, 3, 11, 100].map((count) => ar.t(BARS, { count }))).toEqual(['لا أشرطة', 'شريط واحد', 'شريطان', '3 أشرطة', '11 شريطًا', '100 شريط']);
    });

    it('Polish picks among one, few and many', () => {
        register('pl', { 'test.bars': '{count, plural, one {# świeca} few {# świece} many {# świec} other {# świecy}}' });
        const pl = createTranslator({ locale: 'pl' });
        expect([1, 2, 5, 22, 25, 1.5].map((count) => pl.t(BARS, { count }))).toEqual(['1 świeca', '2 świece', '5 świec', '22 świece', '25 świec', '1,5 świecy']);
    });

    it('Russian picks among one, few and many', () => {
        register('ru', { 'test.bars': '{count, plural, one {# свеча} few {# свечи} many {# свечей} other {# свечи}}' });
        const ru = createTranslator({ locale: 'ru' });
        expect([1, 21, 3, 5, 11, 111].map((count) => ru.t(BARS, { count }))).toEqual(['1 свеча', '21 свеча', '3 свечи', '5 свечей', '11 свечей', '111 свечей']);
    });
});
