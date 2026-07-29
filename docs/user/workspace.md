# The workspace (multi-chart)

`vela/workspace` is the multi-chart shell: a grid of full Vela charts behind **one
shared data feed**, wrapped in **one shared chrome** — topbar (symbol / timeframe /
style / **layout** dropdowns, indicator picker, alerts), one drawing toolbar, object
tree, bottom bar, one keyboard map — that always **reflects and acts on the ACTIVE
cell**. Cells are switched in place (`setMarket` under the hood), so indicators,
drawings, and your subscriptions survive every symbol/timeframe change.

```ts
import { VelaWorkspace } from 'vela/workspace';
import { PineWorkerEngine } from 'vela';
import { BinanceProvider } from 'vela/providers/binance';

const ws = new VelaWorkspace('#app', {
    layout: '4', // '1' | '2h' | '2v' | '4' | '8' | a registerLayout() id
    cells: {
        c1: { symbol: 'BTCUSDT', timeframe: '60' },
        c2: { symbol: 'ETHUSDT', timeframe: '15' },
    },
    defaults: { symbol: 'BTCUSDT', timeframe: '60' },
    providers: { binance: () => new BinanceProvider() }, // registered ONCE, shared by every cell
    engines: { pine: () => new PineWorkerEngine() }, // instantiated per cell (a worker each)
    live: true,
    theme: 'dark',
    sync: { viewport: true }, // optional links — see below
    persist: true, // session persistence (see State & persistence)
});
```

## Cells and the active cell

A cell id (`c1`…`cN`) is a **slot identity**, never content: the symbol, timeframe,
style, indicators and drawings are mutable state of the slot. Slot ids are shared by
every layout, so switching `4 → 2h → 4` restores `c3`/`c4` exactly (market, renderer
config, drawings, indicators) from the workspace pool.

```ts
ws.active;               // the ChartCell the shared chrome reflects/acts on
ws.chart;                // shortcut ≡ ws.active.chart (the widget.chart habit)
ws.cell('c2');           // a specific cell — the DURABLE identity to hold
ws.cells();              // every live cell, in layout order
ws.setActiveCell('c3');
ws.setLayout('8');       // cells diff BY SLOT ID; removed slots pool their state
ws.on('cell:active' | 'layout:changed' | 'cell:created' | 'cell:destroyed' | 'state:changed', cb);
```

**Rule of thumb:** hold the cell (or its id), read `cell.chart` at the point of use.
The chart instance survives market changes and only dies when its slot leaves the
layout (`cell:destroyed`).

Layouts live in a registry (`registerLayout` from `vela/workspace`) — a plugin-added
grid appears in the topbar's layout dropdown automatically. Splitters between cells
resize the grid tracks (double-click a divider for an even split).

## Sync links

Per kind — `viewport`, `symbol`, `timeframe`, `crosshair` — link every cell (`true`)
or named groups (`{ c1: 'a', c2: 'a', c3: 'b' }`: only same-group cells follow each
other). Cross-timeframe viewport groups align on the **right edge** (a finer-timeframe
cell clamps the window to its own minimum zoom).

`crosshair` mirrors the pointer's TIME onto same-group cells as a **ghost crosshair**
(a dimmed vertical line snapped to each follower's own bar, with its time chip);
leaving the origin clears every ghost. It is also a **toggle in the topbar's layout
dropdown** ("Sync crosshair"). The ghost needs the renderer's optional
`setExternalCrosshair` seam — the native renderer has it; a custom renderer without it
simply never shows one (enabling warns only when NO cell could).

```ts
ws.sync.set('viewport', true); // aligns followers to the active cell, then follows pans
ws.sync.set('symbol', { c1: 'watch', c2: 'watch' });
ws.sync.set('crosshair', true); // hover c1 → ghost time-line on c2/c3/c4
ws.sync.get('viewport'); // true
ws.sync.state(); // { viewport: true, symbol: {...}, crosshair: true }
```

## State & persistence

The state SURFACE is the product; persistence is an adapter on top of it.

### Reading and restoring the whole workspace

```ts
const state = ws.getState();
// → { version: 1, layout, trackSizes?, activeCellId?, sync?, timezone?, favorites?, charts: […] }
// One `charts` entry per SLOT (live AND dormant): { id: 'c1', symbol, provider?, timeframe,
//   priceStyle, bars?, watermark?, rendererConfig (renderer.getConfig() document),
//   drawings (drawings.toJSON() document), indicators: { manifest: string[], natives: string[] } }

ws.applyState(state); // untrusted-safe: malformed fields dropped, whole grid rebuilt
ws.on('state:changed', () => {
    /* debounced (~500ms) — re-pull getState() */
});
```

`getState()` is the SDK's one call to read the **config and current content of every
chart**; `applyState()` is its inverse. Custom flows — server-side snapshots, share
links, layout templates — compose these two directly and need none of the plumbing
below. There is deliberately **no built-in URL persistence**: a host wanting shareable
links encodes `getState()` into its own URL scheme and calls `applyState()` at boot.

The document format is **shared with [the widget](./widget.md)** — same triplet
(`getState`/`applyState`/`state:changed`), same codec, the widget being the
single-chart case (`layout: '1'`, one `charts` entry). A saved widget chart drops into
a workspace slot as-is, and a cell's state restores into a widget.

### The `persist` option and the storage interface

```ts
new VelaWorkspace('#app', { persist: true }); // key 'vela-workspace'
new VelaWorkspace('#app', { persist: 'my-key', storage: myAdapter });
```

`persist` writes the state document through a **storage adapter** and restores it as
defaults at construction (synchronous adapters restore before the first paint; async
ones late-apply when they resolve). Writes are debounced ~500ms and flushed on
`beforeunload` and `destroy()`.

**The default adapter is in-memory and session-lived**: a destroyed and re-created
workspace (SPA navigation) restores, but a page reload starts fresh. Durable
persistence is your choice of backend, through this interface:

```ts
/** Both methods may be synchronous (localStorage-like) or return promises (REST/IndexedDB). */
interface WorkspaceStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}
```

Example — a REST-backed store (per-user server-side workspaces):

```ts
import { VelaWorkspace, type WorkspaceStorage } from 'vela/workspace';

const restStorage: WorkspaceStorage = {
    async get(key) {
        const res = await fetch(`/api/workspaces/${encodeURIComponent(key)}`);
        return res.ok ? res.text() : null;
    },
    async set(key, value) {
        await fetch(`/api/workspaces/${encodeURIComponent(key)}`, { method: 'PUT', body: value });
    },
};

new VelaWorkspace('#app', { persist: 'main', storage: restStorage /* … */ });
```

Notes: writes are fire-and-forget (the UI never blocks on storage); a remote adapter
that must survive tab-close should use `navigator.sendBeacon` in its `set`. A saved
state referencing a custom layout id restores only if that layout is registered
(`registerLayout`) before `applyState` runs.

## Options (summary)

| Option | Default | What it does |
| --- | --- | --- |
| `layout` | `'4'` | Initial grid — preset id, `registerLayout()` id, or inline definition. |
| `cells` / `defaults` | — | Per-slot market seeds / fallback seed. |
| `providers` | — | Factories, called ONCE onto the single shared feed. |
| `engines` | — | Factories, called once per cell. |
| `indicators` | — | Shared manifest; `enabled` entries auto-add to fresh cells. |
| `sync` | off | Initial sync links (see above). |
| `persist` / `storage` | off / memory | State persistence (see above). |
| `timezone` | `'Etc/UTC'` | Workspace-global display timezone (every cell). |
| `drawingToolbar` | `true` | The one shared drawing toolbar (acts on the active cell). |
| `statusline` / `watermark` / `bottombar` | `true` | Chrome toggles. |
| `autofocus` | `false` | Focus the active chart on mount so keyboard shortcuts work from the first keystroke. Off by default: an embedded workspace should not steal the page's focus. |
| `maxWebglCells` | `8` | Above this many cells, every cell uses canvas2d (uniform look inside the browser's WebGL budget; `glow` unavailable there). |

Contributed actions/attachments (`vela/plugin`) work unchanged — `ctx.chart` resolves
to the ACTIVE cell's chart; grid-aware plugins additionally get `ctx.cells`,
`ctx.activeCellId`, and `ctx.setActiveCell(id)`.
