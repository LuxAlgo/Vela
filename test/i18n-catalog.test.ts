// The English catalog and the locale packs stay in step with the source: every `msg()` the
// code declares is in `src/locales/en.json` and its generated type, and every shipped pack
// parses and names only messages that exist, with the same arguments as the English.
import { describe, expect, it } from 'vitest';
import { checkGenerated, repoRoot as root } from '../scripts/i18n-extract.mjs';
import { parseMessage } from '../src/core/i18n/icu';
import { createTranslator, registerLocale } from '../src/plugin';
import en from '../src/locales/en';

type JsonGlob = (pattern: string, options: { import: string; eager: true }) => Record<string, Record<string, string>>;
const packFiles = (import.meta as unknown as { glob: JsonGlob }).glob('../src/locales/*.json', { import: 'default', eager: true });
const english = packFiles['../src/locales/en.json']!;

/** The argument names a message uses (`{name}`, `{n, plural, …}`), sorted. */
function argumentNames(message: string): string[] {
    const names = new Set<string>();
    const walk = (nodes: ReturnType<typeof parseMessage>): void => {
        for (const n of nodes) {
            if (typeof n === 'string' || n.kind === 'pound') continue;
            names.add(n.name);
            if (n.kind !== 'arg') for (const branch of Object.values(n.options)) walk(branch);
        }
    };
    walk(parseMessage(message));
    return [...names].sort();
}

describe('the English catalog', () => {
    it('lists every message the source declares, and its type lists every id', () => {
        const { errors, stale } = checkGenerated(root);
        expect(errors).toEqual([]);
        expect(stale, 'run `npm run i18n:extract`').toEqual([]);
        expect(Object.keys(english).length).toBeGreaterThan(0);
    });

    it('every English message is valid message syntax', () => {
        for (const [id, text] of Object.entries(english)) expect(() => parseMessage(text), id).not.toThrow();
    });

    it('the English pack changes nothing on screen', () => {
        expect(en.messages).toEqual(english);
        const plain = createTranslator();
        const off = registerLocale(en);
        const withPack = createTranslator();
        for (const [id, text] of Object.entries(english)) {
            expect(withPack.t({ id, defaultMessage: text })).toBe(plain.t({ id, defaultMessage: text }));
        }
        off();
    });
});

describe('the shipped locale packs', () => {
    const packs = Object.entries(packFiles).filter(([file]) => !file.endsWith('/en.json'));

    it('each parses, names only known messages and keeps their arguments', () => {
        const problems: string[] = [];
        for (const [file, pack] of packs) {
            for (const [id, text] of Object.entries(pack)) {
                if (english[id] === undefined) problems.push(`${file}: unknown message id ${id}`);
                else {
                    try {
                        if (argumentNames(text).join() !== argumentNames(english[id]).join()) problems.push(`${file}: ${id} changes its arguments`);
                    } catch {
                        problems.push(`${file}: ${id} does not parse`);
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    });
});
