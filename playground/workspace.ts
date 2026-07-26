// The workspace playground page: a 4-cell VelaWorkspace on live Binance data with the
// worker Pine engine and the full shared chrome — topbar (symbol / timeframe / style /
// LAYOUT dropdowns, indicator picker, alerts, screenshot, object tree, settings),
// bottombar (range chips, clock, timezone), one keymap. Served straight from src/ (HMR).
import { VelaWorkspace } from '../src/workspace';
import { PineWorkerEngine } from '../src';
import { BinanceProvider } from '../src/data/providers/binance';
import { playgroundStorage } from './persistence';

const ws = new VelaWorkspace('#workspace', {
    layout: '4',
    cells: {
        c1: { symbol: 'BTCUSDT', timeframe: '60' },
        c2: { symbol: 'ETHUSDT', timeframe: '15' },
        c3: { symbol: 'SOLUSDT', timeframe: '240' },
        c4: { symbol: 'BNBUSDT', timeframe: 'D' },
    },
    defaults: { symbol: 'BTCUSDT', timeframe: '60' },
    providers: { binance: () => new BinanceProvider() },
    engines: { pine: () => new PineWorkerEngine() },
    indicators: [
        {
            name: 'EMA 20',
            script: `//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), color=color.orange, linewidth=2)`,
        },
    ],
    live: true,
    theme: 'dark',
    // The playground's CUSTOM persistence (shared with the widget page): the whole
    // workspace document — layout, sync, timezone, and per cell the market, renderer
    // config, DRAWINGS and indicators — survives a reload via localStorage.
    persist: true, // key 'vela-workspace' → 'vela-play:vela-workspace' in devtools
    storage: playgroundStorage(),
});

// Handy for poking around from the browser console (and for the automated probes).
(window as unknown as { __ws: VelaWorkspace }).__ws = ws;
