import { NativeRenderer, type OHLCV } from '../src';
import { VelaWorkspace } from '../src/workspace';
import type { DataProvider } from '../src/plugin';
import { DemoEngine } from './demo-engine';
import { countColor } from '../test/browser/pixels';

const hour = 3_600_000;
const first = Date.UTC(2026, 0, 5);
const bars: OHLCV[] = Array.from({ length: 120 }, (_, index) => {
    const open = 100 + index * 0.08 + Math.sin(index / 5) * 3;
    const close = open + (index % 2 ? 1 : -1);
    return { time: first + index * hour, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, volume: 1000 + index };
});
const calls: { method: string; session?: string }[] = [];
let subscribers = 0;
const provider: DataProvider = {
    async getBars(_ticker, _timeframe, range) {
        calls.push({ method: 'history', session: range.session });
        const result = bars.filter(bar => (range.from === undefined || bar.time >= range.from) && (range.to === undefined || bar.time <= range.to));
        return (range.limit === undefined ? result : result.slice(-range.limit)).map(bar => ({ ...bar }));
    },
    async listSymbols() { return [{ ticker: 'TEST', description: 'Browser fixture' }]; },
    async getSymbolInfo(ticker) { return { ticker, timezone: 'Etc/UTC' }; },
    async getCalendar(_ticker, range) {
        calls.push({ method: 'calendar', session: range.session });
        return [[first, first + 365 * 24 * hour]];
    },
    subscribe(_ticker, _timeframe, _onBar, options) {
        calls.push({ method: 'subscribe', session: options?.session });
        subscribers++;
        return () => { subscribers--; };
    },
};

let renderer: NativeRenderer;
class FixtureRenderer extends NativeRenderer {
    constructor(...args: ConstructorParameters<typeof NativeRenderer>) {
        super(...args);
        renderer = this;
    }
}

const options = new URLSearchParams(location.search);
const ws = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'fixture:TEST',
    timeframe: '60',
    bars: bars.length,
    visibleRange: 'ALL',
    live: true,
    nativeBackend: 'canvas2d',
    renderer: FixtureRenderer,
    volume: false,
    watermark: false,
    drawingToolbar: false,
    drawings: { toolbar: false },
    persist: 'vela-browser-fixture',
    providers: { fixture: () => provider },
    engines: { demo: () => new DemoEngine() },
    indicators: [{ name: 'Golden average', enabled: true, language: 'demo', script: 'title Golden average\noverlay true\ninput length = 3\nplot sma(close, length) "Average" #f7c948 width=2' }],
    sessions: [
        { id: 'Morning-A', label: 'Morning', windows: ['0000-1200'], color: 'rgba(230,80,20,0.2)' },
        { id: 'Afternoon-B', label: 'Afternoon', windows: ['1200-2400'], color: 'rgba(20,180,90,0.2)' },
        { id: 'Night-X', label: 'Night', windows: ['2200-0200'], color: 'rgba(40,120,255,0.2)' },
    ],
    session: 'Morning-A',
    sessionTimezone: 'Etc/UTC',
    ...(options.get('animations') === 'true' ? { animations: true } : {}),
});

// Read-only probes of native surfaces complement public state assertions. No layout or
// input implementation is patched: Chromium exercises the renderer exactly as mounted.
function surface() {
    return renderer as unknown as {
        dataCanvas: HTMLCanvasElement;
        drawingsCanvas: HTMLCanvasElement;
        chromeCanvas: HTMLCanvasElement;
        backdropCanvas: HTMLCanvasElement;
        userDrawings: { selectedIds: Set<string>; interaction: { marqueeRect(): { x: number; y: number; w: number; h: number } | null } };
    };
}
function pixels(canvas: HTMLCanvasElement) {
    return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
}
function ink(canvas: HTMLCanvasElement) {
    return pixels(canvas).filter((value, index) => index % 4 === 3 && value > 0).length;
}
const fixture = {
    ws,
    calls,
    ready: false,
    get subscribers() { return subscribers; },
    get selected() { return [...surface().userDrawings.selectedIds]; },
    get marquee() { return surface().userDrawings.interaction.marqueeRect(); },
    viewport() { return renderer.getVisibleRange(); },
    marqueeInk() {
        const rect = surface().userDrawings.interaction.marqueeRect();
        if (!rect) return 0;
        const canvas = surface().drawingsCanvas;
        const dpr = canvas.width / canvas.getBoundingClientRect().width;
        const image = canvas.getContext('2d')!.getImageData((rect.x + 4) * dpr, (rect.y + 4) * dpr, Math.min(rect.w - 8, 120) * dpr, 4 * dpr).data;
        return image.filter((value, index) => index % 4 === 3 && value > 0).length;
    },
    plot() { return surface().dataCanvas.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number }; },
    paint() {
        const data = pixels(surface().dataCanvas);
        return {
            bullish: countColor(data, [8, 153, 129]),
            bearish: countColor(data, [242, 54, 69]),
            indicator: countColor(data, [247, 201, 72]),
            drawings: countColor(pixels(surface().drawingsCanvas), [255, 122, 0]),
            chrome: ink(surface().chromeCanvas),
            session: countColor(pixels(surface().backdropCanvas), [40, 120, 255]),
        };
    },
    addDrawing() {
        return ws.chart.drawings.add('box', {
            anchors: [{ time: bars[70]!.time, price: 108 }, { time: bars[90]!.time, price: 103 }],
            zIndex: 10,
            style: { lineColor: '#ff7a00', lineWidth: 4, fillColor: 'rgba(255,122,0,0.55)' },
        })!.id;
    },
    destroy() { ws.destroy(); },
};

declare global { interface Window { fixture: typeof fixture } }
window.fixture = fixture;
await ws.chart.ready();
fixture.ready = true;
