// @vitest-environment jsdom
// The right-to-left languages Vela ships a pack for (Arabic, Hebrew). With the pack
// registered and the locale set, the chrome mirrors: the workspace and the chart read right
// to left. The plot does not: time runs left to right, the price axis stays on the right, and
// every number the plot paints reads left to right in Western digits, in a page that is
// itself left to right. The stand-in canvas is the one the right-to-left page tests use.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Vela } from '../src/index';
import { registerLocale, type LocalePack } from '../src/plugin';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import type { OHLCV } from '../src/core/model/ohlcv';
import { installCanvasStandIn, painted } from './support/canvas-stand-in';

type PackGlob = (patterns: string[], options: { import: string; eager: true }) => Record<string, LocalePack>;
const packFiles = (import.meta as unknown as { glob: PackGlob }).glob(['../src/locales/*.ts', '!../src/locales/*.d.ts', '!../src/locales/en.ts'], {
    import: 'default',
    eager: true,
});

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

/** The shipped packs of languages that read right to left. */
const rightToLeft = Object.values(packFiles)
    .filter((pack) => pack.direction === 'rtl')
    .map((pack) => ({ tag: pack.locale, pack }))
    .sort((a, b) => a.tag.localeCompare(b.tag));

/** Opening a workspace is heavy work in jsdom. */
const WORKSPACE_TIMEOUT = 30_000;

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    painted.length = 0;
    document.body.replaceChildren();
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 1);
const LOW = 55_000;
const HIGH = 61_000;

/** A falling market between {@link LOW} and {@link HIGH}. */
function bars(): OHLCV[] {
    return Array.from({ length: 120 }, (_, i) => {
        const open = 60_000 - i * 40;
        const close = open - 25;
        return { time: T0 + i * HOUR, open, high: open + 30, low: close - 30, close, volume: 1_000 + i * 10 };
    });
}

interface RendererInternals {
    plot: HTMLElement;
    wrapper: HTMLElement;
    scheduler: { flushNow(level: number): void };
    coords: { timeToX(ms: number): number };
}

/** The value of a painted price label, or null when the text is no price in the market's range. */
function priceOf(text: string): number | null {
    // `\s` covers the no-break spaces some locales group digits with.
    if (!/^[\d.,\s]+$/.test(text)) return null;
    const value = Number(text.replace(/[\s,]/g, ''));
    return Number.isFinite(value) && value >= LOW && value <= HIGH ? value : null;
}

describe.each(rightToLeft.map((row) => [languageNames.of(row.tag) ?? row.tag, row] as const))('a chart in %s', (_language, { tag, pack }) => {
    let restoreCanvas: () => void = () => {};
    beforeAll(() => {
        restoreCanvas = installCanvasStandIn();
    });
    afterAll(() => restoreCanvas());

    it('reads its chrome right to left, in its own language', () => {
        disposers.push(registerLocale(pack));
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false } as never);
        disposers.push(() => ws.destroy());
        ws.setLocale({ locale: tag, direction: 'auto' });

        expect(document.documentElement.getAttribute('dir')).toBeNull(); // the page itself stays left to right
        expect(ws.i18n.direction).toBe('rtl');
        expect(host.querySelector('.vela-workspace')!.getAttribute('dir')).toBe('rtl');
        const topbar = host.querySelector<HTMLElement>('.vela-widget-indicators')!;
        expect(getComputedStyle(topbar).direction).toBe('rtl');
        expect(topbar.textContent).toBe(pack.messages['widget.topbar.indicators'] ?? 'Indicators');
    }, WORKSPACE_TIMEOUT);

    it('keeps the plot, the price axis and every number it paints left to right', async () => {
        disposers.push(registerLocale(pack));
        const host = document.createElement('div');
        document.body.append(host);
        const renderer = new NativeRenderer();
        renderer.applyFeature('intro', false);
        const chart = new Vela(host, { data: bars(), locale: tag, direction: 'auto' }, { renderer });
        disposers.push(() => chart.destroy());
        const internals = renderer as unknown as RendererInternals;
        await settle(); // the chart loads its data asynchronously
        internals.scheduler.flushNow(4);

        // The chart's chrome mirrors around a plot that does not.
        expect(internals.wrapper.getAttribute('dir')).toBe('rtl');
        expect(getComputedStyle(internals.plot).direction).toBe('rtl');
        const canvases = [...internals.plot.querySelectorAll('canvas')];
        expect(canvases.length).toBeGreaterThan(0);
        expect(canvases.filter((c) => c.dir !== 'ltr')).toEqual([]);

        // Time runs left to right: a later bar sits further right.
        expect(internals.coords.timeToX(T0 + 100 * HOUR)).toBeGreaterThan(internals.coords.timeToX(T0 + 10 * HOUR));

        // The price axis is painted, on the right, left to right, in Western digits.
        const prices = painted.filter((p) => priceOf(p.text) !== null);
        expect(prices.length).toBeGreaterThan(0);
        expect(prices.filter((p) => p.x < 700).map((p) => `${p.text} at x=${p.x}`)).toEqual([]);
        expect(painted.filter((p) => p.direction !== 'ltr').map((p) => p.text)).toEqual([]);
        expect(painted.filter((p) => /(?![0-9])\p{Nd}/u.test(p.text)).map((p) => p.text)).toEqual([]);
    });
});

describe('the right-to-left languages', () => {
    it('ship as Arabic and Hebrew packs that say they read right to left', () => {
        expect(rightToLeft.map(({ tag }) => tag)).toEqual(['ar', 'he']);
    });
});
