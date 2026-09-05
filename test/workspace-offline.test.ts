// Exercise the real workspace pool and ChartCell with recording chart/UI dependencies.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import { VelaWorkspace, type VelaWorkspaceOptions } from '../src/workspace/VelaWorkspace';
import { layoutDefinition, registerBuiltinLayouts } from '../src/workspace/layouts';

const velaRecorder = vi.hoisted(() => ({
    options: [] as Array<Record<string, unknown>>,
    symbolInfo: { session: '0930-1600', session_extended: '0400-2000', timezone: 'America/New_York' } as Record<string, unknown>,
    onMarketLoad: undefined as (() => void) | undefined,
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
            setLayoutMode: vi.fn(),
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
        private readonly recordSetMarket = vi.fn(async (next: Record<string, unknown>) => {
            const changed = next.data !== undefined
                || ['symbol', 'timeframe', 'session', 'bars'].some((key) => next[key] !== undefined && next[key] !== this.market[key]);
            if (!changed) return;
            Object.assign(this.market, next);
            if (next.data !== undefined) this.market.offline = true;
            else if (next.symbol !== undefined) this.market.offline = false;
            velaRecorder.onMarketLoad?.();
        });

        setMarket(next: Record<string, unknown>): Promise<void> {
            return this.recordSetMarket(next);
        }

        constructor(_host: HTMLElement, options: Record<string, unknown>) {
            this.market = {
                symbol: options.symbol,
                provider: undefined,
                timeframe: options.timeframe ?? '60',
                session: options.session,
                offline: options.data !== undefined,
            };
            velaRecorder.options.push(options);
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

beforeEach(() => {
    velaRecorder.options.length = 0;
    velaRecorder.onMarketLoad = undefined;
});

function makePoolWorkspace(options: VelaWorkspaceOptions): VelaWorkspace {
    registerBuiltinLayouts();
    const grid = stubGrid();
    const workspace = Object.assign(Object.create(VelaWorkspace.prototype) as object, {
        opts: { statusline: false, watermark: false, volume: false, nativeBackend: 'canvas2d', ...options },
        order: Object.keys(options.cells ?? { first: {}, second: {} }),
        def: layoutDefinition('2h')!,
        pool: new Map(),
        poolBoot: new WeakMap(),
        cellsById: new Map(),
        trackSizes: new Map(),
        activeId: 'first',
        gridEl: grid,
        root: grid,
        feed: {},
        cellBackend: 'canvas2d',
        manifest: [],
        favs: [],
        tfFavs: [],
        extState: {},
        syncOpts: {},
        timezone: 'Etc/UTC',
        layoutCtl: { current: 'desktop' },
        dock: { getState: () => undefined },
        topbar: { setLayout: vi.fn() },
        events: { emit: vi.fn() },
        wireCell: vi.fn(),
        mountAttributionMark: vi.fn(),
        clearMaximized: vi.fn(),
        applyGrid: vi.fn(),
        alignNewCellStyles: vi.fn(),
        syncCellPresentation: vi.fn(),
        refreshCellControls: vi.fn(),
        refreshRetention: vi.fn(),
        projectActiveCell: vi.fn(),
        markStateDirty: vi.fn(),
        onCellIndicatorsChanged: vi.fn(),
        onCellMarketChanged: vi.fn(),
    }) as unknown as VelaWorkspace;
    workspace.setLayout('2h');
    return workspace;
}

function latestChartOptions(): Record<string, unknown> {
    return velaRecorder.options[velaRecorder.options.length - 1]!;
}

describe('ChartCell inline data in the workspace pool', () => {
    it('restores per-cell inline data after a layout round trip without serializing it', () => {
        const first: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const second: OHLCV[] = [{ time: 1_000, open: 10, high: 20, low: 10, close: 20 }];
        const workspace = makePoolWorkspace({ data: first, cells: { first: {}, second: { data: second } } });

        workspace.setLayout('1');
        expect(workspace.getState().charts.every((state) => !('data' in state) && !('visibleRange' in state))).toBe(true);
        workspace.setLayout('2h');

        expect(latestChartOptions().data).toBe(second);
        expect(workspace.cell('second')?.chart.market.offline).toBe(true);
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('restores the latest inline replacement and current viewport instead of construction defaults', async () => {
        const initial: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const replacement: OHLCV[] = [
            { time: 2_000, open: 10, high: 20, low: 10, close: 20 },
            { time: 3_000, open: 20, high: 30, low: 20, close: 30 },
        ];
        const workspace = makePoolWorkspace({ data: initial, visibleRange: '1M' });
        const chart = workspace.cell('second')!.chart;
        const currentRange = { from: 2_000, to: 3_000 };
        await chart.setMarket({ data: replacement });
        vi.spyOn(chart, 'getVisibleRange').mockReturnValue(currentRange);

        workspace.setLayout('1');
        workspace.setLayout('2h');

        expect(latestChartOptions().data).toBe(replacement);
        expect(latestChartOptions().visibleRange).toEqual(currentRange);
        expect(workspace.getState().charts.every((state) => !('data' in state) && !('visibleRange' in state))).toBe(true);
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('keeps a requested provider switch when pooling before its promise resolves', async () => {
        const data: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const workspace = makePoolWorkspace({ data, symbol: 'fixture:ORIGINAL' });
        const pending = workspace.cell('second')!.chart.setMarket({ symbol: 'fixture:LIVE' });

        workspace.setLayout('1');
        workspace.setLayout('2h');

        expect(latestChartOptions().symbol).toBe('fixture:LIVE');
        expect(latestChartOptions().data).toBeUndefined();
        expect(workspace.cell('second')?.chart.market.offline).toBe(false);
        await pending;
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('retains inline data when a same-symbol request is a no-op', async () => {
        const data: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const workspace = makePoolWorkspace({ data, symbol: 'fixture:ORIGINAL' });
        await workspace.cell('second')!.chart.setMarket({ symbol: 'fixture:ORIGINAL' });

        workspace.setLayout('1');
        workspace.setLayout('2h');

        expect(latestChartOptions().data).toBe(data);
        expect(workspace.cell('second')?.chart.market.offline).toBe(true);
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('captures replacement data when a synchronous loading callback pools the cell', async () => {
        const initial: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const replacement: OHLCV[] = [{ time: 2_000, open: 10, high: 20, low: 10, close: 20 }];
        const workspace = makePoolWorkspace({ data: initial });
        velaRecorder.onMarketLoad = () => workspace.setLayout('1');

        await workspace.cell('second')!.chart.setMarket({ data: replacement });
        velaRecorder.onMarketLoad = undefined;
        workspace.setLayout('2h');

        expect(latestChartOptions().data).toBe(replacement);
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('keeps the latest replacement when a loading callback requests another inline dataset', async () => {
        const initial: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const superseded: OHLCV[] = [{ time: 2_000, open: 10, high: 20, low: 10, close: 20 }];
        const latest: OHLCV[] = [{ time: 3_000, open: 20, high: 30, low: 20, close: 30 }];
        const workspace = makePoolWorkspace({ data: initial });
        const chart = workspace.cell('second')!.chart;
        let innerLoad: Promise<void> | undefined;
        velaRecorder.onMarketLoad = () => {
            velaRecorder.onMarketLoad = undefined;
            innerLoad = chart.setMarket({ data: latest });
        };

        await chart.setMarket({ data: superseded });
        await innerLoad;
        workspace.setLayout('1');
        workspace.setLayout('2h');

        expect(latestChartOptions().data).toBe(latest);
        for (const cell of workspace.cells()) cell.destroy();
    });

    it('preserves every inline dataset when a layout change rebuilds the renderer backend', () => {
        const first: OHLCV[] = [{ time: 1_000, open: 1, high: 2, low: 1, close: 2 }];
        const second: OHLCV[] = [{ time: 1_000, open: 10, high: 20, low: 10, close: 20 }];
        const workspace = makePoolWorkspace({
            data: first,
            nativeBackend: 'auto',
            maxWebglCells: 1,
            cells: { first: {}, second: { data: second } },
        });

        workspace.setLayout('1');
        expect(latestChartOptions().nativeBackend).toBe('auto');
        expect(latestChartOptions().data).toBe(first);
        workspace.setLayout('2h');

        expect(velaRecorder.options.slice(-2).map((options) => options.data)).toEqual([first, second]);
        expect(velaRecorder.options.slice(-2).map((options) => options.nativeBackend)).toEqual(['canvas2d', 'canvas2d']);
        for (const cell of workspace.cells()) cell.destroy();
    });
});
