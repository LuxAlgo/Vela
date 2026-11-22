// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { SymbolInfo } from '../src/core/ports/MarketDataFeed';
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
    it('treats finest as a lower bound for generic sources', () => {
        const timeframes = { finest: '1' };
        expect(resolveTimeframeChoice('6H', timeframes, '360')).toBe('360');
        expect(resolveTimeframeChoice('30S', timeframes)).toBeNull();
        expect(resolveTimeframeChoice('90S', timeframes)).toBe('90S');
        expect(resolveTimeframeChoice('3M', timeframes, '129600')).toBe('3M');
        expect(resolveTimeframeChoice('3M', undefined, '129600')).toBe('129600');
    });

    it('matches calendar aliases and uses the source spelling without equating calendar units', () => {
        expect(resolveTimeframeChoice('D', { finest: '1D', list: ['1D'] })).toBe('1D');
        expect(resolveTimeframeChoice('1D', { finest: 'D', list: ['D'] })).toBe('D');
        expect(resolveTimeframeChoice('30D', { finest: 'M', list: ['M'] })).toBeNull();
        expect(resolveTimeframeChoice('M', { finest: '30D', list: ['30D'] })).toBeNull();
    });

    it('distinguishes bare minutes from uppercase months and discards undocumented declarations', () => {
        const timeframes = { finest: '3', list: ['3', '3M'] };
        expect(resolveTimeframeChoice('3', timeframes)).toBe('3');
        expect(resolveTimeframeChoice('3M', timeframes, '129600')).toBe('3M');
        expect(resolveTimeframeChoice('129600', timeframes)).toBeNull();
        expect(resolveTimeframeChoice('3', { finest: '3', list: ['3m'] })).toBeNull();
        expect(resolveTimeframeChoice('3M', { finest: '3', list: ['3m'] })).toBeNull();
    });

    it('treats an empty symbol list as exhaustive', () => {
        expect(resolveTimeframeChoice('60', { finest: '60', list: [] })).toBeNull();
    });
});

describe('workspace timeframe controls', () => {
    it('uses the active market and restores a saved favorite where it is available', async () => {
        const limited = provider('limited', ['60', '1D'], async (ticker) => ({
            ticker, timeframes: { finest: '60', list: ['60', '1D'] },
        }));
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
            expect(disabled(menu, '3')).toBe(true);
            expect(disabled(menu, 'D')).toBe(false);
            expect(chips(ws)).toEqual(['1h']);
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

        ws.active.setSymbol('unknown:FREE');
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
            expect(disabled(menu, '240')).toBe(false);
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

    it('retries unavailable metadata when the same market loads again', async () => {
        let info: SymbolInfo | undefined;
        const getSymbolInfo = vi.fn(async () => info);
        const limited = provider('limited', undefined, getSymbolInfo);
        const ws = mount({ symbol: 'limited:PLAIN', providers: { limited: () => limited } });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(getSymbolInfo).toHaveBeenCalledWith('PLAIN');
        expect(disabled(menu, '3')).toBe(false);

        info = { ticker: 'PLAIN', timeframes: { finest: '60' } };
        ws.active.setTimeframe('240');
        await ws.active.chart.ready();
        await vi.waitFor(() => {
            expect(caret(ws).getAttribute('aria-expanded')).toBe('true');
            expect(disabled(menu, '3')).toBe(true);
        });
    });

    it('ignores provider-wide legacy timeframe info when a symbol does not declare a constraint', async () => {
        const legacy = provider('legacy', ['60'], async (ticker) => ({ ticker }));
        const ws = mount({ symbol: 'legacy:PLAIN', providers: { legacy: () => legacy } });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
        expect(disabled(menu, '240')).toBe(false);
        row(menu, '3').click();
        await vi.waitFor(() => expect(ws.active.requestedTimeframe).toBe('3'));
    });

    it('clears and restores capabilities as a late duplicate is indexed and removed with the menu open', async () => {
        const first = {
            ...provider('first', undefined, async (ticker) => ({ ticker, timeframes: { finest: '60' } })),
            listSymbols: async () => [{ ticker: 'SHARED' }],
        };
        const second = {
            ...provider('second'),
            listSymbols: async () => [{ ticker: 'SHARED' }],
        };
        const ws = mount({ symbol: 'SHARED', providers: { first: () => first } });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        await vi.waitFor(() => expect(disabled(menu, '3')).toBe(true));

        await ws.active.chart.data.registerProvider('second', second);
        await vi.waitFor(() => {
            expect(caret(ws).getAttribute('aria-expanded')).toBe('true');
            expect(disabled(menu, '3')).toBe(false);
        });

        ws.active.chart.data.unregisterProvider('second');
        await vi.waitFor(() => {
            expect(caret(ws).getAttribute('aria-expanded')).toBe('true');
            expect(disabled(menu, '3')).toBe(true);
        });
    });

    it('discards pending capabilities from a replaced provider', async () => {
        let deliver!: (info: SymbolInfo) => void;
        const pending = new Promise<SymbolInfo>((resolve) => (deliver = resolve));
        const getSymbolInfo = vi.fn(() => pending);
        const first = provider('market', undefined, getSymbolInfo);
        const replacement = provider('market', undefined, async (ticker) => ({
            ticker, timeframes: { finest: '3', list: ['3', '60'] },
        }));
        const ws = mount({ symbol: 'market:PLAIN', providers: { market: () => first } });
        const menu = await openMenu(ws);
        await vi.waitFor(() => expect(getSymbolInfo).toHaveBeenCalledWith('PLAIN'));

        await ws.active.chart.data.registerProvider('market', replacement);
        await vi.waitFor(() => expect(disabled(menu, '240')).toBe(true));
        deliver({ ticker: 'PLAIN', timeframes: { finest: '60' } });
        await ws.active.chart.ready();
        expect(disabled(menu, '3')).toBe(false);
        expect(disabled(menu, '240')).toBe(true);
    });

    it('checks one alias and applies the advertised spelling from a desktop row', async () => {
        const limited = provider('limited', undefined, async (ticker) => ({
            ticker, timeframes: { finest: '3', list: ['3', '1D', '3M'] },
        }));
        const ws = mount({
            symbol: 'limited:PLAIN', timeframe: '1D', timeframes: ['D', '01D', '3', '3M', '240'],
            providers: { limited: () => limited },
        });
        const menu = await openMenu(ws);
        await vi.waitFor(() => expect(disabled(menu, '240')).toBe(true));
        expect(row(menu, 'D').hasAttribute('data-checked')).toBe(true);
        expect(row(menu, '01D').hasAttribute('data-checked')).toBe(false);
        expect(row(menu, '3').textContent).toBe('3m');
        expect(row(menu, '3M').textContent).toBe('3M');
        row(menu, '3M').click();
        await vi.waitFor(() => expect(ws.active.requestedTimeframe).toBe('3M'));
        const reopened = await openMenu(ws);
        row(reopened, 'D').click();
        await vi.waitFor(() => expect(ws.active.requestedTimeframe).toBe('1D'));

        press(ws.root, '3');
        const input = await vi.waitFor(() => {
            expect(quickInput(ws)).not.toBeNull();
            return quickInput(ws)!;
        });
        input.value = '3M';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(ws.root.querySelector('.vela-tq-hint')?.textContent).toBe('3 months');
        press(input, 'Enter');
        expect(ws.active.requestedTimeframe).toBe('3M');
    });

    it('allows quick entry of 90S on a custom source whose finest timeframe is 1 minute', async () => {
        const custom = provider('custom', ['1'], async (ticker) => ({ ticker, timeframes: { finest: '1' } }));
        const ws = mount({ symbol: 'custom:PLAIN', providers: { custom: () => custom } });
        await ws.active.chart.ready();
        press(ws.root, '9');
        const input = await vi.waitFor(() => {
            expect(quickInput(ws)).not.toBeNull();
            return quickInput(ws)!;
        });
        input.value = '90S';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(ws.root.querySelector('.vela-tq-hint')?.textContent).toBe('90 seconds');
        press(input, 'Enter');
        expect(ws.active.requestedTimeframe).toBe('90S');
    });

    it('delivers the same calendar choice from the desktop menu and quick entry with a finest-only declaration', async () => {
        const custom = provider('custom', undefined, async (ticker) => ({ ticker, timeframes: { finest: '1' } }));
        const getBars = vi.spyOn(custom, 'getBars');
        const ws = mount({
            symbol: 'custom:CALENDAR', timeframes: ['3', '3M', '30S'], providers: { custom: () => custom },
        });
        const menu = await openMenu(ws);
        await vi.waitFor(() => expect(disabled(menu, '30S')).toBe(true));
        row(menu, '3M').click();
        await vi.waitFor(() => expect(ws.active.requestedTimeframe).toBe('3M'));
        await ws.active.chart.ready();
        expect(getBars.mock.calls.some(([ticker, tf]) => ticker === 'CALENDAR' && tf === '3M')).toBe(true);
        ws.active.setTimeframe('3');

        press(ws.root, '3');
        const input = await vi.waitFor(() => {
            expect(quickInput(ws)).not.toBeNull();
            return quickInput(ws)!;
        });
        input.value = '3M';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(ws.root.querySelector('.vela-tq-hint')?.textContent).toBe('3 months');
        press(input, 'Enter');
        expect(ws.active.requestedTimeframe).toBe('3M');
    });

    it('keeps choices available for an offline chart with a provider-qualified label', async () => {
        const ws = mount({
            symbol: 'limited:PLAIN',
            data: [{ time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5 }],
            providers: { limited: () => provider('limited', ['60'], async (ticker) => ({
                ticker, timeframes: { finest: '60' },
            })) },
        });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
    });

    it('refreshes an open menu when a provider resolves the parked chart', async () => {
        const ws = mount({ symbol: 'later:PLAIN' });
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(false);
        ws.active.chart.data.registerProvider('later', provider('later', undefined, async (ticker) => ({
            ticker, timeframes: { finest: '60', list: ['60', '1D'] },
        })));
        await ws.active.chart.ready();
        await vi.waitFor(() => expect(disabled(menu, '3')).toBe(true));
    });

    it('uses the provider when the inline series is empty', async () => {
        const ws = mount({
            symbol: 'limited:PLAIN',
            data: [],
            providers: { limited: () => provider('limited', ['60'], async (ticker) => ({
                ticker, timeframes: { finest: '60' },
            })) },
        });
        await ws.active.chart.ready();
        const menu = await openMenu(ws);
        expect(disabled(menu, '3')).toBe(true);
    });

    it('disables unavailable timeframe buttons in the mobile drawer', async () => {
        const limited = provider('limited', ['60', '1D'], async (ticker) => ({
            ticker, timeframes: { finest: '60', list: ['60', '1D'] },
        }));
        const ws = mount({ layoutMode: 'mobile', symbol: 'limited:PLAIN', providers: { limited: () => limited } });
        expect(ws.root.dataset.layout).toBe('mobile');
        ws.root.querySelector<HTMLButtonElement>('.vela-mb-tf')!.click();
        const drawer = await vi.waitFor(() => {
            const panel = ws.root.querySelector('.vela-drawer[data-state="open"]:has(.vela-tfd-grid)');
            expect(panel).not.toBeNull();
            return panel!;
        });
        const buttons = Array.from(drawer.querySelectorAll<HTMLButtonElement>('.vela-tfd-grid button'));
        await vi.waitFor(() => expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
            ['3m', true],
            ['1h', false],
            ['4h', true],
            ['1D', false],
        ]));
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
