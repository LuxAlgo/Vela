// One workspace CELL — a stable SLOT identity (`c1`…`cN`) holding a full Vela chart
// plus its per-cell overlays (statusline, watermark). The id never derives from
// content: symbol/timeframe/style are mutable state, switched IN PLACE via
// `chart.setMarket` (the chart instance survives every market change and only dies
// with the cell itself, on a layout change — its state then round-trips through the
// workspace pool, so shrinking 4 → 2 → 4 restores `c3`/`c4` exactly).
import { Vela } from '../Vela';
import type { VelaTheme, NativeBackend } from '../core/options';
import type { MarketDataFeed } from '../core/ports/MarketDataFeed';
import type { ScriptingEngine } from '../core/ports/ScriptingEngine';
import { Statusline } from '../widget/statusline';
import { Watermark } from '../widget/watermark';

/** The seed/mutable market state of one cell (all optional — an empty cell parks). */
export interface CellSeed {
    symbol?: string;
    provider?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
}

/** A destroyed cell's state, kept by the workspace pool so its slot restores later. */
export interface PooledCellState extends CellSeed {
    /** The renderer's cosmetic config document (`renderer.getConfig()`). */
    rendererConfig?: unknown;
    /** The user-drawings document (`drawings.toJSON()`). */
    drawings?: unknown;
}

/** What every cell shares from the workspace. */
export interface CellDeps {
    /** THE shared market-data feed (one registry, one cache, for every cell). */
    feed: MarketDataFeed;
    /** Scripting-engine factories — instantiated PER CELL (a worker engine per cell). */
    engines: Record<string, () => ScriptingEngine>;
    theme: VelaTheme;
    live: boolean;
    volume: boolean;
    statusline: boolean;
    watermark: boolean;
    /** Geometry backend for cells under the current layout (the WebGL budget policy). */
    nativeBackend: NativeBackend;
    /** Report a pointer-down/focus in this cell (the workspace sets it active). */
    activate(id: string): void;
    /** The cell's market changed in place (chrome/retention refresh upstream). */
    onMarketChanged(id: string): void;
}

const CELL_CSS_POSITION = 'position:relative;overflow:hidden;';

export class ChartCell {
    /** The grid item this cell renders into (owned; removed on destroy). */
    readonly host: HTMLElement;
    private inner: Vela | null;
    private readonly statusline: Statusline | null;
    private readonly watermark: Watermark | null;
    private readonly offMarket: () => void;
    private state: CellSeed;

    constructor(
        readonly id: string,
        gridHost: HTMLElement,
        seed: PooledCellState,
        private readonly deps: CellDeps,
    ) {
        this.state = { ...seed };
        const doc = gridHost.ownerDocument;
        this.host = doc.createElement('div');
        this.host.className = 'vela-cell';
        this.host.dataset.cellId = id;
        this.host.style.cssText = CELL_CSS_POSITION;
        // Capture-phase: a press anywhere in the cell (canvas, legend, dialogs) activates it
        // before any inner handler consumes the event.
        this.host.addEventListener('pointerdown', () => this.deps.activate(id), true);
        this.host.addEventListener('focusin', () => this.deps.activate(id));
        gridHost.appendChild(this.host);

        this.inner = new Vela(
            this.host,
            {
                provider: seed.provider,
                symbol: seed.symbol,
                timeframe: seed.timeframe,
                bars: seed.bars,
                priceStyle: seed.priceStyle,
                theme: deps.theme,
                live: deps.live,
                volume: deps.volume,
                nativeBackend: deps.nativeBackend,
                // One SHARED toolbar serves the whole workspace (it lands with the shared
                // chrome); per-cell bars would cost a 44px gutter in every cell.
                drawings: { toolbar: false },
            },
            { dataFeed: deps.feed },
        );
        for (const [language, make] of Object.entries(deps.engines)) this.inner.registerEngine(language, make());
        // Pool restore: cosmetics + drawings round-trip (both validate untrusted input).
        if (seed.rendererConfig != null) this.inner.renderer.applyConfig(seed.rendererConfig);
        if (seed.drawings != null) this.inner.drawings.fromJSON(seed.drawings);

        this.watermark = deps.watermark ? new Watermark(this.host, seed.symbol ?? '', seed.timeframe ?? '60') : null;
        this.statusline = deps.statusline ? new Statusline(this.host, seed.symbol ?? '') : null;
        this.statusline?.setMeta(seed.timeframe ?? '60', seed.provider ?? '');
        this.statusline?.onChart(this.inner);

        // The ONE bookkeeping seam: every market change — cell setters, sync links, or
        // host code calling chart.setMarket directly — lands here and updates the cell
        // state + overlays, then notifies the workspace (chrome projection, retention).
        this.offMarket = this.inner.on('market:changed', ({ symbol, timeframe }) => {
            this.state.symbol = symbol;
            this.state.timeframe = timeframe;
            this.watermark?.update(symbol, timeframe);
            this.statusline?.setSymbol(symbol);
            this.statusline?.setMeta(timeframe, this.state.provider ?? '');
            if (this.inner) this.statusline?.onChart(this.inner); // drop the old market's resting OHLC
            this.deps.onMarketChanged(this.id);
        });
    }

    /** The LIVE chart of this cell — never cache it across a layout change (the cell's
     *  slot id is the durable identity; the chart dies with the cell). */
    get chart(): Vela {
        if (!this.inner) throw new Error(`[vela] cell "${this.id}" is destroyed`);
        return this.inner;
    }

    get symbol(): string {
        return this.state.symbol ?? '';
    }

    get timeframe(): string {
        return this.state.timeframe ?? '60';
    }

    get priceStyle(): string {
        const live = this.inner?.renderer.get('priceStyle');
        return typeof live === 'string' ? live : (this.state.priceStyle ?? 'candles');
    }

    /** Switch this cell's market in place (the chart instance survives). */
    setSymbol(symbol: string): void {
        if (!this.inner || symbol === this.symbol) return;
        void this.inner.setMarket({ symbol });
    }

    setTimeframe(timeframe: string): void {
        if (!this.inner || timeframe === this.timeframe) return;
        void this.inner.setMarket({ timeframe });
    }

    /** Applied live (renderer feature) — no reload. */
    setPriceStyle(style: string): void {
        this.state.priceStyle = style;
        this.inner?.renderer.set('priceStyle', style);
    }

    /** Make this cell the active one and put keyboard focus on its chart surface. */
    focus(): void {
        this.deps.activate(this.id);
        this.inner?.renderer.focus();
    }

    /** Snapshot everything the pool needs to restore this slot later. */
    dehydrate(): PooledCellState {
        return {
            ...this.state,
            priceStyle: this.priceStyle,
            rendererConfig: this.inner?.renderer.getConfig() ?? undefined,
            drawings: this.inner ? this.inner.drawings.toJSON() : undefined,
        };
    }

    destroy(): void {
        this.offMarket();
        this.statusline?.destroy();
        this.watermark?.destroy();
        this.inner?.destroy();
        this.inner = null;
        this.host.remove();
    }
}
