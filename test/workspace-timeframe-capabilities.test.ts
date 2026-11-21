// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { SymbolInfo } from '../src/core/ports/MarketDataFeed';
import { BinanceProvider } from '../src/data/providers/binance/BinanceProvider';
import { CoinbaseProvider } from '../src/data/providers/coinbase/CoinbaseProvider';
import { HyperliquidProvider } from '../src/data/providers/hyperliquid/HyperliquidProvider';
import { resolveTimeframeChoice } from '../src/widget/timeframe';
import { encodeState } from '../src/workspace/persist';
import { VelaWorkspace, type VelaWorkspaceOptions } from '../src/workspace/VelaWorkspace';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value };
class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
        return [];
    }
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const workspaces: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of workspaces.splice(0)) ws.destroy();
    document.body.replaceChildren();
});

function provider(name: string, supportedTimeframes?: readonly string[], getSymbolInfo?: DataProvider['getSymbolInfo']): DataProvider {
    return {
        info: () => ({
            name,
            supportedTimeframes,
            capabilities: { enumerate: false, stream: true, symbolInfo: getSymbolInfo !== undefined },
        }),
        getBars: async (_ticker, _timeframe, range) => {
            const end = range.to ?? Date.now();
            return [3, 2, 1].map((i) => ({ time: end - i * 60_000, open: 1, high: 2, low: 0.5, close: 1.5 }));
        },
        subscribe: () => () => {},
        getSymbolInfo,
    };
}

function mount(opts: VelaWorkspaceOptions): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, {
        layout: '1',
        layoutMode: 'desktop',
        timeframes: ['3', '60', '240', 'D'],
        timeframe: '60',
        volume: false,
        persist: false,
        ...opts,
    });
    workspaces.push(ws);
    return ws;
}

function caret(ws: VelaWorkspace): HTMLButtonElement {
    return ws.root.querySelector<HTMLButtonElement>('.vela-widget-tf-caret')!;
}

async function openMenu(ws: VelaWorkspace): Promise<HTMLElement> {
    const trigger = caret(ws);
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    return vi.waitFor(() => {
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
        expect(menu?.getAttribute('role')).toBe('menu');
        return menu!;
    });
}

function row(menu: HTMLElement, timeframe: string): HTMLElement {
    const option = menu.querySelector<HTMLElement>(`[role="menuitem"][data-value="${timeframe}"]`);
    expect(option, `timeframe row ${timeframe}`).not.toBeNull();
    return option!;
}

function disabled(menu: HTMLElement, timeframe: string): boolean {
    return row(menu, timeframe).getAttribute('aria-disabled') === 'true';
}

function chips(ws: VelaWorkspace): Array<string | null> {
    return Array.from(ws.root.querySelectorAll('.vela-widget-tf-chips button'), (chip) => chip.textContent);
}

function press(target: HTMLElement, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function quickInput(ws: VelaWorkspace): HTMLInputElement | null {
    return ws.root.querySelector<HTMLInputElement>('.vela-dialog[data-state="open"] .vela-tq-input');
}

describe('timeframe choices', () => {
    it('keeps aggregatable intervals selectable on the bundled providers', () => {
        for (const source of [new BinanceProvider(), new CoinbaseProvider(), new HyperliquidProvider()]) {
            const { timeframes, supportedTimeframes } = source.info();
            expect(resolveTimeframeChoice('6H', timeframes, supportedTimeframes, '360')).toBe('360');
            expect(resolveTimeframeChoice('2', timeframes, supportedTimeframes)).toBe('2');
            expect(resolveTimeframeChoice('30S', timeframes, supportedTimeframes)).toBeNull();
            expect(resolveTimeframeChoice('90S', timeframes, supportedTimeframes)).toBeNull();
            expect(resolveTimeframeChoice('120S', timeframes, supportedTimeframes)).toBe('2');
            expect(resolveTimeframeChoice('M', timeframes, supportedTimeframes, '43200')).toBe('M');
        }
    });

    it('matches calendar aliases and uses the source spelling', () => {
        expect(resolveTimeframeChoice('D', undefined, ['1D'])).toBe('1D');
        expect(resolveTimeframeChoice('1D', undefined, ['D'])).toBe('D');
        expect(resolveTimeframeChoice('30D', undefined, ['M'])).toBeNull();
        expect(resolveTimeframeChoice('M', undefined, ['30D'])).toBeNull();
    });

    it('keeps seconds, lowercase minutes, and uppercase months distinct', () => {
        expect(resolveTimeframeChoice('30S', undefined, ['30S'])).toBe('30S');
        expect(resolveTimeframeChoice('30S', { finest: '1' }, ['30S'])).toBeNull();
        expect(resolveTimeframeChoice('3', undefined, ['3m'])).toBe('3m');
        expect(resolveTimeframeChoice('3M', undefined, ['3m'])).toBeNull();
        expect(resolveTimeframeChoice('3', undefined, ['3M'])).toBeNull();
        expect(resolveTimeframeChoice('3M', undefined, ['3M'])).toBe('3M');
    });

    it('treats an empty symbol list as exhaustive', () => {
        expect(resolveTimeframeChoice('60', { finest: '60', list: [] }, ['60'])).toBeNull();
    });
});

describe('workspace timeframe controls', () => {
    it('uses the active market and restores a saved favorite where it is available', async () => {
        const limited = provider('limited', ['60', '1D'], async (ticker) =>
            ticker === 'LIST' ? { ticker, timeframes: { finest: '3', list: ['3', '60'] } } : { ticker },
        );
        const unknown = provider('unknown');
        const saved = encodeState({
            version: 1,
            layout: '2h',
            activeCellId: 'a',
            charts: [
                { id: 'a', symbol: 'limited:LIST', timeframe: '60' },
                { id: 'b', symbol: 'unknown:FREE', timeframe: '60' },
            ],
            timeframeFavorites: ['3', '60'],
        });
        const ws = mount({
            persist: 'timeframe-test',
            storage: { get: () => saved, set: () => {} },
            providers: { limited: () => limited, unknown: () => unknown },
        });

        let menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(disabled(menu, '3')).toBe(false);
            expect(disabled(menu, 'D')).toBe(true);
            expect(chips(ws)).toEqual(['3m', '1h']);
        });
        expect(Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) => item.textContent)).toEqual(['3m', '1h', '4h', '1D']);

        ws.setActiveCell('b');
        menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(disabled(menu, '3')).toBe(false);
            expect(disabled(menu, 'D')).toBe(false);
            expect(disabled(menu, '240')).toBe(false);
        });

        const cell = ws.cell('b')!;
        cell.setSymbol('limited:PLAIN');
        menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(disabled(menu, '3')).toBe(true);
            expect(disabled(menu, 'D')).toBe(false);
            expect(chips(ws)).toEqual(['1h']);
        });
        row(menu, '3').click();
        expect(caret(ws).getAttribute('aria-expanded')).toBe('true');
        expect(cell.requestedTimeframe).toBe('60');
        expect(ws.getState().timeframeFavorites).toEqual(['3', '60']);

        ws.setActiveCell('a');
        menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(disabled(menu, '3')).toBe(false);
            expect(chips(ws)).toEqual(['3m', '1h']);
        });
    });

    it('updates an open menu when delayed symbol metadata arrives and rejects unavailable quick entry', async () => {
        let deliver!: (info: SymbolInfo) => void;
        const pending = new Promise<SymbolInfo>((resolve) => (deliver = resolve));
        const getSymbolInfo = vi.fn(() => pending);
        const limited = provider('limited', ['3', '60'], getSymbolInfo);
        const ws = mount({ symbol: 'limited:LATE', providers: { limited: () => limited } });

        const menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(getSymbolInfo).toHaveBeenCalledWith('LATE');
            expect(disabled(menu, '3')).toBe(false);
            expect(disabled(menu, '240')).toBe(true);
        });

        deliver({ ticker: 'LATE', timeframes: { finest: '1H' } });
        await vi.waitFor(() => {
            expect(caret(ws).getAttribute('aria-expanded')).toBe('true');
            expect(disabled(menu, '3')).toBe(true);
            expect(disabled(menu, '240')).toBe(false);
        });
        caret(ws).click();
        await vi.waitFor(() => expect(caret(ws).getAttribute('aria-expanded')).toBe('false'));

        press(ws.root, '3');
        const input = await vi.waitFor(() => {
            const field = quickInput(ws);
            expect(field?.value).toBe('3');
            return field!;
        });
        press(input, 'Enter');
        await vi.waitFor(() => {
            expect(quickInput(ws)).toBe(input);
            expect(ws.root.querySelector('.vela-tq-hint')?.textContent).toBe('This market does not offer that timeframe.');
        });
        expect(ws.cell('c1')?.requestedTimeframe).toBe('60');

        input.value = '4H';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        press(input, 'Enter');
        await vi.waitFor(() => {
            expect(quickInput(ws)).toBeNull();
            expect(ws.cell('c1')?.requestedTimeframe).toBe('240');
        });
    });

    it('uses symbol capabilities for a bare ticker on a sole non-enumerating provider', async () => {
        const limited = provider('limited', ['3', '60'], async (ticker) => ({
            ticker, timeframes: { finest: '60', list: ['60', '1D'] },
        }));
        const ws = mount({ symbol: 'PLAIN', providers: { limited: () => limited } });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        await vi.waitFor(() => {
            expect(disabled(menu, '3')).toBe(true);
            expect(disabled(menu, 'D')).toBe(false);
        });
    });

    it('keeps choices available for an ambiguous bare ticker', async () => {
        const first = { ...provider('first', ['3', '60']), listSymbols: async () => [{ ticker: 'SHARED' }] };
        const second = { ...provider('second', ['60']), listSymbols: async () => [{ ticker: 'SHARED' }, { ticker: 'OTHER' }] };
        const ws = mount({
            layout: '2h',
            cells: { a: { symbol: 'SHARED' }, b: { symbol: 'second:OTHER' } },
            providers: { first: () => first, second: () => second },
        });
        await Promise.all(ws.cells().map((cell) => cell.chart.ready()));
        ws.setActiveCell('a');
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
        ws.active.setSymbol('second:SHARED');
        await vi.waitFor(() => expect(disabled(menu, '3')).toBe(true));
    });

    it('keeps choices available for an offline chart with a provider-qualified label', async () => {
        const ws = mount({
            symbol: 'limited:PLAIN',
            data: [{ time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5 }],
            providers: { limited: () => provider('limited', ['60']) },
        });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
    });

    it('refreshes an open menu when a provider resolves the parked chart', async () => {
        const ws = mount({ symbol: 'later:PLAIN' });
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
        ws.active.chart.data.registerProvider('later', provider('later', ['60']));
        await ws.active.chart.ready();
        await vi.waitFor(() => expect(disabled(menu, '3')).toBe(true));
    });

    it('uses the provider when the inline series is empty', async () => {
        const ws = mount({
            symbol: 'limited:PLAIN',
            data: [],
            providers: { limited: () => provider('limited', ['60']) },
        });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(true);
    });

    it('disables unavailable timeframe buttons in the mobile drawer', async () => {
        const limited = provider('limited', ['60', '1D']);
        const ws = mount({ layoutMode: 'mobile', symbol: 'limited:PLAIN', providers: { limited: () => limited } });
        expect(ws.root.dataset.layout).toBe('mobile');
        ws.root.querySelector<HTMLButtonElement>('.vela-mb-tf')!.click();
        const drawer = await vi.waitFor(() => {
            const panel = ws.root.querySelector('.vela-drawer[data-state="open"]:has(.vela-tfd-grid)');
            expect(panel).not.toBeNull();
            return panel!;
        });
        const buttons = Array.from(drawer.querySelectorAll<HTMLButtonElement>('.vela-tfd-grid button'));
        expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
            ['3m', true],
            ['1h', false],
            ['4h', true],
            ['1D', false],
        ]);
        buttons[0]!.click();
        expect(drawer.getAttribute('data-state')).toBe('open');
        expect(ws.cell('c1')?.requestedTimeframe).toBe('60');

        buttons[3]!.click();
        await vi.waitFor(() => {
            expect(drawer.getAttribute('data-state')).toBe('closed');
            expect(ws.cell('c1')?.requestedTimeframe).toBe('1D');
        });
    });
});
