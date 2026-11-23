import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    parseTickTimeframe,
    isTickTimeframe,
    isVariableDurationTimeframe,
} from '../src/data/timeframe';
import {
    parseTimeframe,
    timeframeLabel,
    timeframeMs,
    chartTimeframeOf,
    favoriteTimeframeChips,
} from '../src/widget/timeframe';
import { isSameBar, isNewerBar, type OHLCV } from '../src/core/model/ohlcv';
import { formatTimeStamp, timeTicks } from '../src/renderers/native/chrome/ticks';
import { ENGLISH_FORMAT } from '../src/core/format/formatters';
import { MultiProviderFeed } from '../src/data/MultiProviderFeed';
import { BarStore } from '../src/data/BarStore';
import { registerSeriesAdapter, unregisterSeriesAdapter } from '../src/data/series-adapters';
import type { DataProvider } from '../src/core/ports/DataProvider';
import { Vela } from '../src/Vela';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

const ADAPTER_ID = 'test-tick-adapter';

afterEach(() => {
    unregisterSeriesAdapter(ADAPTER_ID);
});

describe('tick timeframe grammar', () => {
    it('parses nT and bare T counts and rejects invalid inputs', () => {
        expect(parseTickTimeframe('1T')).toBe(1);
        expect(parseTickTimeframe('T')).toBe(1);
        expect(parseTickTimeframe('100T')).toBe(100);
        expect(parseTickTimeframe('500t')).toBe(500);
        expect(parseTickTimeframe('0T')).toBeNull();
        expect(parseTickTimeframe('60')).toBeNull();
        expect(parseTickTimeframe('30S')).toBeNull();
        expect(parseTickTimeframe('1D')).toBeNull();
        expect(isTickTimeframe('10T')).toBe(true);
        expect(isVariableDurationTimeframe('10T')).toBe(true);
        expect(isVariableDurationTimeframe('15')).toBe(false);
    });

    it('integrates T into widget timeframe parsing, labels, and chip sorting', () => {
        expect(parseTimeframe('100T')).toMatchObject({
            valid: true,
            count: 100,
            unit: 'T',
            canonical: '100T',
            label: '100 ticks',
            short: '100T',
        });
        expect(parseTimeframe('T')).toMatchObject({
            valid: true,
            count: 1,
            unit: 'T',
            canonical: '1T',
            label: '1 tick',
            short: '1T',
        });
        expect(timeframeLabel('250T')).toBe('250T');
        expect(chartTimeframeOf('T')).toBe('1T');
        expect(chartTimeframeOf('500t')).toBe('500T');
        expect(Number.isNaN(timeframeMs('100T'))).toBe(true);
        expect(favoriteTimeframeChips(['D', '100T', '5', '10T', '1S', '1T', 'nope'])).toEqual([
            '1T',
            '10T',
            '100T',
            '1S',
            '5',
            'D',
            'nope',
        ]);
    });
});

describe('same-millisecond bar identity', () => {
    it('distinguishes same-ms bars by seq while keeping plain time semantics without seq', () => {
        const a: OHLCV = { time: 1000, open: 10, high: 11, low: 9, close: 10, seq: 1 };
        const aRefined: OHLCV = { time: 1000, open: 10, high: 12, low: 9, close: 12, seq: 1 };
        const b: OHLCV = { time: 1000, open: 12, high: 12, low: 11, close: 11, seq: 2 };
        const plain1: OHLCV = { time: 1000, open: 10, high: 10, low: 10, close: 10 };
        const plain2: OHLCV = { time: 1000, open: 11, high: 11, low: 11, close: 11 };

        expect(isSameBar(a, aRefined)).toBe(true);
        expect(isNewerBar(aRefined, a)).toBe(false);
        expect(isSameBar(a, b)).toBe(false);
        expect(isNewerBar(b, a)).toBe(true);
        expect(isSameBar(plain1, plain2)).toBe(true);
        expect(isNewerBar(plain2, plain1)).toBe(false);
    });
});

describe('sub-minute time formatting', () => {
    it('includes seconds on second-level time axis ticks and sub-minute crosshair stamps', () => {
        const t0 = Date.UTC(2026, 7, 30, 14, 30, 0);
        const ticks = timeTicks(t0, t0 + 30_000, 6, 0, ENGLISH_FORMAT);
        expect(ticks.some((tk) => tk.label === '14:30:05' || tk.label === '14:30:10')).toBe(true);
        expect(formatTimeStamp(t0 + 7_000, 'UTC', 5_000, ENGLISH_FORMAT)).toBe("Sun 30 Aug '26 14:30:07");
        expect(formatTimeStamp(t0 + 7_000, 'UTC', 60_000, ENGLISH_FORMAT, 'crosshair', true)).toBe("Sun 30 Aug '26 14:30:07");
        // Standard 1-minute bar without explicit withSeconds stays HH:MM.
        expect(formatTimeStamp(t0 + 7_000, 'UTC', 60_000, ENGLISH_FORMAT)).toBe("Sun 30 Aug '26 14:30");
    });
});

describe('series adapter + variable-duration feed & orchestrator', () => {
    it('routes matching timeframes through a registered SeriesAdapter and preserves duplicate-ms bars', async () => {
        const bars: OHLCV[] = [
            { time: 1_700_000_000_000, open: 100, high: 101, low: 100, close: 101, volume: 1, seq: 0 },
            { time: 1_700_000_000_000, open: 101, high: 102, low: 101, close: 102, volume: 2, seq: 1 },
            { time: 1_700_000_000_500, open: 102, high: 103, low: 102, close: 103, volume: 3, seq: 2 },
        ];
        const provider: DataProvider = {
            getBars: vi.fn(async () => []),
            getBarsProgressive: vi.fn(async () => []),
        };
        registerSeriesAdapter({
            id: ADAPTER_ID,
            matches: (tf) => isTickTimeframe(tf),
            getBars: async () => bars,
        });

        const feed = new MultiProviderFeed(new BarStore());
        await feed.registerProvider('mock', provider);

        const prog = await feed.loadProgressive({ symbol: 'mock:BTCUSDT', timeframe: '10T' }, () => {});
        expect(prog).toBeNull(); // adapter owns loading via `load`
        const loaded = await feed.load({ symbol: 'mock:BTCUSDT', timeframe: '10T' });
        expect(loaded).toHaveLength(3);
        expect(loaded[0]!.seq).toBe(0);
        expect(loaded[1]!.seq).toBe(1);
        expect(provider.getBars).not.toHaveBeenCalled();
    });

    it('passes variableDuration, appends same-ms seq bars, skips gap healing, and supports force reload', async () => {
        let onLiveBar: ((bar: OHLCV) => void) | null = null;
        let loadCount = 0;
        const loadRange = vi.fn(async () => []);
        const { fakeRenderer, container, setBarsCalls, updateBarCalls } = fakeChartParts();

        const chart = new Vela(
            container,
            { symbol: 'BTCUSDT', timeframe: '10T', live: true, volume: false, drawings: false },
            {
                renderer: fakeRenderer,
                dataFeed: {
                    load: async () => {
                        loadCount += 1;
                        return [
                            { time: 10_000, open: 100, high: 101, low: 100, close: 101, seq: 0 },
                            { time: 10_000, open: 101, high: 102, low: 101, close: 102, seq: 1 },
                        ];
                    },
                    loadRange,
                    subscribe: (_cfg, cb) => {
                        onLiveBar = cb;
                        return () => {
                            onLiveBar = null;
                        };
                    },
                },
            },
        );
        await chart.ready();

        expect(setBarsCalls[0]?.opts?.variableDuration).toBe(true);
        expect(setBarsCalls[0]?.bars).toHaveLength(2);

        // Refine forming bar (same time + same seq)
        onLiveBar!({ time: 10_000, open: 101, high: 105, low: 101, close: 105, seq: 1 });
        // Open new bar in the EXACT same ms (same time + higher seq)
        onLiveBar!({ time: 10_000, open: 105, high: 106, low: 105, close: 106, seq: 2 });
        // Open new bar 10 hours later — must NOT trigger time-based gap healing!
        onLiveBar!({ time: 10_000 + 10 * 3_600_000, open: 106, high: 107, low: 106, close: 107, seq: 3 });

        expect(updateBarCalls).toHaveLength(3);
        expect(loadRange).not.toHaveBeenCalled();

        // Force reload re-runs load even with unchanged market strings
        await chart.setMarket({ force: true });
        expect(loadCount).toBe(2);

        chart.destroy();
    });

    it('backfills older history whose bars share a millisecond and are ordered by seq', async () => {
        const { fakeRenderer, container, setBarsCalls } = fakeChartParts();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const loadRange = vi
            .fn<(cfg: unknown, range: { to?: number; limit?: number }) => Promise<OHLCV[]>>()
            .mockResolvedValueOnce([
                { time: 5_000, open: 90, high: 91, low: 90, close: 91, seq: 0 },
                { time: 5_000, open: 91, high: 92, low: 91, close: 92, seq: 1 },
                { time: 5_000, open: 92, high: 93, low: 92, close: 93, seq: 2 },
            ])
            .mockResolvedValue([]);

        const chart = new Vela(
            container,
            // Deeper than one load: the head paints first, older chunks follow.
            { symbol: 'BTCUSDT', timeframe: '10T', bars: 6_000, live: false, volume: false, drawings: false },
            {
                renderer: fakeRenderer,
                dataFeed: {
                    load: async () => [
                        { time: 10_000, open: 100, high: 101, low: 100, close: 101, seq: 0 },
                        { time: 10_001, open: 101, high: 102, low: 101, close: 102, seq: 1 },
                    ],
                    loadRange,
                    subscribe: () => () => {},
                },
            },
        );
        await chart.ready();
        await chart.historyComplete();

        expect(loadRange).toHaveBeenCalledTimes(2); // the chunk, then the empty answer that ends the walk
        expect(setBarsCalls[setBarsCalls.length - 1]?.bars.map((b) => [b.time, b.seq])).toEqual([
            [5_000, 0],
            [5_000, 1],
            [5_000, 2],
            [10_000, 0],
            [10_001, 1],
        ]);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        chart.destroy();
    });
});

/** A renderer that records the bars it is given, and the container a headless chart needs. */
function fakeChartParts(): {
    fakeRenderer: IChartRenderer;
    container: HTMLElement;
    setBarsCalls: Array<{ bars: OHLCV[]; opts?: { preserveView?: boolean; variableDuration?: boolean } }>;
    updateBarCalls: OHLCV[];
} {
    const setBarsCalls: Array<{ bars: OHLCV[]; opts?: { preserveView?: boolean; variableDuration?: boolean } }> = [];
    const updateBarCalls: OHLCV[] = [];
    const fakeRenderer = {
        capabilities: { native: true },
        features: [],
        applyFeature: () => {},
        readFeature: () => undefined,
        mount: () => {},
        setTheme: () => {},
        resize: () => {},
        destroy: () => {},
        setBars: (b: OHLCV[], opts?: { preserveView?: boolean; variableDuration?: boolean }) => {
            setBarsCalls.push({ bars: [...b], opts });
        },
        updateBar: (b: OHLCV) => {
            updateBarCalls.push(b);
        },
        mountIndicator: () => ({ id: 'x', update: () => {}, setVisible: () => {}, unmount: () => {} }),
        setIndicatorInputs: () => {},
        setIndicatorStatus: () => {},
        fitContent: () => {},
        setVisibleRange: () => {},
        getVisibleRange: () => null,
        onVisibleRangeChange: () => () => {},
        onViewportChange: () => () => {},
        onPriceStyleChange: () => () => {},
        onCrosshairMove: () => () => {},
        onClick: () => () => {},
        onPaneAction: () => () => {},
        onPriceStyleWillChange: () => () => {},
        onInputChange: () => () => {},
        onRemoveIndicator: () => () => {},
        orderPanes: () => {},
        listPanes: () => [],
        getConfig: () => ({}),
        applyConfig: () => {},
        dataWindowReadout: () => null,
        closeDialogs: () => {},
        focus: () => {},
    } as unknown as IChartRenderer;
    const container = {
        style: {},
        appendChild: () => {},
        querySelector: () => null,
    } as unknown as HTMLElement;
    return { fakeRenderer, container, setBarsCalls, updateBarCalls };
}
