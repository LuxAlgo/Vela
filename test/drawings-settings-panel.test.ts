// @vitest-environment jsdom
// The full settings panel a drawing opens from its toolbar's gear: one layout for every tool,
// options that appear only when they apply, live edits that Cancel takes back, and the tool's
// styles one click away.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { createDrawing, deserializeDrawing, drawingTypes, applyToolDefaults, type Drawing, type FairValueGap, type FibRetracement, type DrawingToolDefaults, type DrawingToolTemplate, type DrawingTypeKey } from '../src/core/drawings';
import { DARK_THEME } from '../src/core/theme';
import { DrawingSettingsPopup, type SettingsActions } from '../src/renderers/native/drawings/DrawingSettingsPopup';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

/** The dialog machine opens and closes on its own tick; wait for it. */
const settled = () => new Promise<void>((r) => setTimeout(r, 50));

const ANCHORS = [
    { time: Date.UTC(2026, 0, 5, 10), price: 100 },
    { time: Date.UTC(2026, 0, 5, 14), price: 120 },
    { time: Date.UTC(2026, 0, 5, 18), price: 110 },
    { time: Date.UTC(2026, 0, 5, 22), price: 130 },
    { time: Date.UTC(2026, 0, 6, 2), price: 105 },
];

/** A chart stand-in that, like the renderer, replaces the drawing with a fresh copy after every
 *  edit, and records what the panel asks of it. */
function chart(initial: Drawing) {
    let live = initial;
    const edits: number[] = [];
    const previews: Array<DrawingToolDefaults | null> = [];
    const applied: DrawingToolDefaults[] = [];
    let templates: DrawingToolTemplate[] = [];
    const sync = (): void => {
        live = deserializeDrawing(live.serialize())!;
        edits.push(1);
    };
    const actions: SettingsActions = {
        resolve: () => live,
        patch: (p) => {
            live.applySettings(p);
            sync();
        },
        restore: (doc) => {
            live = deserializeDrawing(doc)!;
            edits.push(1);
        },
        setLocked: () => {},
        reorder: () => {},
        duplicate: () => {},
        resetSettings: () => {},
        remove: () => {},
        templates: () => templates,
        saveTemplate: (name) => {
            templates = [...templates, { name, settings: { style: { ...live.style } } }];
        },
        removeTemplate: (name) => {
            templates = templates.filter((t) => t.name !== name);
        },
        applyToolSettings: (settings) => {
            applied.push(settings);
            applyToolDefaults(live, settings);
            sync();
        },
        preview: (settings) => previews.push(settings),
    };
    return { actions, live: () => live, edits, previews, applied };
}

function setup(drawing: Drawing, opts: { barMs?: number } = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const popup = new DrawingSettingsPopup(host, DARK_THEME, { chartBarMs: () => opts.barMs ?? 5 * 60_000, timeZone: () => 'UTC' });
    const c = chart(drawing);
    popup.open([drawing], null, c.actions);
    const $ = <T extends Element = HTMLElement>(sel: string): T | null => host.querySelector<T>(sel);
    const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...host.querySelectorAll<T>(sel)];
    const panel = (): HTMLElement | null => $('.vela-dsp');
    const openPanel = async (): Promise<void> => {
        $<HTMLButtonElement>('.vela-dpop [data-tip="Settings"]')!.click();
        await settled();
    };
    const fold = (title: string): HTMLElement => $$('.vela-dsp-fold').find((f) => f.querySelector('.vela-dsp-fold-t')?.textContent === title)!;
    const openFold = (title: string): HTMLElement => {
        const f = fold(title);
        if (!f.hasAttribute('data-open')) f.querySelector<HTMLButtonElement>('.vela-dsp-fold-h')!.click();
        return f;
    };
    const segButton = (group: string, label: string): HTMLButtonElement =>
        $$<HTMLButtonElement>(`.vela-dsp-seg[aria-label="${group}"] button`).find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;
    const footer = (label: string): HTMLButtonElement => $$<HTMLButtonElement>('.vela-dsp .vela-dialog-footer button').find((b) => b.textContent === label)!;
    return { host, popup, ...c, $, $$, panel, openPanel, fold, openFold, segButton, footer };
}

const make = (type: DrawingTypeKey, extra: Partial<Parameters<typeof createDrawing>[1]> = {}): Drawing =>
    createDrawing(type, { id: 'd', paneId: 'price', anchors: ANCHORS.slice(0, 2), ...extra })!;

function type(field: HTMLTextAreaElement, value: string): void {
    field.value = value;
    field.dispatchEvent(new Event('input'));
}

describe('the drawing settings panel', () => {
    it("every tool's toolbar has a settings button that opens the tool's full settings", () => {
        for (const meta of drawingTypes()) {
            const s = setup(createDrawing(meta.type, { id: meta.type, paneId: 'price', anchors: ANCHORS })!);
            s.$<HTMLButtonElement>('.vela-dpop [data-tip="Settings"]')!.click();
            expect(s.panel(), meta.type).not.toBeNull();
            expect(s.$('.vela-dsp .vela-dialog-title')?.textContent).toBe(meta.label);
            expect(s.fold('Show on'), meta.type).toBeDefined();
            s.popup.destroy();
            document.body.replaceChildren();
        }
    });

    it('where a label sits along a line is offered only once the label has words', async () => {
        const s = setup(make('trendline'));
        await s.openPanel();
        s.openFold('Label');
        const place = (): HTMLElement => s.segButton('Position along the line', 'End').closest('.vela-dsp-row')!;
        expect(place().hidden).toBe(true);

        type(s.$<HTMLTextAreaElement>('.vela-dsp textarea')!, 'Weekly support');
        expect(s.live().text?.value).toBe('Weekly support');
        expect(place().hidden).toBe(false);

        s.segButton('Position along the line', 'End').click();
        s.segButton('Side of the line', 'Below').click();
        expect(s.live().text).toMatchObject({ place: 'end', side: 'below' });
        s.popup.destroy();
    });

    it('the timeframe list appears only for a custom choice, and All shows the drawing everywhere again', async () => {
        const s = setup(make('hline', { anchors: ANCHORS.slice(0, 1) }));
        await s.openPanel();
        const show = s.openFold('Show on');
        const grid = (): HTMLElement => show.querySelector('.vela-dsp-tf')!;
        expect(grid().hidden).toBe(true);
        expect(show.querySelector('.vela-dsp-fold-s')?.textContent).toBe('All timeframes');

        s.segButton('Show on', '1H and up').click();
        expect(s.live().showOn).toEqual(['60', '240', 'D', 'W', 'M']);
        expect(grid().hidden).toBe(true);
        // The chart is on 5 minutes: the drawing is now hidden here, and the panel says so.
        expect(show.querySelector<HTMLElement>('.vela-dsp-note')!.hidden).toBe(false);

        s.segButton('Show on', 'Custom').click();
        expect(grid().hidden).toBe(false);
        const band = (label: string): HTMLButtonElement => [...grid().querySelectorAll('button')].find((b) => b.textContent === label)!;
        expect(band('5m').hasAttribute('data-here')).toBe(true);
        band('W').click();
        expect(s.live().showOn).toEqual(['60', '240', 'D', 'M']);

        s.segButton('Show on', 'All').click();
        expect(s.live().showOn).toBeUndefined();
        expect(grid().hidden).toBe(true);
        s.popup.destroy();
    });

    it("a point's price can be typed, and its time reads like the time axis", async () => {
        const s = setup(make('trendline'));
        await s.openPanel();
        const points = s.openFold('Points');
        expect(points.querySelector('.vela-dsp-pt-t')?.textContent).toBe("Mon 5 Jan '26 10:00");
        const price = points.querySelector<HTMLInputElement>('input')!;
        price.value = '101.5';
        price.dispatchEvent(new Event('blur'));
        expect(s.live().anchors[0]!.price).toBe(101.5);
        expect(points.querySelector('.vela-dsp-fold-s')?.textContent).toBe('101.5 → 120');
        s.popup.destroy();
    });

    it('Cancel puts back the look, the points and the timeframes the drawing had when the panel opened', async () => {
        const s = setup(make('trendline', { style: { lineColor: '#2962ff', lineWidth: 1, lineStyle: 'solid' } }));
        await s.openPanel();
        s.segButton('Line width', '3px').click();
        s.segButton('Extend', 'Extend right').click();
        s.openFold('Show on');
        s.segButton('Show on', 'Intraday').click();
        const price = s.openFold('Points').querySelector<HTMLInputElement>('input')!;
        price.value = '90';
        price.dispatchEvent(new Event('blur'));
        expect(s.live().style).toMatchObject({ lineWidth: 3, extendRight: true });

        s.footer('Cancel').click();
        await settled();
        expect(s.panel()).toBeNull();
        expect(s.live().style.lineWidth).toBe(1);
        expect(s.live().style.extendRight).toBeFalsy();
        expect(s.live().showOn).toBeUndefined();
        expect(s.live().anchors[0]!.price).toBe(100);
        s.popup.destroy();
    });

    it('Ok keeps the edits', async () => {
        const s = setup(make('box'));
        await s.openPanel();
        s.segButton('Line style', 'Dashed').click();
        s.footer('Ok').click();
        await settled();
        expect(s.panel()).toBeNull();
        expect(s.live().style.lineStyle).toBe('dashed');
        s.popup.destroy();
    });

    it('hovering a style previews it without an edit, and clicking it applies it', async () => {
        const s = setup(make('trendline'));
        await s.openPanel();
        s.$<HTMLButtonElement>('.vela-dsp-style')!.click();
        const item = (name: string): HTMLElement => s.$$('.vela-dsp-mi').find((m) => m.textContent?.includes(name))!;
        const edits = s.edits.length;
        item('Resistance').dispatchEvent(new Event('pointerenter'));
        expect(s.previews[s.previews.length - 1]?.style?.lineWidth).toBe(2);
        item('Resistance').dispatchEvent(new Event('pointerleave'));
        expect(s.previews[s.previews.length - 1]).toBeNull();
        expect(s.edits.length).toBe(edits);

        item('Resistance').click();
        expect(s.applied).toHaveLength(1);
        expect(s.$('.vela-dsp-style')?.textContent).toContain('Resistance');
        s.popup.destroy();
    });

    it('the current look saved as a style is offered in the style menu', async () => {
        const s = setup(make('trendline', { style: { lineColor: '#ff8800', lineWidth: 2, lineStyle: 'solid' } }));
        await s.openPanel();
        s.$<HTMLButtonElement>('.vela-dsp-style')!.click();
        s.$$<HTMLButtonElement>('.vela-dsp-mi').find((m) => m.textContent === 'Save as style…')!.click();
        const name = s.$<HTMLInputElement>('.vela-dsp-mname input')!;
        name.value = 'Weekly';
        name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        const names = s.$$('.vela-dsp-mi .vela-dsp-mi-t').map((n) => n.textContent);
        expect(names).toContain('Weekly');
        expect(s.$('.vela-dsp-style')?.textContent).toContain('Weekly');
        s.popup.destroy();
    });

    it("a fib's settings list every level in two columns, the ones that are off included", async () => {
        const s = setup(make('fibretracement'));
        await s.openPanel();
        const cells = s.$$('.vela-dsp-lv-c');
        expect(cells.length).toBe((s.live() as FibRetracement).levels.length);
        expect(cells.filter((c) => !c.hasAttribute('data-off')).length).toBe(7);
        expect(getComputedStyle(s.$('.vela-dsp-lv')!).gridTemplateColumns).toContain('repeat(2');
        s.popup.destroy();
    });

    it('choosing OTE swaps which levels are on, and editing a level clears the choice', async () => {
        const s = setup(make('fibretracement'));
        await s.openPanel();
        const pressed = (): string[] => s.$$('.vela-dsp-seg[aria-label="Level set"] button[aria-pressed="true"]').map((b) => b.textContent ?? '');
        expect(pressed()).toEqual(['Classic']);

        s.segButton('Level set', 'OTE').click();
        expect(pressed()).toEqual(['OTE']);
        const on = (): number[] => (s.live() as FibRetracement).levels.filter((l) => l.enabled).map((l) => l.ratio);
        expect(on()).toContain(0.705);
        expect(s.$$('.vela-dsp-lv-c').filter((c) => !c.hasAttribute('data-off')).length).toBe(on().length);

        // Switch a level off from the grid: the set is no longer the ready-made one.
        s.$<HTMLButtonElement>('.vela-dsp-lv-c:not([data-off]) .vela-switch')!.click();
        expect(pressed()).toEqual([]);
        s.popup.destroy();
    });

    it('a retracement level can be set beyond the swing, as a negative ratio', async () => {
        const s = setup(make('fibretracement'));
        await s.openPanel();
        const input = s.$$<HTMLInputElement>('.vela-dsp-lv-c input')[1]!;
        input.value = '-0.5';
        input.dispatchEvent(new Event('blur'));
        expect((s.live() as FibRetracement).levels[1]!.ratio).toBe(-0.5);
        s.popup.destroy();
    });

    it('an option that matters only in one mode appears only in that mode', async () => {
        const s = setup(make('fairvaluegap', { anchors: ANCHORS.slice(0, 1) }));
        await s.openPanel();
        const flip = (): HTMLElement => s.$$('.vela-dsp-chip').find((c) => c.textContent === 'Flip when closed through')!;
        expect(flip().hidden).toBe(false);
        s.segButton('Extend right', 'Until 50%').click();
        expect((s.live() as FairValueGap).gap.extend).toBe('half');
        expect(flip().hidden).toBe(true);
        s.segButton('Extend right', 'Until filled').click();
        expect(flip().hidden).toBe(false);
        s.popup.destroy();
    });

    it('a tool with several drawings selected has no settings panel', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const popup = new DrawingSettingsPopup(host, DARK_THEME);
        const a = make('trendline');
        const b = createDrawing('trendline', { id: 'e', paneId: 'price', anchors: ANCHORS.slice(0, 2) })!;
        popup.open([a, b], null, chart(a).actions);
        expect(host.querySelector('.vela-dpop [data-tip="Settings"]')).toBeNull();
        expect(popup.openPanel()).toBe(false);
        popup.destroy();
    });
});
