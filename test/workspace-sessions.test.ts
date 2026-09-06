// Workspace session identity: metadata supplies optional UI structure, but an omitted
// host catalog must leave the provider-facing ID open. These tests construct the real
// ChartCell while replacing only its chart/UI dependencies with small recording fakes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarketSession } from '../src/core/options';
import { DARK_THEME } from '../src/core/theme';
import type { CellBoot, CellDeps } from '../src/workspace/ChartCell';
import type { CellState } from '../src/state/document';
import { registerStatePersistence } from '../src/widget/contributions';

const velaRecorder = vi.hoisted(() => ({
    options: [] as Array<Record<string, unknown>>,
    instances: [] as Array<{
        market: Record<string, unknown>;
        setMarket: ReturnType<typeof vi.fn>;
    }>,
    symbolInfo: { session: '0930-1600', session_extended: '0400-2000', timezone: 'America/New_York' } as Record<string, unknown>,
}));

vi.mock('../src/Vela', () => {
    class RecordingVela {
        readonly renderer = {
            set: vi.fn(),
            get: vi.fn((key: string) => key === 'priceStyle' ? 'candles' : undefined),
            getConfig: vi.fn(() => null),
            applyConfig: vi.fn(),
            supports: vi.fn(() => false),
            setLegendActions: vi.fn(),
            setLegendCallouts: vi.fn(),
            setSettingsSections: vi.fn(),
            onConfigChanged: vi.fn(() => () => undefined),
            onCrosshairMove: vi.fn(() => () => undefined),
        };
        readonly drawings = {
            fromJSON: vi.fn(),
            toJSON: vi.fn(() => undefined),
            undo: vi.fn(),
            redo: vi.fn(),
        };
        readonly data = {
            ready: vi.fn(async () => undefined),
            symbolInfo: vi.fn(async () => velaRecorder.symbolInfo),
            displayPrefix: vi.fn(() => undefined),
            symbolIcon: vi.fn(async () => undefined),
        };
        readonly addIndicator = vi.fn(() => ({
            id: 'external-script',
            title: 'External script',
            inputs: [],
            props: [],
            visible: true,
            inputValues: () => ({}),
            propValues: () => ({}),
            setInput: vi.fn(),
            setInputs: vi.fn(),
            setProp: vi.fn(),
            setProps: vi.fn(),
            setVisible: vi.fn(),
            moveTo: vi.fn(),
            on: vi.fn(() => () => undefined),
            context: vi.fn(async () => null),
            remove: vi.fn(),
        }));
        readonly market: Record<string, unknown>;
        readonly setMarket = vi.fn(async (next: Record<string, unknown>) => {
            Object.assign(this.market, next);
        });

        constructor(_host: HTMLElement, options: Record<string, unknown>) {
            this.market = {
                symbol: options.symbol,
                provider: undefined,
                timeframe: options.timeframe ?? '60',
                session: options.session,
            };
            velaRecorder.options.push(options);
            velaRecorder.instances.push(this);
        }

        registerEngine(): this { return this; }
        on(): () => void { return () => undefined; }
        getVisibleRange(): null { return null; }
        indicators(): never[] { return []; }
        presentNativeIndicators(): string[] { return []; }
        availableNativeIndicators(): Promise<never[]> { return Promise.resolve([]); }
        destroy(): void {}
    }

    return { Vela: RecordingVela };
});

vi.mock('../src/widget/cell-controls', () => ({
    CellControls: class {
        refresh(): void {}
        setSuspended(): void {}
        destroy(): void {}
    },
}));

vi.mock('../src/widget/context-menu', () => ({
    ChartContextMenu: class {
        onChart(): void {}
        destroy(): void {}
    },
}));

import { ChartCell } from '../src/workspace/ChartCell';

interface StubElement {
    ownerDocument: { createElement(tag: string): StubElement };
    className: string;
    dataset: Record<string, string>;
    style: { cssText: string; setProperty(name: string, value: string): void };
    children: StubElement[];
    addEventListener(): void;
    appendChild(child: StubElement): StubElement;
    remove(): void;
}

function stubGrid(): StubElement {
    const doc = {
        createElement(_tag: string): StubElement {
            const el: StubElement = {
                ownerDocument: doc,
                className: '',
                dataset: {},
                style: { cssText: '', setProperty: () => undefined },
                children: [],
                addEventListener: () => undefined,
                appendChild: (child) => (el.children.push(child), child),
                remove: () => undefined,
            };
            return el;
        },
    };
    return doc.createElement('div');
}

function deps(onStateDirty = vi.fn()): CellDeps {
    const noOp = (): void => undefined;
    return {
        feed: {} as CellDeps['feed'],
        engines: {},
        chartDefaults: {},
        theme: DARK_THEME,
        live: false,
        volume: false,
        statusline: false,
        watermark: false,
        nativeBackend: 'canvas2d',
        dialogHost: stubGrid() as unknown as HTMLElement,
        timezone: () => 'Etc/UTC',
        setTimezone: noOp,
        context: () => ({}) as ReturnType<CellDeps['context']>,
        manifestSettled: () => true,
        activate: noOp,
        multiCell: () => false,
        isMaximized: () => false,
        toggleMaximize: noOp,
        cellDragTarget: () => null,
        previewDropTarget: noOp,
        dropCell: noOp,
        onMarketChanged: noOp,
        onPriceStyleChanged: noOp,
        onIndicatorsChanged: noOp,
        onStatusPrefsChanged: noOp,
        onStateDirty,
        toast: noOp,
    };
}

function makeCell(seed: CellBoot, cellDeps = deps()): {
    cell: ChartCell;
    chart: (typeof velaRecorder.instances)[number];
} {
    const cell = new ChartCell('c1', stubGrid() as unknown as HTMLElement, seed, cellDeps);
    return { cell, chart: velaRecorder.instances[velaRecorder.instances.length - 1]! };
}

async function settle(): Promise<void> {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

beforeEach(() => {
    velaRecorder.options.length = 0;
    velaRecorder.instances.length = 0;
});

describe('ChartCell provider-facing sessions without an explicit catalog', () => {
    it('normalizes and preserves an arbitrary constructor session in the chart and getter', () => {
        const { cell } = makeCell({ session: '  Tokyo-AM  ' });

        expect(velaRecorder.options[0]?.session).toBe('Tokyo-AM');
        expect(velaRecorder.options[0]?.sessions).toBeUndefined();
        expect(cell.session).toBe('Tokyo-AM');
        cell.destroy();
    });

    it('accepts arbitrary setter IDs exactly once while ignoring empty and repeated IDs', () => {
        const dirty = vi.fn();
        const { cell, chart } = makeCell({ session: 'Tokyo-AM' }, deps(dirty));

        cell.setSession('  Tokyo-PM  ');
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(chart.setMarket).toHaveBeenLastCalledWith({ session: 'Tokyo-PM' });
        expect(cell.session).toBe('Tokyo-PM');
        expect(dirty).toHaveBeenCalledOnce();

        cell.setSession('Tokyo-PM');
        cell.setSession('   ' as MarketSession);
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(dirty).toHaveBeenCalledOnce();
        cell.destroy();
    });

    it('keeps an explicit regular ID distinct from the omitted provider default', () => {
        const dirty = vi.fn();
        const { cell, chart } = makeCell({}, deps(dirty));

        expect(chart.market.session).toBeUndefined();
        expect(cell.session).toBe('regular');

        cell.setSession('regular');
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(chart.setMarket).toHaveBeenLastCalledWith({ session: 'regular' });
        expect(chart.market.session).toBe('regular');
        expect(dirty).toHaveBeenCalledOnce();

        cell.setSession('regular');
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(dirty).toHaveBeenCalledOnce();
        cell.destroy();
    });

    it('rehydrates an arbitrary saved ID in place and converges on repeat application', () => {
        const { cell, chart } = makeCell({ session: 'Tokyo-AM' });
        const restored: CellState = { session: '  Tokyo-Night  ' };

        cell.rehydrate(restored);
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(chart.setMarket).toHaveBeenLastCalledWith({ session: 'Tokyo-Night' });
        expect(cell.session).toBe('Tokyo-Night');

        chart.setMarket.mockClear();
        cell.rehydrate(restored);
        expect(chart.setMarket).not.toHaveBeenCalled();
        cell.destroy();
    });

    it('rehydrates an explicitly saved regular ID over an omitted provider default', () => {
        const { cell, chart } = makeCell({});
        const restored: CellState = { session: 'regular' };

        cell.rehydrate(restored);
        expect(chart.setMarket).toHaveBeenCalledOnce();
        expect(chart.setMarket).toHaveBeenLastCalledWith({ session: 'regular' });
        expect(chart.market.session).toBe('regular');

        chart.setMarket.mockClear();
        cell.rehydrate(restored);
        expect(chart.setMarket).not.toHaveBeenCalled();
        cell.destroy();
    });

    it('round-trips an arbitrary live ID through the dormant-cell pool state', () => {
        const first = makeCell({ session: 'Tokyo-AM' });
        first.cell.setSession('Tokyo-Night');
        const pooled = first.cell.dehydrate();
        expect(pooled.session).toBe('Tokyo-Night');
        first.cell.destroy();

        const restored = makeCell(pooled);
        expect(velaRecorder.options[velaRecorder.options.length - 1]?.session).toBe('Tokyo-Night');
        expect(restored.cell.session).toBe('Tokyo-Night');
        restored.cell.destroy();
    });

    it('adds the active arbitrary ID to metadata-derived workspace choices', async () => {
        const { cell } = makeCell({ symbol: 'TEST', session: 'Tokyo-AM' });
        await settle();

        expect(cell.sessionAvailable).toBe(true);
        expect(cell.sessions).toEqual([
            { id: 'regular', label: 'Regular hours (RTH)' },
            { id: 'extended', label: 'Extended hours (ETH)' },
            { id: 'Tokyo-AM', label: 'Tokyo-AM' },
        ]);
        cell.destroy();
    });
});

describe('ChartCell state rehydration convergence', () => {
    it('keeps equal plugin state live, but restores it after a changed core ledger rebuild', () => {
        const restore = vi.fn((_payload, context) => {
            context.addIndicator({ name: 'External script', script: 'plot(close)' });
        });
        const unregister = registerStatePersistence({
            key: 'test.external-script',
            scope: 'cell',
            serialize: () => ({ enabled: true }),
            restore,
        });

        try {
            const { cell } = makeCell({
                session: 'regular',
                indicators: { manifest: [], natives: [] },
                ext: { 'test.external-script': { enabled: true } },
            });
            cell.restorePersistedExt();
            const unchanged = cell.dehydrate();

            cell.rehydrate(unchanged);
            expect(restore).toHaveBeenCalledOnce();

            cell.rehydrate({
                ...unchanged,
                indicators: { manifest: ['Changed core entry'], natives: [] },
            });
            expect(restore).toHaveBeenCalledTimes(2);
            cell.destroy();
        } finally {
            unregister();
        }
    });
});
