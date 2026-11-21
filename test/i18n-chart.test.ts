// @vitest-environment jsdom
// A chart, a workspace and their chrome follow the localization a host sets: at construction
// and at runtime through `setLocale`, with `locale:changed` announcing the switch. With no
// localization set nothing changes on the page.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Vela } from '../src/index';
import { createTranslator, registerLocale, type LocaleChangedEvent, type Translator } from '../src/plugin';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { ChromeRenderer } from '../src/renderers/native/chrome/ChromeRenderer';
import { PriceAxisTickSource } from '../src/renderers/native/chrome/priceAxisTicks';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { IndicatorInputsDialog } from '../src/renderers/shared/IndicatorInputsDialog';
import { ShortcutsHelp } from '../src/widget/shortcuts-help';
import { KeymapManager } from '../src/ui/keymap';
import { DARK_THEME } from '../src/core/theme';
import type { IChartRenderer, RendererRootAttributes } from '../src/core/ports/IChartRenderer';
import type { RendererDisplayOptions } from '../src/core/options';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

/** A renderer that records what the chart hands it. */
function recordingRenderer(): { renderer: new (opts?: RendererDisplayOptions) => IChartRenderer; calls: Array<{ i18n: Translator; root: RendererRootAttributes; locale: string; price: string }> } {
    const calls: Array<{ i18n: Translator; root: RendererRootAttributes; locale: string; price: string }> = [];
    const fake = {
        name: 'fake',
        features: [] as readonly string[],
        capabilities: {
            panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
            barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
        },
        applyFeature() {},
        readFeature: () => undefined,
        mount() {}, setTheme() {}, resize() {}, destroy() {},
        setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
        mountIndicator: (m: { id: string }) => ({ id: m.id }),
        updateIndicator() {}, removeIndicator() {}, setIndicatorInputs() {},
        onInputChange: () => () => {}, onRemoveIndicator: () => () => {},
        onCrosshairMove: () => () => {}, onClick: () => () => {},
        getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
        setLocalization(i18n: Translator, root: RendererRootAttributes) {
            calls.push({ i18n, root, locale: i18n.locale, price: i18n.format.price(1234.5, { decimals: 2, grouping: true }) });
        },
    } as unknown as IChartRenderer;
    function Recording() {
        return fake;
    }
    return { renderer: Recording as unknown as new (opts?: RendererDisplayOptions) => IChartRenderer, calls };
}

const TITLE_DE = { 'widget.shortcuts.title': 'Tastenkürzel', 'widget.shortcuts.mouse': 'Maus', 'ui.datePicker.nextMonth': 'Nächster Monat' };

describe('a chart', () => {
    it('with no locale reads English and leaves lang and dir to the page', () => {
        const { renderer, calls } = recordingRenderer();
        const chart = new Vela(document.createElement('div'), { renderer }, { engines: [] });
        expect(chart.i18n.locale).toBe('en');
        expect(chart.i18n.direction).toBe('ltr');
        expect(calls).toHaveLength(1);
        expect(calls[0]!.root).toEqual({ lang: null, dir: null });
        expect(calls[0]!.price).toBe('1,234.50');
    });

    it('switches messages and formatters at runtime and fires locale:changed', () => {
        disposers.push(registerLocale({ locale: 'de', messages: TITLE_DE }));
        const { renderer, calls } = recordingRenderer();
        const chart = new Vela(document.createElement('div'), { renderer }, { engines: [] });
        const i18n = chart.i18n;
        const events: LocaleChangedEvent[] = [];
        chart.on('locale:changed', (e) => events.push(e));

        chart.setLocale('de');
        expect(chart.i18n).toBe(i18n); // one translator for the chart's lifetime
        expect(i18n.t({ id: 'widget.shortcuts.title', defaultMessage: 'Keyboard shortcuts' })).toBe('Tastenkürzel');
        expect(i18n.format.price(1234.5, { decimals: 2, grouping: true })).toBe('1.234,50');
        expect(calls[calls.length - 1]).toMatchObject({ locale: 'de', price: '1.234,50', root: { lang: 'de', dir: null } });
        expect(events).toEqual([{ locale: 'de', direction: 'ltr' }]);

        chart.setLocale({ locale: 'ar', direction: 'auto' });
        expect(events[events.length - 1]).toEqual({ locale: 'ar', direction: 'rtl' });
        expect(calls[calls.length - 1]!.root).toEqual({ lang: 'ar', dir: 'rtl' });
        expect(i18n.t({ id: 'widget.shortcuts.title', defaultMessage: 'Keyboard shortcuts' })).toBe('Keyboard shortcuts');

        // Fields left out are kept; an explicit undefined restores the default.
        chart.setLocale({ numberingSystem: 'arab' });
        expect(i18n.locale).toBe('ar');
        expect(i18n.direction).toBe('rtl');
        chart.setLocale({ locale: undefined, direction: undefined, numberingSystem: undefined });
        expect(i18n.locale).toBe('en');
        expect(calls[calls.length - 1]!.root).toEqual({ lang: null, dir: null });
    });

    it('takes its locale, direction and overrides from the options', () => {
        const { renderer, calls } = recordingRenderer();
        const chart = new Vela(document.createElement('div'), { renderer, locale: 'he', direction: 'auto', messages: { 'widget.shortcuts.title': 'קיצורים' } }, { engines: [] });
        expect(chart.i18n.direction).toBe('rtl');
        expect(chart.i18n.t({ id: 'widget.shortcuts.title', defaultMessage: 'Keyboard shortcuts' })).toBe('קיצורים');
        expect(calls[0]!.root).toEqual({ lang: 'he', dir: 'rtl' });
    });
});

describe('the native renderer', () => {
    it('stamps lang and dir on its root only when the host asks', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined); // jsdom has no canvas
        const host = document.createElement('div');
        document.body.append(host);
        const r = new NativeRenderer();
        r.mount(host, DARK_THEME);
        const root = host.firstElementChild as HTMLElement;
        expect(root.hasAttribute('lang')).toBe(false);
        expect(root.hasAttribute('dir')).toBe(false);

        r.setLocalization(createTranslator({ locale: 'ar', direction: 'auto' }), { lang: 'ar', dir: 'rtl' });
        expect(root.getAttribute('lang')).toBe('ar');
        expect(root.getAttribute('dir')).toBe('rtl');

        r.setLocalization(createTranslator(), { lang: null, dir: null });
        expect(root.hasAttribute('lang')).toBe(false);
        expect(root.hasAttribute('dir')).toBe(false);
        r.destroy();
    });

    it("labels the price axis in the chart's locale", () => {
        const texts: string[] = [];
        const ctx = new Proxy(
            { measureText: (t: string) => ({ width: t.length * 6 }), fillText: (t: string) => texts.push(t) },
            { get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined), set: () => true },
        );
        const canvas = { width: 570, height: 422, getContext: () => ctx } as unknown as HTMLCanvasElement;
        const scene = new SceneGraph();
        const price = scene.ensurePane('price', 'price', 0, 3);
        price.bounds = { top: 0, height: 400 };
        price.scale = { min: 1000.25, max: 1001.75 };
        const coords = new CoordinateSystem();
        coords.setSize(500, 400, 1);
        coords.setBars(Array.from({ length: 60 }, (_, i) => 1_700_000_000_000 + i * 3_600_000));
        scene.format = createTranslator({ locale: 'de' }).format;
        const chrome = new ChromeRenderer(new PriceAxisTickSource());
        chrome.mount(canvas);
        chrome.render(scene, coords, DARK_THEME);
        const prices = texts.filter((t) => /^\d{4}[.,]\d+$/.test(t));
        expect(prices.length).toBeGreaterThan(2);
        expect(prices.every((t) => t.includes(','))).toBe(true);
    });
});

describe('a workspace', () => {
    it("carries one localization to every cell, the shared chrome and contributed actions", () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: '2h' } as never);
        const root = host.querySelector<HTMLElement>('.vela-workspace')!;
        expect(root.hasAttribute('lang')).toBe(false);
        expect(ws.i18n.locale).toBe('en');
        expect(ws.context().i18n).toBe(ws.i18n);

        const events: LocaleChangedEvent[] = [];
        ws.on('locale:changed', (e) => events.push(e));
        ws.setLocale({ locale: 'he', direction: 'auto' });
        expect(events).toEqual([{ locale: 'he', direction: 'rtl' }]);
        expect(root.getAttribute('lang')).toBe('he');
        expect(root.getAttribute('dir')).toBe('rtl');
        expect(ws.cells().map((c) => [c.chart.i18n.locale, c.chart.i18n.direction])).toEqual([
            ['he', 'rtl'],
            ['he', 'rtl'],
        ]);

        // A cell the layout creates later starts in the workspace's language.
        ws.setLayout('4');
        expect(ws.cells().map((c) => c.chart.i18n.locale)).toEqual(['he', 'he', 'he', 'he']);
        ws.destroy();
    });

    it('takes its localization from the options', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false, locale: 'ja', numberingSystem: 'latn' } as never);
        expect(ws.i18n.locale).toBe('ja');
        expect(ws.cells()[0]!.chart.i18n.locale).toBe('ja');
        expect(host.querySelector('.vela-workspace')!.getAttribute('lang')).toBe('ja');
        ws.destroy();
    });
});

describe('localized chrome', () => {
    it("the shortcuts panel speaks the shell's language, and follows a switch on its next opening", async () => {
        const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0)); // the dialog announces open a tick later
        disposers.push(registerLocale({ locale: 'de', messages: TITLE_DE }));
        const host = document.createElement('div');
        document.body.append(host);
        let i18n = createTranslator();
        const help = new ShortcutsHelp(new KeymapManager(), host, undefined, () => i18n);
        help.open();
        await settle();
        expect(host.querySelector('.vela-dialog-title')!.textContent).toBe('Keyboard shortcuts');
        expect(host.textContent).toContain('Mouse');
        help.close();
        await settle();

        i18n = createTranslator({ locale: 'de' });
        help.open();
        await settle();
        expect(host.querySelector('.vela-dialog-title')!.textContent).toBe('Tastenkürzel');
        expect(host.textContent).toContain('Maus');
        expect(host.textContent).toContain('Scroll through history'); // not in the pack: English
        help.destroy();
    });

    it("the calendar in an indicator's settings speaks the chart's language", () => {
        disposers.push(registerLocale({ locale: 'de', messages: TITLE_DE }));
        const host = document.createElement('div');
        document.body.append(host);
        const i18n = createTranslator({ locale: 'de' });
        const dialog = new IndicatorInputsDialog({
            container: host,
            theme: () => DARK_THEME,
            mobile: () => false,
            dialogHost: () => host,
            symbolPicker: () => null,
            i18n: () => i18n,
            onChange: () => {},
            onBackdropClose: () => {},
        });
        const start = Date.parse('2026-09-10T09:30:00');
        dialog.open({ id: 'ind', title: 'Test', inputs: [{ key: 't', title: 'Start', type: 'time', defval: start }], values: { t: start }, props: [], propValues: {} });
        (document.querySelector('.vela-ind-combo-chevron') as HTMLButtonElement).click();
        const cal = document.querySelector('.vela-ind-cal') as HTMLElement;
        const week = [...cal.querySelectorAll('.vela-date-picker-week span')].map((s) => s.textContent);
        expect(week[0]).toBe('Mo');
        expect(cal.querySelector('.vela-date-picker-switch')!.textContent).toBe('September');
        expect(cal.querySelectorAll('.vela-date-picker-nav')[1]!.getAttribute('aria-label')).toBe('Nächster Monat');
        dialog.close();
    });

    it("the unit after the chart's right margin agrees with its number, so each language can inflect it", async () => {
        const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
        disposers.push(registerLocale({ locale: 'pl', messages: { 'chart.settings.unitBars': '{count, plural, one {słupek} few {słupki} many {słupków} other {słupka}}' } }));
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false } as never);
        disposers.push(() => ws.destroy());
        const chart = ws.cells()[0]!.chart;
        chart.renderer.openSettings('Canvas');
        await settle();
        const row = (): HTMLElement => document.querySelector<HTMLElement>('[data-sd-id="canvas.margins.right"]')!;
        const unit = (): string => row().querySelector('span[style]')!.textContent ?? '';
        const setMargin = (bars: number): void => {
            const input = row().querySelector<HTMLInputElement>('input')!;
            input.value = String(bars);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setMargin(1);
        expect(unit()).toBe('bar');
        setMargin(5);
        expect(unit()).toBe('bars');

        chart.renderer.openSettings(); // closes it
        ws.setLocale('pl');
        chart.renderer.openSettings('Canvas'); // the pack leaves the tab's name in English
        await settle();
        setMargin(2);
        expect(unit()).toBe('słupki');
        setMargin(5);
        expect(unit()).toBe('słupków');
    });
});
