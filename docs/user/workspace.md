# The workspace (multi-chart)

`vela/workspace` is the multi-chart shell: a grid of full Vela charts behind **one
shared data feed**, wrapped in **one shared chrome** — topbar (symbol / timeframe /
style / **layout** dropdowns, indicator picker, alerts), one drawing toolbar, object
tree, data window, bottom bar, one keyboard map — that always **reflects and acts on the
ACTIVE cell**. Cells are switched in place (`setMarket` under the hood), so indicators,
drawings, and your subscriptions survive every symbol/timeframe change.

```ts
import { VelaWorkspace } from 'vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets'; // Vela ships no engine — see ./scripting-engines.md
import { BinanceProvider } from 'vela/providers/binance';

const ws = new VelaWorkspace('#app', {
    layout: '4', // '1' | '2h' | '2v' | '4' | '8' | a registerLayout() id
    // Chart options at the TOP LEVEL are every cell's DEFAULT — the same words the
    // widget (and the bare chart) use. `cells` overrides them per cell; a cell's NAME
    // is its durable identity, DECLARATION ORDER fills the layout's slots:
    symbol: 'BTCUSDT',
    timeframe: '60',
    cells: {
        btc: { symbol: 'BTCUSDT', timeframe: '60' }, // 1st declared → 1st slot
        eth: { symbol: 'ETHUSDT', timeframe: '15' }, // slots 3–4: no entry → pure defaults
    },
    providers: { binance: () => new BinanceProvider() }, // registered ONCE, shared by every cell
    engines: { pine: () => new PineWorkerEngine() }, // instantiated per cell (a worker each)
    live: true,
    theme: 'dark',
    sync: { viewport: true }, // optional links — see below
    persist: true, // state persistence (localStorage by default — see State & persistence)
});
```

**One options vocabulary.** `VelaWorkspaceOptions` = the widget's chart options (all of
`VelaOptions` except `height` — the grid sizes its cells) + the shared shell surface
(`providers`, `engines`, `indicators`, `timeframes`, `timezone`, chrome toggles,
`persist`/`storage`) + the grid's own options (`layout`, `cells`, `sync`,
`drawingToolbar`, `maxWebglCells`). A chart option means the same thing everywhere: on
the widget it configures *the* chart, here it is the *default* of each cell —
`upColor`, `glow`, `logScale`, `animations`, `defaultLanguage`, `drawings` (its toolbar
excepted: the shared bar replaces per-cell bars), even `renderer` all apply to every
cell. An explicit `nativeBackend` (other than `'auto'`) wins over the `maxWebglCells`
budget policy.

## Cells and the active cell

A cell's **identity** is its declared name (`btc`, `eth`, … — the keys of `cells`), or
`c<N>` for a slot no entry declared. It is durable and never content: the symbol,
timeframe, style, indicators and drawings are mutable state *of that identity*. The
layout's own `c1`…`cN` are slot POSITIONS, and declaration order is what maps an identity
onto one. Identity is also what survives a layout change, so `4 → 2h → 4` restores the
third and fourth cells exactly (market, renderer config, drawings, indicators) from the
workspace pool.

```ts
ws.active;               // the ChartCell the shared chrome reflects/acts on
ws.chart;                // shortcut ≡ ws.active.chart (the widget.chart habit)
ws.cell('eth');          // a specific cell BY IDENTITY — the durable handle to hold
ws.cells();              // every live cell, in slot order
ws.setActiveCell('sol');
ws.setLayout('8');       // cells diff BY IDENTITY; identities past the new size pool their state
ws.on('cell:active' | 'layout:changed' | 'cell:created' | 'cell:destroyed' | 'state:changed', cb);
```

**Rule of thumb:** hold the cell (or its identity), read `cell.chart` at the point of
use. The chart instance survives market changes and only dies when its cell leaves the
layout (`cell:destroyed`). Host code that tracks cells should **follow
`cell:created`/`cell:destroyed`** rather than snapshot `ws.cells()` once: a later
`setLayout` (or a restored document) mints cells that a one-time snapshot never sees.

Layouts live in a registry (`registerLayout` from `vela/workspace`) — a plugin-added
grid appears in the topbar's layout dropdown automatically. Splitters between cells
resize the grid tracks (double-click a divider for an even split).

## Sync links

Per kind — `viewport`, `symbol`, `timeframe`, `crosshair` — link every cell (`true`) or
named groups keyed by cell IDENTITY (`{ btc: 'a', eth: 'a', sol: 'b' }`: only same-group
cells follow each other). Cross-timeframe viewport groups align on the **right edge** (a
finer-timeframe cell clamps the window to its own minimum zoom).

`crosshair` mirrors the pointer's TIME onto same-group cells as a **ghost crosshair**
(a dimmed vertical line snapped to each follower's own bar, with its time chip);
leaving the origin clears every ghost. It is also a **toggle in the topbar's layout
dropdown** ("Sync crosshair"). The ghost needs the renderer's optional
`setExternalCrosshair` seam — the native renderer has it; a custom renderer without it
simply never shows one (enabling warns only when NO cell could).

```ts
ws.sync.set('viewport', true); // aligns followers to the active cell, then follows pans
ws.sync.set('symbol', { btc: 'watch', eth: 'watch' });
ws.sync.set('crosshair', true); // hover any cell → ghost time-line on all the others
ws.sync.get('viewport'); // true
ws.sync.state(); // { viewport: true, symbol: {...}, crosshair: true }
```

## Watching what the cells compute

Every cell runs its own engine session, so a script's runs are per-cell. The workspace
relays them as one event, tagged with the cell identity — **one subscription covers the
whole grid**, cells created by a later layout change included:

```ts
ws.on('script:run', (run) => {
    run.cell;              // 'btc' — which cell computed
    run.title;             // the script's declared title
    if (run.cause === 'bar') persist(run.cell, run.strategy);
});
```

The payload is the chart-level [`ScriptRun`](./api-reference.md#capturing-what-a-script-computes)
plus `cell`; everything there — `cause`, `forming`, `plots`, `vars`, `strategy`, `trades()` —
applies unchanged.

## State & persistence

The state SURFACE is the product; persistence is an adapter on top of it.

### Reading and restoring the whole workspace

```ts
const state = ws.getState();
// → { version: 1, layout, trackSizes?, activeCellId?, sync?, timezone?, favorites?, charts: […] }
// One ORDERED `charts` entry per cell, live AND dormant — array position i restores
// into slot i, `id` is the cell's durable name: { id: 'btc', symbol, provider?, timeframe,
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

**The default adapter is localStorage** — the same default as the widget, so
`persist: true` survives reloads out of the box. An in-memory, session-lived adapter
stays available for state that must NOT outlive the page
(`import { memoryStorageAdapter } from 'vela/workspace'`). Any backend fits through
this interface (one contract for both shells):

```ts
/** Both methods may be synchronous (localStorage-like) or return promises (REST/IndexedDB). */
interface VelaStorage {
    get(key: string): string | null | Promise<string | null>;
    set(key: string, value: string): void | Promise<void>;
    remove?(key: string): void | Promise<void>;
}
```

Example — a REST-backed store (per-user server-side workspaces):

```ts
import { VelaWorkspace, type VelaStorage } from 'vela/workspace';

const restStorage: VelaStorage = {
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

**Chart options** (every key of [the chart's options](./options.md) except `height`) sit
at the top level and are each cell's **default** — `symbol` (bare = first declared
provider; an `EXCHANGE:` prefix pins a venue), `timeframe`, `bars`, `priceStyle`,
`data`, `visibleRange`, `theme`, `live`, `volume`, `upColor`, `downColor`, `glow`,
`animations`, `logScale`, `currentPriceLine`, `drawings` (toolbar excepted),
`defaultLanguage`, `renderer`, `nativeBackend` (explicit value wins over the
`maxWebglCells` policy). `cells` overrides the market/view seeds per cell:
`{ symbol, timeframe, bars, priceStyle, data, visibleRange }`.

**Cell names are identities, not positions.** A `cells` key is free-form (`btc`, `main`,
…): it names the cell durably — persistence, `sync` groups and `ws.cell(name)` all speak
it — while DECLARATION ORDER decides which layout slot each one fills (first declared →
first slot). Any entry is optional (an undeclared slot boots on the defaults, with an
auto name); extra entries beyond the layout wait dormant and appear when a larger layout
reveals them. Purely-numeric names are rejected with a warning (JS object keys would
silently reorder them).

**Shell options** (shared with the widget, same semantics):

| Option | Default | What it does |
| --- | --- | --- |
| `providers` | — | Factories; the workspace instantiates ONCE onto the single shared feed. |
| `engines` | — | Factories; one instance per cell (merged over `registerDefaultEngine`). |
| `indicators` | — | Shared manifest; `enabled` entries auto-add to fresh cells. |
| `timeframes` | presets | Topbar timeframe presets. |
| `timezone` | `'Etc/UTC'` | Display timezone (every cell). |
| `statusline` / `watermark` / `bottombar` | `true` | Chrome toggles. |
| `autofocus` | `false` | Focus the active chart on mount (off: an embedded workspace should not steal the page's focus). |
| `persist` / `storage` | off / localStorage | State persistence (see above). |

**Workspace options** (the grid's own):

| Option | Default | What it does |
| --- | --- | --- |
| `layout` | `'4'` | Initial grid — preset id, `registerLayout()` id, or inline definition. |
| `cells` | — | Per-cell overrides, keyed by FREE-FORM name = the cell's durable identity; declaration order fills the layout's slots (see above). |
| `sync` | off | Initial sync links (see above). |
| `drawingToolbar` | `true` | The one shared drawing toolbar (acts on the active cell). |
| `maxWebglCells` | `8` | Above this many cells, every cell renders canvas2d (WebGL-context budget). |
| `maxWebglCells` | `8` | Above this many cells, every cell uses canvas2d (uniform look inside the browser's WebGL budget; `glow` unavailable there). |

Contributed actions/attachments (`vela/plugin`) work unchanged — `ctx.chart` resolves
to the ACTIVE cell's chart; grid-aware plugins additionally get `ctx.cells`,
`ctx.activeCellId`, and `ctx.setActiveCell(id)`.
