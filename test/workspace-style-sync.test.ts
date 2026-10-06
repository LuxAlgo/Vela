// @vitest-environment jsdom
// The style link on a live workspace: which looks a linked chart receives when another
// one is edited, and which stay with each chart.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { registerChartType, unregisterChartType } from '../src/chart-types/registry';
import type { ChartConfig } from '../src/renderers/native/core/chartConfig';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const live: VelaWorkspace[] = [];
afterEach(() => {
    for (const ws of live.splice(0)) ws.destroy();
    unregisterChartType('sync-flow');
});

function mountWorkspace(opts: Record<string, unknown>): VelaWorkspace {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, opts as never);
    live.push(ws);
    return ws;
}

function config(ws: VelaWorkspace, id: string): ChartConfig {
    return ws.cell(id)!.chart.renderer.getConfig() as ChartConfig;
}

describe('style link', () => {
    it('candle body colors edited on one chart repaint its linked peers', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { style: true } });
        ws.cell('c1')!.chart.renderer.applyConfig({ candles: { upColor: '#123456', downColor: '#654321' } });
        expect(config(ws, 'c2').candles.upColor).toBe('#123456');
        expect(config(ws, 'c2').candles.downColor).toBe('#654321');
    });

    it('every look the settings dialog edits follows: per-style blocks, spacing, margins, animation, session shading', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { style: true } });
        ws.cell('c1')!.chart.renderer.applyConfig({
            candles: { wickVisible: false, borderVisible: true, borderUpColor: '#00ff00' },
            bars: { upColor: '#0000aa' },
            line: { color: '#aa00aa', width: 4 },
            area: { lineColor: '#00aaaa', topColor: '#00aaaa55' },
            baseline: { topLineColor: '#aaaa00', baselineLevel: 30 },
            series: { spacing: 2 },
            margins: { top: 20, right: 30 },
            animations: { zoom: false, pan: false },
            sessions: { premarketColor: '#ff000022' },
        });
        const c2 = config(ws, 'c2');
        expect(c2.candles).toMatchObject({ wickVisible: false, borderVisible: true, borderUpColor: '#00ff00' });
        expect(c2.bars.upColor).toBe('#0000aa');
        expect(c2.line).toMatchObject({ color: '#aa00aa', width: 4 });
        expect(c2.area).toMatchObject({ lineColor: '#00aaaa', topColor: '#00aaaa55' });
        expect(c2.baseline).toMatchObject({ topLineColor: '#aaaa00', baselineLevel: 30 });
        expect(c2.series.spacing).toBe(2);
        expect(c2.margins).toMatchObject({ top: 20, right: 30 });
        expect(c2.animations).toMatchObject({ zoom: false, pan: false });
        expect(c2.sessions.premarketColor).toBe('#ff000022');
    });

    it('the chart type itself stays per chart', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { style: true } });
        ws.cell('c1')!.chart.renderer.applyConfig({ series: { style: 'line' }, line: { width: 3 } });
        expect(config(ws, 'c1').series.style).toBe('line');
        expect(config(ws, 'c2').series.style).toBe('candles');
        expect(config(ws, 'c2').line.width).toBe(3);
    });

    it('a plugin style mirrors its candle colors but not its own computation settings', () => {
        registerChartType({ id: 'sync-flow' }); // candle-painted by default
        const ws = mountWorkspace({ layout: '2h' });
        ws.cell('c2')!.chart.renderer.applyConfig({ chartTypes: { 'sync-flow': { candleWickUpColor: '#ff0000', rowTicks: 8 } } });
        ws.cell('c1')!.chart.renderer.applyConfig({ chartTypes: { 'sync-flow': { candleUpColor: '#abcdef', rowTicks: 2 } } });
        ws.sync.set('style', true); // aligns the group to the active chart (c1)
        let bag = config(ws, 'c2').chartTypes['sync-flow']!;
        expect(bag.candleUpColor).toBe('#abcdef');
        expect(bag.candleWickUpColor ?? null).toBeNull(); // the origin inherits it, so the peer does too
        expect(bag.rowTicks).toBe(8);

        ws.cell('c1')!.chart.renderer.applyConfig({ chartTypes: { 'sync-flow': { candleDownColor: '#fedcba', rowTicks: 3 } } });
        bag = config(ws, 'c2').chartTypes['sync-flow']!;
        expect(bag.candleDownColor).toBe('#fedcba');
        expect(bag.rowTicks).toBe(8);
    });

    it('the watermark toggles follow like the status line toggles', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { style: true } });
        ws.cell('c1')!.setWatermarkVisible(false);
        ws.cell('c1')!.setReplayWatermarkVisible(false);
        expect(ws.cell('c2')!.statusPrefs()).toMatchObject({ watermark: false, replayWatermark: false });
    });

    it('a chart a layout switch adds arrives with the group candle colors', () => {
        const ws = mountWorkspace({ layout: '1', sync: { style: true } });
        ws.cell('c1')!.chart.renderer.applyConfig({ candles: { upColor: '#123456' }, line: { width: 5 } });
        ws.setLayout('2h');
        expect(config(ws, 'c2').candles.upColor).toBe('#123456');
        expect(config(ws, 'c2').line.width).toBe(5);
    });

    it('turning the link on aligns the group to the active chart, candle colors included', () => {
        const ws = mountWorkspace({ layout: '2h' });
        ws.cell('c1')!.chart.renderer.applyConfig({ candles: { upColor: '#0a0b0c' } });
        expect(config(ws, 'c2').candles.upColor).not.toBe('#0a0b0c');
        ws.sync.set('style', true);
        expect(config(ws, 'c2').candles.upColor).toBe('#0a0b0c');
    });

    it('a named group reaches its own members only', () => {
        const ws = mountWorkspace({ layout: '4', sync: { style: { c1: 'a', c2: 'a', c3: 'b' } } });
        ws.cell('c1')!.chart.renderer.applyConfig({ candles: { upColor: '#112233' } });
        expect(config(ws, 'c2').candles.upColor).toBe('#112233');
        expect(config(ws, 'c3').candles.upColor).not.toBe('#112233');
        expect(config(ws, 'c4').candles.upColor).not.toBe('#112233');
    });

    it('one edit applies once on each peer and never echoes back', () => {
        const ws = mountWorkspace({ layout: '2h', sync: { style: true } });
        let origin = 0;
        let peer = 0;
        ws.cell('c1')!.chart.renderer.onConfigChanged(() => origin++);
        ws.cell('c2')!.chart.renderer.onConfigChanged(() => peer++);
        ws.cell('c1')!.chart.renderer.applyConfig({ candles: { upColor: '#445566' } });
        expect(origin).toBe(1);
        expect(peer).toBe(1);
    });
});
