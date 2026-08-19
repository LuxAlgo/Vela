// The workspace playground page: a 4-cell VelaWorkspace on live Binance data with the
// page's demo scripting engine and the full shared chrome — topbar (symbol / timeframe /
// style / LAYOUT dropdowns, indicator picker, alerts, screenshot, object tree, settings),
// bottombar (range chips, clock, timezone), one keymap. Served straight from src/ (HMR).
//
// Vela ships no scripting engine — `demo-engine.ts` is the page's own, written against
// the public port (see widget.ts's header). For Pine Script:
// `npm i @luxalgo/vela-pinets pinets` and `engines: { pine: () => new PineWorkerEngine() }`.
import { VelaWorkspace } from "../src/workspace";
import { BinanceProvider } from "../src/data/providers/binance";
import { DemoEngine, DEMO_SCRIPTS } from "./demo-engine";
import { playgroundStorage } from "./persistence";

const ws = new VelaWorkspace("#workspace", {
  layout: "4",
  // The unified vocabulary: top-level chart options are every cell's DEFAULT,
  // `cells` overrides per cell. A cell's NAME is its durable identity (persistence,
  // sync groups, ws.cell(name)) — DECLARATION ORDER fills the layout's slots, and
  // any entry is optional (an undeclared slot boots on the defaults above).
  symbol: "BTCUSDT", // bare = first declared provider; 'coinbase:BTC-USD' pins a venue
  timeframe: "60",
  cells: {
    btc: { symbol: "BTCUSDT", timeframe: "60" },
    eth: { symbol: "ETHUSDT", timeframe: "15" },
    sol: { symbol: "SOLUSDT", timeframe: "240" },
    bnb: { symbol: "BNBUSDT", timeframe: "D" },
  },
  providers: { binance: () => new BinanceProvider() },
  engines: { demo: () => new DemoEngine() }, // ONE instance per cell (a worker engine would get a thread each)
  defaultLanguage: "demo", // scripts added without a `language` run on the engine above
  indicators: [
    {
      name: "EMA 20",
      enabled: false,
      script: DEMO_SCRIPTS.ema,
      language: "demo",
    }, // library-only:
    {
      name: "Bollinger Bands",
      enabled: false,
      script: DEMO_SCRIPTS.bands,
      language: "demo",
    }, //  pick them
    {
      name: "RSI 14",
      enabled: false,
      script: DEMO_SCRIPTS.rsi,
      language: "demo",
    }, //  from the dialog
  ],
  live: true,
  theme: "dark",
  autofocus: true, // the workspace IS the page — shortcuts work from the first keystroke
  // The playground's CUSTOM persistence (shared with the widget page): the whole
  // workspace document — layout, sync, timezone, and per cell the market, renderer
  // config, DRAWINGS and indicators — survives a reload via localStorage.
  persist: true, // key 'vela-workspace' → 'vela-play:vela-workspace' in devtools
  storage: playgroundStorage(),
  settings: { hidden: ["advanced"] },

  // ── The rest of the CHART options (every cell's DEFAULT), at their defaults ───────
  // bars: 500,                      // history depth per cell
  // data: myBars,                   // offline OHLCV[] for every cell — a `cells` entry can override
  // visibleRange: '3M',             // initial window per cell: '1D'…'5Y', 'YTD', 'ALL' or {from,to} ms
  // priceStyle: 'candles',          // default style of every cell — a `cells` entry can override
  // volume: true,                   // the built-in volume columns, per cell; false opts out
  // logScale: false,                // logarithmic price scale, per cell
  // currentPriceLine: true,         // dashed line + axis chip at the latest price, per cell
  // upColor: '#089981',             // bullish candles (default: the palette's bullish green)
  // downColor: '#f23645',           // bearish candles (default: the palette's bearish red)
  // glow: 0,                        // neon glow on line series, 0..~0.6 — WebGL2 cells only
  // animations: { zoom: true, pan: true }, // eased zoom + inertial pan; false disables both
  // nativeBackend: 'auto',          // explicit 'canvas2d'/'webgl2' wins over the maxWebglCells policy
  // renderer: NativeRenderer,       // a custom IChartRenderer class for every cell
  // drawings: true,                 // per-cell tools config — its `toolbar` key is ignored: the grid's
  //                                 //  ONE shared bar replaces per-cell bars (see drawingToolbar)
  // (no `height` here: the grid sizes its cells)

  // ── The rest of the SHELL options, at their defaults ──────────────────────────────
  // timeframes: ['1', '5', '15', '60', '240', 'D', 'W'], // topbar timeframe presets
  // timezone: 'Etc/UTC',            // display timezone (IANA), one zone for every cell
  // statusline: true,               // chrome: the per-cell status line
  // watermark: true,                // chrome: the per-cell symbol watermark
  // bottombar: true,                // chrome: the range-presets + timezone bar

  // ── The rest of the WORKSPACE options, at their defaults ──────────────────────────
  // sync: { viewport: true, crosshair: true }, // links between cells, per kind ('viewport' |
  //                                 //  'symbol' | 'timeframe' | 'crosshair'): true = all cells,
  //                                 //  or {cellId: group} so only same-group cells follow
  // drawingToolbar: true,           // the ONE shared drawing toolbar (acts on the active cell)
  // maxWebglCells: 8,               // above this many cells, every cell renders canvas2d
  //                                 //  (browser WebGL-context budget; glow unavailable there)
});

// The page shell follows the app theme — flip it from any cell's chart settings →
// Canvas → Theme (or `__ws.setTheme('light')` in the console); every LIVE cell relays
// the change, and cells minted by later layout switches are wired as they appear.
const syncShellTheme = (t: { background: string }): void => {
  document.body.style.background = t.background;
};
for (const cell of ws.cells()) cell.chart.on("theme:changed", syncShellTheme);
ws.on("cell:created", ({ id }) =>
  ws.cell(id)?.chart.on("theme:changed", syncShellTheme),
);

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
// // WRITE — the whole grid rebuilds from the document (cells diff by IDENTITY — the
// // names declared above; a layout id must be registered — registerLayout — before
// // applying). Untrusted-safe: malformed fields are dropped by the shared codec.
// setTimeout(() => {
//     const doc = ws.getState();
//     doc.layout = '2h'; // switch the grid…
//     const btc = doc.charts.find((c) => c.id === 'btc');
//     if (btc) btc.symbol = 'DOGEUSDT'; // …retarget the btc cell…
//     doc.sync = { viewport: true }; // …and link every cell's viewport
//     ws.applyState(doc);
//     offState();
// }, 5000);
//
// // CROSS-SHELL — one format: a WIDGET document (layout '1', one `c1` cell)
// // applies here verbatim, and a workspace cell's state restores into a widget.
// // ws.applyState(widget.getState());
