// The data-window seam: the native renderer's readout (which bar it reads, and the shape it
// hands out) and the widget panel's pure layout of that readout into sections.
import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { RendererControl } from '../src/core/RendererControl';
import { dataWindowSections } from '../src/widget/data-window';
import type { DataWindowReadout, IChartRenderer } from '../src/core/ports/IChartRenderer';
import type { OHLCV } from '../src/core/model/ohlcv';

const HOUR = 3_600_000;

function bars(closes: number[], withVolume = false): OHLCV[] {
    return closes.map((close, i) => ({
        time: 1_700_000_000_000 + i * HOUR,
        open: close - 1,
        high: close + 2,
        low: close - 2,
        close,
        ...(withVolume ? { volume: 1234 } : {}),
    }));
}

/** Unmounted but sized — the readout is pure over bars + scales (mirrors the other native tests). */
function makeRenderer(): { r: NativeRenderer; anyR: any } {
    const r = new NativeRenderer();
    const anyR = r as any;
    anyR.coords.setSize(800, 200, 1);
    if (!anyR.scheduler) anyR.scheduler = { invalidate: () => {} };
    if (!anyR.animator) anyR.animator = { active: false, start: () => {}, stop: () => {} };
    anyR.introPlayed = true;
    return { r, anyR };
}

describe('NativeRenderer.getDataWindowReadout', () => {
    it('is empty until there are bars', () => {
        const { r } = makeRenderer();
        expect(r.getDataWindowReadout()).toEqual({ date: '', time: '', ohlc: null, groups: [] });
    });

    it('reads the LATEST bar while the cursor is off the plot', () => {
        const { r } = makeRenderer();
        r.setBars(bars([100, 101, 105]));
        const readout = r.getDataWindowReadout();
        expect(readout.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(readout.time).toMatch(/^\d{2}:\d{2}$/);
        expect(Number(readout.ohlc?.c)).toBeCloseTo(105);
        expect(Number(readout.ohlc?.o)).toBeCloseTo(104);
        expect(Number(readout.ohlc?.h)).toBeCloseTo(107);
        expect(Number(readout.ohlc?.l)).toBeCloseTo(103);
        expect(readout.ohlc?.up).toBe(true); // close 105 ≥ open 104
    });

    it('reads the HOVERED bar instead, and reports a down bar as down', () => {
        const { r, anyR } = makeRenderer();
        r.setBars([...bars([100, 101]), { time: 1_700_000_000_000 + 2 * HOUR, open: 110, high: 111, low: 98, close: 99 }]);
        anyR.hoverLogical = 0;
        expect(Number(r.getDataWindowReadout().ohlc?.c)).toBeCloseTo(100);
        anyR.hoverLogical = 2;
        const hovered = r.getDataWindowReadout();
        expect(Number(hovered.ohlc?.c)).toBeCloseTo(99);
        expect(hovered.ohlc?.up).toBe(false);
    });

    it('carries volume only when the bar has it', () => {
        const { r } = makeRenderer();
        r.setBars(bars([100, 101]));
        expect(r.getDataWindowReadout().ohlc?.vol).toBeUndefined();
        const withVol = makeRenderer();
        withVol.r.setBars(bars([100, 101], true));
        expect(withVol.r.getDataWindowReadout().ohlc?.vol).toBe('1.23K');
    });

    it('no longer exposes a floating data-window feature — the readout is the only seam', () => {
        expect(new NativeRenderer().features).not.toContain('dataWindow');
    });
});

describe('RendererControl.dataWindowReadout', () => {
    const readout: DataWindowReadout = { date: '2023-11-14', time: '22:13', ohlc: null, groups: [] };

    it('delegates to the renderer that provides one', () => {
        const control = new RendererControl({ getDataWindowReadout: () => readout } as unknown as IChartRenderer);
        expect(control.dataWindowReadout()).toBe(readout);
    });

    it('is null on a renderer without the seam', () => {
        const control = new RendererControl({} as unknown as IChartRenderer);
        expect(control.dataWindowReadout()).toBeNull();
    });
});

describe('dataWindowSections', () => {
    it('has no sections when the chart holds no bar', () => {
        expect(dataWindowSections({ date: '', time: '', ohlc: null, groups: [] })).toEqual([]);
    });

    it('lays the readout out as Time, Price, then one section per indicator', () => {
        const sections = dataWindowSections({
            date: '2023-11-14',
            time: '22:13',
            ohlc: { o: '104.00', h: '107.00', l: '103.00', c: '105.00', vol: '1.23K', up: true },
            groups: [
                { name: 'Moving Average', rows: [{ label: 'MA', value: '102.50', color: '#2962ff' }] },
                { name: 'RSI', rows: [{ label: 'RSI', value: '61.20', color: '#7e57c2' }, { label: 'Signal', value: '58.90', color: '#ff9800' }] },
            ],
        });
        expect(sections.map((s) => s.title)).toEqual(['Time', 'Price', 'Moving Average', 'RSI']);
        expect(sections[0]?.lines).toEqual([
            { label: 'Date', value: '2023-11-14', color: '' },
            { label: 'Time', value: '22:13', color: '' },
        ]);
        expect(sections[1]?.lines.map((l) => l.label)).toEqual(['Open', 'High', 'Low', 'Close', 'Volume']);
        expect(sections[1]?.lines.every((l) => l.color === 'var(--vela-up)')).toBe(true);
        expect(sections[3]?.lines).toEqual([
            { label: 'RSI', value: '61.20', color: '#7e57c2' },
            { label: 'Signal', value: '58.90', color: '#ff9800' },
        ]);
    });

    it('tints a down bar with the down color and drops the Volume line without volume', () => {
        const sections = dataWindowSections({
            date: '2023-11-14',
            time: '22:13',
            ohlc: { o: '110.00', h: '111.00', l: '98.00', c: '99.00', up: false },
            groups: [],
        });
        expect(sections[1]?.lines.map((l) => l.label)).toEqual(['Open', 'High', 'Low', 'Close']);
        expect(sections[1]?.lines.every((l) => l.color === 'var(--vela-down)')).toBe(true);
    });

    it('shows a dash for a missing date or time rather than an empty row', () => {
        const sections = dataWindowSections({ date: '2023-11-14', time: '', ohlc: null, groups: [] });
        expect(sections[0]?.lines).toEqual([
            { label: 'Date', value: '2023-11-14', color: '' },
            { label: 'Time', value: '—', color: '' },
        ]);
    });
});
