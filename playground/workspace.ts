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

// ── State surface demo (uncomment to try) ─────────────────────────────────────
// The workspace speaks the SAME state triplet and document format as the widget —
// multi-cell here. `persist` above writes exactly this document; the calls below
// are how a host composes custom flows (server snapshots, share links, templates).
//
// // READ — the WHOLE grid as one versioned document: layout, splitter tracks,
// // active cell, sync links, timezone, favorites, and per cell (live AND dormant)
// // the market, renderer config, user drawings, and indicator ledger.
// const snapshot = ws.getState();
// console.log('[state] workspace document:', snapshot);
//
// // EVENT — fires debounced (~500ms) after any persistable change in ANY cell
// // (pan-synced viewports excluded; drawings, markets, layout, prefs included).
// const offState = ws.on('state:changed', () => {
//     console.log('[state] changed → active cell:', ws.getState().activeCellId);
// });
//
// // WRITE — the whole grid rebuilds from the document (cells diff by slot id; a
// // layout id must be registered — registerLayout — before applying). Untrusted-
// // safe: malformed fields are dropped by the shared codec.
// setTimeout(() => {
//     const doc = ws.getState();
//     doc.layout = '2h'; // switch the grid…
//     doc.cells.c1!.symbol = 'DOGEUSDT'; // …retarget slot c1…
//     doc.sync = { viewport: true }; // …and link every cell's viewport
//     ws.applyState(doc);
//     offState();
// }, 5000);
//
// // CROSS-SHELL — one format: a WIDGET document (layout '1', one `c1` cell)
// // applies here verbatim, and a workspace cell's state restores into a widget.
// // ws.applyState(widget.getState());
