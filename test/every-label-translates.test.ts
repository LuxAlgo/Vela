// @vitest-environment jsdom
// Every word the chart chrome shows comes from a message, so a language pack can reach all
// of it: under a pseudo-locale that marks each translated message, no unmarked word is left
// on screen except the names nobody translates (tickers, venues, time zone codes).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { registerLocale } from '../src/plugin';
import { buildToolbar } from '../src/core/drawings/toolbar';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { layoutDefinition, layoutForGrid, layouts } from '../src/workspace/layouts';
import english from '../src/locales/en.json';
import { shownStrings } from './support/shown-text';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

const OPEN = '⟪';
const CLOSE = '⟫';
/** Every English message, marked: what a translator's pack would replace. */
const PSEUDO = Object.fromEntries(Object.entries(english as Record<string, string>).map(([id, text]) => [id, `${OPEN}${text}${CLOSE}`]));

/** The words left once every marked message is taken out (messages nest: innermost first). */
function unmarked(text: string): string {
    let rest = text;
    for (let prev = ''; prev !== rest; ) {
        prev = rest;
        rest = rest.replace(/⟪[^⟪⟫]*⟫/g, '');
    }
    return rest;
}

/** Names that stay as written in every language. */
const UNTRANSLATED = /^(UTC|UTC[+-]\d{1,2}(:\d{2})?)$/;

function untranslatedWords(root: Element): string[] {
    return shownStrings(root)
        .map((s) => unmarked(s).trim())
        .filter((s) => /\p{L}/u.test(s) && !UNTRANSLATED.test(s));
}

function workspace(options: Record<string, unknown>): { host: HTMLElement; ws: VelaWorkspace } {
    disposers.push(registerLocale({ locale: 'en-XA', messages: PSEUDO }));
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '2h', ...options } as never);
    disposers.push(() => ws.destroy());
    return { host, ws };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('a workspace in another language', () => {
    it('shows no English word in its chrome that a language pack cannot translate', () => {
        const { host } = workspace({ locale: 'en-XA' });
        expect(untranslatedWords(host)).toEqual([]);
    });

    it('keeps every word translatable in its panels, pickers and chart settings', async () => {
        const { host, ws } = workspace({ locale: 'en-XA' });
        const shows = (english: string): boolean => shownStrings(host).some((s) => s.includes(`${OPEN}${english}${CLOSE}`));
        ws.context().togglePanel('dataWindow', true);
        expect(shows('Data window')).toBe(true);
        expect(untranslatedWords(host)).toEqual([]);
        ws.context().togglePanel('objects', true);
        expect(shows('Main chart')).toBe(true);
        expect(untranslatedWords(host)).toEqual([]);
        ws.context().openSymbolSearch();
        await settle();
        expect(shows('Symbol Search')).toBe(true);
        expect(untranslatedWords(host)).toEqual([]);
        ws.cells()[0]!.chart.renderer.openSettings();
        await settle();
        expect(shows('Chart settings')).toBe(true);
        expect(untranslatedWords(host)).toEqual([]);
    });

    it('relabels its chrome when the language changes at runtime', () => {
        const { host, ws } = workspace({});
        ws.setLocale('en-XA');
        expect(untranslatedWords(host)).toEqual([]);
    });
});

describe('a layout saved in one language', () => {
    it('stores the English option values, whatever language the menus showed them in', () => {
        disposers.push(registerLocale({ locale: 'de', messages: { 'indicator.option.week': 'Woche', 'indicator.option.session': 'Sitzung', 'indicator.vwap.anchor': 'Ankerperiode' } }));
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false } as never);
        disposers.push(() => ws.destroy());
        const chart = ws.cells()[0]!.chart;
        const vwap = chart.addNativeIndicator('vwap');

        ws.setLocale('de');
        const anchor = vwap.inputs.find((i) => i.key === 'anchor')!;
        expect(chart.i18n.t(anchor.display!.title!)).toBe('Ankerperiode');
        expect(chart.i18n.t(anchor.display!.options!['Week']!)).toBe('Woche');
        expect(anchor.options).toContain('Week');

        vwap.setInput('anchor', 'Week');
        expect(vwap.inputValues().anchor).toBe('Week');
        const saved = JSON.stringify(ws.getState());
        expect(saved).toContain('"anchor":"Week"');
        expect(saved).not.toContain('Woche');
    });
});

describe('reading what a chart offers', () => {
    it("reading the toolbar, a layout or the layout list gives text, in the chart's language", () => {
        disposers.push(
            registerLocale({
                locale: 'de',
                messages: {
                    'drawing.toolbar.group.icons': 'Symbole',
                    'drawing.trendline.label': 'Trendlinie',
                    'workspace.layout.single': 'Einzeln',
                    'workspace.layout.grid': '{cols} × {rows} Raster',
                },
            }),
        );
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false, locale: 'de' } as never);
        disposers.push(() => ws.destroy());
        const i18n = ws.cells()[0]!.chart.i18n;

        const toolbar = buildToolbar(undefined, i18n).definition;
        const labels = toolbar.groups.flatMap((g) => [g.label, ...g.tools.map((t) => t.label), ...(g.sections ?? []).map((s) => s.label)]);
        for (const label of labels) expect(typeof label).toBe('string');
        expect(labels).toContain('Symbole');
        expect(labels).toContain('Trendlinie');

        expect(layoutDefinition('1', i18n)!.label).toBe('Einzeln');
        for (const layout of layouts(i18n)) expect(typeof layout.label).toBe('string');
        expect(layouts(i18n).map((l) => l.label)).toContain('Einzeln');
        expect(layoutForGrid(3, 2, i18n).label).toBe('2 × 3 Raster');

        // Without a translator they read in English, as before.
        expect(buildToolbar(undefined).definition.groups.map((g) => g.label)).toContain('Icons');
        expect(layoutDefinition('1')!.label).toBe('Single');
        expect(layoutForGrid(3, 2).label).toBe('2 × 3 grid');
    });
});
