// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DataProvider } from '../src/core/ports/DataProvider';
import type { SymbolInfo } from '../src/core/ports/MarketDataFeed';
import { registerSeriesAdapter } from '../src/data/series-adapters';
import { VelaWorkspace, type VelaWorkspaceOptions } from '../src/workspace/VelaWorkspace';
import { encodeState } from '../src/workspace/persist';

class NoopObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] { return []; }
}
globalThis.ResizeObserver ??= NoopObserver;
globalThis.IntersectionObserver ??= NoopObserver as unknown as typeof IntersectionObserver;
(globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value };
beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const workspaces: VelaWorkspace[] = [];
afterEach(() => {
    for (const workspace of workspaces.splice(0)) workspace.destroy();
    document.body.replaceChildren();
});

const bars = [3, 2, 1].map((i) => ({
    time: Date.UTC(2026, 0, 2) - i * 3_600_000,
    open: 1, high: 2, low: 0.5, close: 1.5,
}));

function mount(options: VelaWorkspaceOptions): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const workspace = new VelaWorkspace(host, {
        layout: '1', layoutMode: 'desktop', timeframe: '60', timeframes: ['3', '60', 'D'],
        volume: false, persist: false, ...options,
    });
    workspaces.push(workspace);
    return workspace;
}

function provider(list: readonly string[]) {
    return {
        getBars: vi.fn(async (_ticker: string, _timeframe: string) => bars),
        getSymbolInfo: async (ticker: string) => ({ ticker, timeframes: { finest: '60', list, ticks: true } }),
    } satisfies DataProvider;
}

function chips(workspace: VelaWorkspace): string[] {
    return Array.from(workspace.root.querySelectorAll('.vela-widget-tf-chips button'), (chip) => chip.textContent ?? '');
}

function press(target: HTMLElement, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function quickInput(workspace: VelaWorkspace): HTMLInputElement | null {
    return workspace.root.querySelector<HTMLInputElement>('.vela-dialog[data-state="open"] .vela-tq-input');
}

async function openQuick(workspace: VelaWorkspace): Promise<HTMLInputElement> {
    press(workspace.root, '1');
    return vi.waitFor(() => {
        expect(quickInput(workspace)).not.toBeNull();
        return quickInput(workspace)!;
    });
}

function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

describe('workspace timeframe shortcuts', () => {
    it('hides excluded favorites per market and preserves their saved values', async () => {
        const limited = provider(['60', 'D']);
        const flexible = provider(['3', '15', '60']);
        const workspace = mount({
            providers: { limited: () => limited, flexible: () => flexible },
            persist: 'timeframe-shortcuts',
            storage: {
                get: () => encodeState({
                    version: 1, layout: '2h', activeCellId: 'a',
                    charts: [
                        { id: 'a', symbol: 'limited:LIST', timeframe: '60' },
                        { id: 'b', symbol: 'flexible:LIST', timeframe: '60' },
                    ],
                    timeframeFavorites: ['3', '15', '60'],
                }),
                set: () => {},
            },
        });

        await vi.waitFor(() => expect(chips(workspace)).toEqual(['1h']));
        workspace.setActiveCell('b');
        await vi.waitFor(() => expect(chips(workspace)).toEqual(['3m', '15m', '1h']));
        workspace.setActiveCell('a');
        expect(chips(workspace)).toEqual(['1h']);
        expect(workspace.getState().timeframeFavorites).toEqual(['3', '15', '60']);

        workspace.applyState({ ...workspace.getState(), timeframeFavorites: ['60', '240'] });
        await vi.waitFor(() => expect(chips(workspace)).toEqual(['1h']));
        expect(workspace.getState().timeframeFavorites).toEqual(['60', '240']);
    });

    it('keeps quick entry open for an unavailable non-preset and applies a supported one', async () => {
        const limited = provider(['60', '120', 'D']);
        const workspace = mount({ symbol: 'limited:LIST', providers: { limited: () => limited } });
        await workspace.active.chart.ready();

        const input = await openQuick(workspace);
        type(input, '15');
        press(input, 'Enter');
        await vi.waitFor(() => expect(workspace.root.querySelector('.vela-tq-hint')?.textContent).toBe('Not available for this symbol'));
        expect(quickInput(workspace)).toBe(input);
        expect(workspace.active.requestedTimeframe).toBe('60');
        expect(limited.getBars.mock.calls.map(([, timeframe]) => timeframe)).not.toContain('15');

        type(input, '120');
        press(input, 'Enter');
        await vi.waitFor(() => {
            expect(quickInput(workspace)).toBeNull();
            expect(workspace.active.requestedTimeframe).toBe('120');
        });
    });

    it('honors asynchronous series adapter availability and ignores an obsolete quick entry decision', async () => {
        const tickSource = provider(['60']);
        const delayed = deferred<boolean>();
        const supports = vi.fn(async (_context, timeframe: string) => {
            if (timeframe === '100T') return delayed.promise;
            return timeframe === '200T';
        });
        const dispose = registerSeriesAdapter({
            id: 'timeframe-shortcuts-test',
            matches: (timeframe, source) => source === tickSource && timeframe.endsWith('T'),
            getBars: async () => bars,
            supports,
        });
        try {
            const workspace = mount({
                symbol: 'tick:LIST', providers: { tick: () => tickSource }, timeframes: ['60', '10T'],
            });
            await workspace.active.chart.ready();
            const input = await openQuick(workspace);

            type(input, '10T');
            press(input, 'Enter');
            await vi.waitFor(() => expect(workspace.root.querySelector('.vela-tq-hint')?.textContent).toBe('Not available for this symbol'));
            expect(workspace.active.requestedTimeframe).toBe('60');

            type(input, '100T');
            press(input, 'Enter');
            await vi.waitFor(() => expect(supports).toHaveBeenCalledWith(expect.anything(), '100T'));
            type(input, '200T');
            delayed.resolve(true);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(workspace.active.requestedTimeframe).toBe('60');
            expect(quickInput(workspace)).toBe(input);

            press(input, 'Enter');
            await vi.waitFor(() => expect(workspace.active.requestedTimeframe).toBe('200T'));
        } finally {
            delayed.resolve(false);
            dispose();
        }
    });

    it.each(['favorite', 'quick entry'])('checks %s against the pending metadata for the new symbol', async (shortcut) => {
        const pending = deferred<SymbolInfo>();
        const getBars = vi.fn(async (_ticker: string, _timeframe: string) => bars);
        const source: DataProvider = {
            getBars,
            getSymbolInfo: async (ticker) => ticker === 'WAIT'
                ? pending.promise
                : { ticker, timeframes: { finest: '15', list: ['15', '60'] } },
        };
        const workspace = mount({ symbol: 'source:OPEN', providers: { source: () => source } });
        const restricted = { ticker: 'WAIT', timeframes: { finest: '60', list: ['60'] } };
        try {
            await workspace.active.chart.ready();
            workspace.applyState({ ...workspace.getState(), timeframeFavorites: ['15', '60'] });
            await vi.waitFor(() => expect(chips(workspace)).toEqual(['15m', '1h']));
            workspace.active.setSymbol('source:WAIT');
            if (shortcut === 'favorite') {
                const chip = workspace.root.querySelector<HTMLButtonElement>('.vela-widget-tf-chips button')!;
                expect(chip.textContent).toBe('15m');
                chip.click();
            } else {
                const input = await openQuick(workspace);
                type(input, '15');
                press(input, 'Enter');
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(workspace.active.chart.market.timeframe).toBe('60');

            pending.resolve(restricted);
            await vi.waitFor(() => expect(chips(workspace)).toEqual(['1h']));
            if (shortcut === 'quick entry') {
                await vi.waitFor(() => expect(workspace.root.querySelector('.vela-tq-hint')?.textContent).toBe('Not available for this symbol'));
                expect(quickInput(workspace)).not.toBeNull();
            }
            expect(getBars.mock.calls.some(([ticker, timeframe]) => ticker === 'WAIT' && timeframe === '15')).toBe(false);
        } finally {
            pending.resolve(restricted);
        }
    });

    it.each(['symbol', 'timeframe', 'active cell'])('discards an in-flight adapter verdict after a newer %s selection', async (change) => {
        const pendingBars = deferred<typeof bars>();
        const pendingSupport = deferred<boolean>();
        const source: DataProvider = {
            ...provider(['60']),
            getBars: async (ticker, timeframe) => ticker === 'NEXT' || timeframe === 'D' ? pendingBars.promise : bars,
        };
        const supports = vi.fn(() => pendingSupport.promise);
        const dispose = registerSeriesAdapter({
            id: 'timeframe-shortcuts-market-switch-test',
            matches: (tf, dataSource) => dataSource === source && tf === '100T',
            getBars: async () => bars,
            supports,
        });
        try {
            const workspace = mount({ symbol: 'source:OPEN', providers: { source: () => source } });
            await workspace.active.chart.ready();
            const input = await openQuick(workspace);
            type(input, '100T');
            press(input, 'Enter');
            await vi.waitFor(() => expect(supports).toHaveBeenCalled());

            const chart = workspace.active.chart;
            let loading: Promise<void> | undefined;
            if (change === 'active cell') {
                const original = workspace.active.id;
                workspace.setActiveCell(null);
                workspace.setActiveCell(original);
            } else if (change === 'timeframe') {
                loading = chart.setMarket({ timeframe: 'D' });
            } else {
                loading = chart.setMarket({ symbol: 'source:NEXT' });
                expect(chart.market.symbol).toBe('source:NEXT');
                expect(workspace.active.symbol).toBe('source:OPEN');
            }
            pendingSupport.resolve(true);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(chart.market.timeframe).toBe(change === 'timeframe' ? 'D' : '60');
            expect(quickInput(workspace)).toBe(input);
            pendingBars.resolve(bars);
            await loading;
        } finally {
            pendingSupport.resolve(false);
            pendingBars.resolve(bars);
            dispose();
        }
    });
});
