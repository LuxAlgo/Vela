// @vitest-environment jsdom
// The language packs Vela publishes (`@luxalgo/vela/locales/<tag>`). Each pack names only
// messages English has, and every message keeps working in its language. Once a workspace
// reads in that language, the only English on screen is names, acronyms, and the messages
// the pack does not have yet: a pack may trail English, but no text may bypass the packs.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { createTranslator, msg, registerLocale, type LocalePack } from '../src/plugin';
import { parseMessage } from '../src/core/i18n/icu';
import { canonicalLocale, localeDirection } from '../src/core/i18n/locale';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import english from '../src/locales/en.json';
import { shownStrings } from './support/shown-text';

type PackGlob = (patterns: string[], options: { import: string; eager: true }) => Record<string, LocalePack>;
const packFiles = (import.meta as unknown as { glob: PackGlob }).glob(['../src/locales/*.ts', '!../src/locales/*.d.ts', '!../src/locales/en.ts'], {
    import: 'default',
    eager: true,
});

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

/** Every translated pack with the tag its file is published under and its language's name. */
const packs = Object.entries(packFiles)
    .map(([file, pack]) => {
        const tag = file.slice('../src/locales/'.length, -'.ts'.length);
        return { tag, language: languageNames.of(tag) ?? tag, pack };
    })
    .sort((a, b) => a.tag.localeCompare(b.tag));

/** The packs as `describe.each` rows: the language's name first, for the suite's title. */
const byLanguage = packs.map((p) => [p.language, p] as const);

const ENGLISH = english as Record<string, string>;

/** Names written the same in every language. */
const PRODUCT_NAMES = ['LuxAlgo', 'Vela', 'Quant', 'PineTS', 'Pine Script®'];

type Nodes = ReturnType<typeof parseMessage>;

/** The values a message takes, each with its kind: `count:plural`, `price:number/integer`. */
function argumentShape(message: string): string[] {
    const out = new Set<string>();
    const walk = (nodes: Nodes): void => {
        for (const n of nodes) {
            if (typeof n === 'string' || n.kind === 'pound') continue;
            if (n.kind === 'arg') out.add(`${n.name}:${n.format ?? 'text'}${n.style ? `/${n.style}` : ''}`);
            else {
                out.add(`${n.name}:${n.kind === 'select' ? 'select' : n.ordinal ? 'selectordinal' : 'plural'}`);
                for (const branch of Object.values(n.options)) walk(branch);
            }
        }
    };
    walk(parseMessage(message));
    return [...out].sort();
}

/** Every plural in a message: whether it counts ordinals, and the forms it writes. */
function plurals(message: string): Array<{ ordinal: boolean; forms: string[] }> {
    const out: Array<{ ordinal: boolean; forms: string[] }> = [];
    const walk = (nodes: Nodes): void => {
        for (const n of nodes) {
            if (typeof n === 'string' || n.kind === 'pound' || n.kind === 'arg') continue;
            if (n.kind === 'plural') out.push({ ordinal: n.ordinal, forms: Object.keys(n.options).filter((k) => !k.startsWith('=')) });
            for (const branch of Object.values(n.options)) walk(branch);
        }
    };
    walk(parseMessage(message));
    return out;
}

/** The literal text of a message, without its argument syntax. */
function literalText(message: string): string {
    let out = '';
    const walk = (nodes: Nodes): void => {
        for (const n of nodes) {
            if (typeof n === 'string') out += ` ${n}`;
            else if (n.kind === 'plural' || n.kind === 'select') for (const branch of Object.values(n.options)) walk(branch);
        }
    };
    walk(parseMessage(message));
    return out;
}

/** Runs of Latin letters (accents included), so a Latin word inside other scripts stands alone. */
const LATIN_WORD = /[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*/gu;

function latinWords(text: string): string[] {
    return text.match(LATIN_WORD) ?? [];
}

const wordsOf = (messages: readonly string[]): Set<string> => new Set(messages.flatMap((m) => latinWords(literalText(m)).map((w) => w.toLowerCase())));

/** Every word English writes, lower-cased. */
const englishWords = wordsOf(Object.values(ENGLISH));

/** Messages that are names (an indicator, a city, a chart type): a language may keep them
 *  exactly as English writes them. */
const NAME_ID = /^(indicator\.[A-Za-z0-9]+\.(title|shortTitle)|timezone\.[A-Z][A-Za-z]*\.[A-Za-z.]+|chart\.priceStyle\.[A-Za-z]+)$/;

/** True for text of two words or more. A single word a language writes the same as English
 *  is often its own word too ("Animation", "Horizontal", "Futures"); a whole phrase is not. */
const isPhrase = (message: string): boolean => /\p{L}{3,}.*\s.*\p{L}{3,}/u.test(literalText(message).trim());

/** The words a pack writes in its own language: its translated messages and the names it
 *  keeps as written. A phrase the pack leaves exactly as English is no translation. */
function packWords(pack: LocalePack): Set<string> {
    return wordsOf(
        Object.entries(pack.messages)
            .filter(([id, text]) => text !== ENGLISH[id] || !isPhrase(text) || NAME_ID.test(id))
            .map(([, text]) => text),
    );
}

/** The literal pieces of a message's text, between and inside its arguments. */
function literalPieces(message: string): string[] {
    const out: string[] = [];
    const walk = (nodes: Nodes): void => {
        for (const n of nodes) {
            if (typeof n === 'string') out.push(n.trim());
            else if (n.kind === 'plural' || n.kind === 'select') for (const branch of Object.values(n.options)) walk(branch);
        }
    };
    walk(parseMessage(message));
    return out.filter((piece) => /\p{L}/u.test(piece));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The English text of the messages a pack lacks, which read in English by design until the
 *  pack catches up: longest first, each matched as whole words. */
function fallbackText(pack: LocalePack): RegExp[] {
    return Object.keys(ENGLISH)
        .filter((id) => !(id in pack.messages))
        .flatMap((id) => literalPieces(ENGLISH[id]!))
        .sort((a, b) => b.length - a.length)
        .map((piece) => new RegExp(`(?<!\\p{L})${escapeRegExp(piece)}(?!\\p{L})`, 'gu'));
}

/**
 * The English words left on screen in a pack's language: a word English writes that is
 * neither in the pack's own text nor in the English fallback of a message the pack lacks.
 * A name the pack keeps (Vela, Heikin Ashi), an acronym (RSI, UTC), a unit letter and a
 * symbol from the data are no English words. What remains is text written outside any
 * message, or a message the pack leaves exactly as English.
 */
function englishLeft(root: Element, pack: LocalePack): string[] {
    const own = packWords(pack);
    const fallbacks = fallbackText(pack);
    const left = new Set<string>();
    for (const shown of shownStrings(root)) {
        let rest = shown;
        for (const fallback of fallbacks) rest = rest.replace(fallback, ' ');
        for (const word of latinWords(rest)) {
            if (word.length < 2 || !/^[A-Za-z]+(?:['’][A-Za-z]+)*$/.test(word) || /^[A-Z]+s?$/.test(word)) continue;
            const lower = word.toLowerCase();
            if (englishWords.has(lower) && !own.has(lower)) left.add(`${word} (in "${shown.trim()}")`);
        }
    }
    return [...left];
}

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The title id of a built-in indicator the pack translates, the RSI's when it does. */
function translatedIndicatorTitle(pack: LocalePack): string {
    const translates = (id: string): boolean => pack.messages[id] !== undefined && pack.messages[id] !== ENGLISH[id];
    if (translates('indicator.rsi.title')) return 'indicator.rsi.title';
    return Object.keys(ENGLISH).find((id) => /^indicator\.[A-Za-z0-9]+\.title$/.test(id) && translates(id))!;
}

/** Opening a workspace and walking its dialogs is heavy work in jsdom. */
const WORKSPACE_TIMEOUT = 30_000;

/** A workspace switched to `pack`'s language at runtime, the way a host does it. */
function workspaceIn(pack: LocalePack, options: Record<string, unknown> = {}): { host: HTMLElement; ws: VelaWorkspace } {
    disposers.push(registerLocale(pack));
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '2h', ...options } as never);
    disposers.push(() => ws.destroy());
    ws.setLocale(pack.locale);
    return { host, ws };
}

describe.each(byLanguage)('the %s language pack', (_language, { tag, pack }) => {
    it('is published under its own language tag, and says so when the language reads right to left', () => {
        expect(pack.locale).toBe(tag);
        expect(canonicalLocale(tag)).toBe(tag);
        expect(pack.direction ?? 'ltr').toBe(localeDirection(tag));
    });

    it('names only messages English has, so it carries no stale or misspelled id', () => {
        const unknown = Object.keys(pack.messages).filter((id) => !(id in ENGLISH));
        expect(unknown).toEqual([]);
    });

    // Each check collects every offending message, so one run names them all.
    const known = (): Array<[string, string]> => Object.entries(pack.messages).filter(([id]) => id in ENGLISH);

    it("reads every message with the chart's own message parser, taking the same values as English", () => {
        const problems: string[] = [];
        for (const [id, text] of known()) {
            try {
                const shape = argumentShape(text).join(', ');
                const english = argumentShape(ENGLISH[id]!).join(', ');
                if (shape !== english) problems.push(`${id}: takes {${shape}}, English takes {${english}}`);
            } catch (err) {
                problems.push(`${id}: ${(err as Error).message}`);
            }
        }
        expect(problems).toEqual([]);
    });

    it('writes every count the way its language does, with each plural form the language needs', () => {
        const cardinal = new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
        const ordinal = new Intl.PluralRules(tag, { type: 'ordinal' }).resolvedOptions().pluralCategories;
        const problems: string[] = [];
        for (const [id, text] of known()) {
            let found: Array<{ ordinal: boolean; forms: string[] }>;
            try {
                found = plurals(text);
            } catch {
                continue; // a message that does not parse fails the parser check above
            }
            for (const p of found) {
                const missing = (p.ordinal ? ordinal : cardinal).filter((form) => !p.forms.includes(form));
                if (missing.length) problems.push(`${id}: lacks ${missing.join(', ')}`);
            }
        }
        expect(problems).toEqual([]);
    });

    it('keeps the product names as written', () => {
        const problems: string[] = [];
        for (const [id, text] of known()) {
            for (const name of PRODUCT_NAMES) if (ENGLISH[id]!.includes(name) && !text.includes(name)) problems.push(`${id}: drops ${name}`);
        }
        expect(problems).toEqual([]);
    });

    it('writes numbers with Western digits only', () => {
        const otherDigits = Object.entries(pack.messages)
            .filter(([, text]) => /(?![0-9])\p{Nd}/u.test(text))
            .map(([id]) => id);
        expect(otherDigits).toEqual([]);
    });
});

describe.each(byLanguage)('a workspace in %s', (_language, { pack }) => {
    it('shows no English in its chrome, panels and dialogs, apart from names and acronyms', async () => {
        const { host, ws } = workspaceIn(pack);
        const shows = (id: string): boolean => shownStrings(host).some((s) => s.includes(pack.messages[id] ?? ENGLISH[id]!));
        await settle();
        expect(englishLeft(host, pack)).toEqual([]);

        ws.context().togglePanel('dataWindow', true);
        expect(shows('widget.dataWindow.title')).toBe(true);
        expect(englishLeft(host, pack)).toEqual([]);

        ws.context().togglePanel('objects', true);
        expect(shows('widget.objectTree.mainChart')).toBe(true);
        expect(englishLeft(host, pack)).toEqual([]);

        ws.context().openSymbolSearch();
        await settle();
        expect(shows('widget.symbolPicker.title')).toBe(true);
        expect(englishLeft(host, pack)).toEqual([]);

        host.querySelector<HTMLButtonElement>('.vela-widget-indicators')!.click();
        await settle();
        expect(shows('indicator.rsi.title')).toBe(true);
        expect(englishLeft(host, pack)).toEqual([]);

        ws.cells()[0]!.chart.renderer.openSettings();
        await settle();
        expect(shows('chart.settings.chartSettings')).toBe(true);
        expect(englishLeft(host, pack)).toEqual([]);
    }, WORKSPACE_TIMEOUT);
});

describe('regional language tags', () => {
    it("a browser's regional language tag picks the closest shipped language", () => {
        for (const { pack } of packs) disposers.push(registerLocale(pack));
        const TITLE = msg('widget.indicatorPicker.title', ENGLISH['widget.indicatorPicker.title']!);
        const shipped = Object.fromEntries(packs.map(({ tag, pack }) => [tag, pack.messages['widget.indicatorPicker.title'] ?? ENGLISH['widget.indicatorPicker.title']!]));
        const picks = (browserTag: string): string => createTranslator({ locale: browserTag }).t(TITLE);
        const expected: Record<string, string> = {
            pt: 'pt-BR',
            'pt-PT': 'pt-BR',
            'pt-BR': 'pt-BR',
            zh: 'zh-Hans',
            'zh-CN': 'zh-Hans',
            'zh-SG': 'zh-Hans',
            'zh-TW': 'zh-Hant',
            'zh-HK': 'zh-Hant',
            'zh-MO': 'zh-Hant',
            'es-419': 'es',
            'es-MX': 'es',
            'ar-EG': 'ar',
            'ar-SA': 'ar',
            iw: 'he', // the legacy tag for Hebrew
            in: 'id', // the legacy tag for Indonesian
        };
        for (const [browserTag, tag] of Object.entries(expected)) {
            expect(shipped[tag], tag).toBeDefined();
            expect(picks(browserTag), browserTag).toBe(shipped[tag]);
        }
        // Simplified and Traditional Chinese write the word differently, so the check tells them apart.
        expect(shipped['zh-Hans']).not.toBe(shipped['zh-Hant']);
        for (const english of ['en', 'en-GB', 'en-IN', 'en-US']) expect(picks(english), english).toBe(ENGLISH['widget.indicatorPicker.title']);
        expect(createTranslator({ locale: 'iw', direction: 'auto' }).direction).toBe('rtl');
    });
});

describe('a language pack that trails English', () => {
    it(
        'still passes when it lacks a newer message, which reads in English, while English written outside any message is caught',
        async () => {
            const { pack } = packs.find((p) => p.tag === 'es') ?? packs[0]!;
            const lagging: LocalePack = {
                locale: pack.locale,
                messages: Object.fromEntries(Object.entries(pack.messages).filter(([id]) => id !== 'widget.topbar.indicators' && id !== 'widget.dataWindow.title')),
            };
            const { host, ws } = workspaceIn(lagging);
            await settle();
            ws.context().togglePanel('dataWindow', true);
            const shown = shownStrings(host);
            expect(shown).toContain(ENGLISH['widget.topbar.indicators']);
            expect(shown).toContain(ENGLISH['widget.dataWindow.title']);
            expect(englishLeft(host, lagging)).toEqual([]);

            const written = document.createElement('span');
            written.textContent = 'Chart settings';
            host.append(written);
            expect(englishLeft(host, lagging).map((w) => w.split(' ')[0])).toEqual(['Chart', 'settings']);
        },
        WORKSPACE_TIMEOUT,
    );
});

describe.each(byLanguage)('indicator search in %s', (_language, { pack }) => {
    it(
        'someone reading in another language still finds an indicator by its English name',
        async () => {
            const { host } = workspaceIn(pack, { layout: false });
            await settle();
            host.querySelector<HTMLButtonElement>('.vela-widget-indicators')!.click();
            await settle();
            const search = host.querySelector<HTMLInputElement>('.vela-ip-search')!;
            const found = (query: string): string[] => {
                search.value = query;
                search.dispatchEvent(new Event('input'));
                return [...host.querySelectorAll('.vela-ip-name')].map((el) => el.textContent ?? '');
            };
            // An indicator whose name the pack translates: the RSI where it can.
            const id = translatedIndicatorTitle(pack);
            const translated = pack.messages[id]!;
            const english = ENGLISH[id]!;
            expect(found(translated)).toContain(translated);
            expect(found(english)).toContain(translated);
            expect(found(english.toLowerCase())).toContain(translated);
            expect(found(english.slice(0, -1))).toContain(translated);
            expect(found(`${english} zz`)).toEqual([]);
            // Its short title finds it too, as the pack writes it and as English does ("RSI").
            const shortId = id.replace(/\.title$/, '.shortTitle');
            if (ENGLISH[shortId] !== undefined) {
                expect(found(ENGLISH[shortId])).toContain(translated);
                expect(found(pack.messages[shortId] ?? ENGLISH[shortId])).toContain(translated);
            }
            // Once on the chart, it is found the same way among the chart's indicators.
            found(english);
            [...host.querySelectorAll<HTMLElement>('.vela-ip-row[data-library]')].find((row) => row.querySelector('.vela-ip-name')?.textContent === translated)!.click();
            expect(found(english).filter((name) => name === translated)).toHaveLength(2);
        },
        WORKSPACE_TIMEOUT,
    );
});
