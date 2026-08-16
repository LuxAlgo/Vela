// The ONE serializable shell-state document, shared by BOTH shells: `vela/workspace`
// persists a multi-cell document; `vela/widget` persists the SAME document with a
// single `c1` cell (`layout: '1'`). One format means one mental model, one codec, and
// state that moves freely between shells (a saved widget chart drops into a workspace
// slot as-is). This module is NEUTRAL — it imports from neither shell; both re-export
// it (`vela/widget` and `vela/workspace` expose the same names).
//
// Design intent: the state SURFACE is the product (`getState()` / `applyState()` /
// the `state:changed` notification); persistence is just an adapter driven through
// the storage seam. Nothing here touches the URL — hosts wanting shareable links
// compose them from `getState()` themselves.

/** The linkable dimensions. `crosshair` mirrors the pointer time onto same-group
 *  cells as GHOST crosshairs (renderers without the optional `setExternalCrosshair`
 *  seam simply never display one). `drawings` copies each NEWLY CREATED drawing onto
 *  same-group cells and keeps the set linked: edits and removals of any member
 *  follow. Link membership is session-scoped and survives a toggle-off (re-enabling
 *  resumes edit/delete for drawings paired earlier; drawings created while off stay
 *  independent). After a reload, every drawing is unpaired again. */
export type SyncKind = 'viewport' | 'symbol' | 'timeframe' | 'crosshair' | 'drawings';

/**
 * One link's configuration: `false`/absent = off; `true` = ALL cells linked (one
 * implicit group); a record maps cell id → group name, and only cells sharing a group
 * follow each other (a cell absent from the record is unlinked).
 */
export type SyncSetting = boolean | Readonly<Record<string, string>>;

export interface SyncOptions {
    viewport?: SyncSetting;
    symbol?: SyncSetting;
    timeframe?: SyncSetting;
    crosshair?: SyncSetting;
    drawings?: SyncSetting;
}

/** Splitter track weights along each grid axis. */
export interface TrackSizes {
    cols?: number[];
    rows?: number[];
}

/**
 * The docked side panels — a SHELL-level pref (one dock serves every cell of a workspace).
 * `open` is the single panel showing (the dock is exclusive); `widths` holds only the columns
 * the user actually resized, by panel id, so a panel's declared width stays in charge until
 * then. Absent altogether in documents written before the dock existed.
 */
export interface PanelsState {
    open?: string;
    widths?: Record<string, number>;
}

/** Per-chart (per-cell) state: the market, the display prefs, the content documents,
 *  and the indicator ledger. The widget's whole chart state is ONE of these. */
export interface CellState {
    symbol?: string;
    /** The symbol's venue. Mirrors the symbol's own `EXCHANGE:` prefix on new saves;
     *  pre-prefix documents stored it beside a BARE symbol — {@link prefixedSymbol}
     *  welds the two back into the one canonical form at restore time. */
    provider?: string;
    timeframe?: string;
    priceStyle?: string;
    bars?: number;
    /** Trading session shown (`'extended'` persisted; absent = regular, the default). */
    session?: string;
    /** Symbol watermark visibility — a per-chart display pref. */
    watermark?: boolean;
    /** Indicator titles (the in-chart legend rows) visibility — a per-chart display pref. */
    indicatorTitles?: boolean;
    /** Plot values beside the legend titles visibility — a per-chart display pref. */
    indicatorValues?: boolean;
    /** The renderer's cosmetic config document (`renderer.getConfig()`). */
    rendererConfig?: unknown;
    /** The user-drawings document (`drawings.toJSON()`). */
    drawings?: unknown;
    /** The indicator ledger: manifest entries by name + present native types. */
    indicators?: { manifest: string[]; natives: string[] };
}

/** One entry of the document's `charts` array: a chart's state plus its cell IDENTITY. */
export interface ChartState extends CellState {
    /** The cell's durable identity — its declared name (`btc`), or `c<N>` for a slot no
     *  entry declared. Unique within the document; array position restores slot order. */
    id: string;
}

/** The versioned shell-state document — everything `applyState` restores. */
export interface WorkspaceState {
    version: 1;
    /** The layout id — always `'1'` for a widget. Restoring an id that is not
     *  registered keeps the current layout — register custom layouts
     *  (`registerLayout`) before applying a saved state. */
    layout: string;
    /** Splitter track weights, per layout id (workspace only). */
    trackSizes?: Record<string, TrackSizes>;
    activeCellId?: string;
    /** Sync links (workspace only). */
    sync?: SyncOptions;
    /** Shared display timezone. */
    timezone?: string;
    /** Favorite drawing-tool types — a SHARED preference (one star set per shell). */
    favorites?: string[];
    /** Favorite timeframes (the topbar's quick-switch chips) — a SHARED preference. */
    timeframeFavorites?: string[];
    /** The docked side panels: which one is open, and the widths the user dragged. */
    panels?: PanelsState;
    /** Per-chart state, one entry per SLOT (a single `c1` entry for the widget).
     *  Ids are unique — the codec drops id-less entries and keeps the LAST duplicate. */
    charts: ChartState[];
}

/** Serialize a state document (the inverse of {@link decodeState}). */
/** A cell's symbol in the canonical PREFIXED form: pre-prefix documents stored the
 *  venue in `provider` beside a BARE symbol — weld the two back together on restore.
 *  A symbol that already carries a prefix wins (new saves mirror it into `provider`). */
export function prefixedSymbol(cell: Pick<CellState, 'symbol' | 'provider'> | null | undefined): string | undefined {
    if (!cell?.symbol) return undefined;
    if (cell.symbol.includes(':') || !cell.provider) return cell.symbol;
    return `${cell.provider}:${cell.symbol}`;
}

export function encodeState(state: WorkspaceState): string {
    return JSON.stringify(state);
}

/** Parse + sanitize a persisted payload. Null on anything unusable (wrong version,
 *  not JSON, not an object) — malformed FIELDS are dropped, never thrown on. */
export function decodeState(raw: string): WorkspaceState | null {
    try {
        return sanitizeState(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Validate an untrusted state document field by field (the `applyState` gate). Unknown
 * or malformed fields are dropped; nested renderer-config / drawings documents pass
 * through OPAQUELY — their own consumers (`applyConfig`, `fromJSON`) validate them.
 */
export function sanitizeState(doc: unknown): WorkspaceState | null {
    if (doc == null || typeof doc !== 'object') return null;
    const d = doc as Record<string, unknown>;
    if (d.version !== 1 || typeof d.layout !== 'string') return null;
    const out: WorkspaceState = { version: 1, layout: d.layout, charts: [] };

    if (Array.isArray(d.charts)) {
        // Unique by id, LAST duplicate wins (a Map keeps the first-seen position).
        const byId = new Map<string, ChartState>();
        for (const raw of d.charts as unknown[]) {
            const id = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined;
            if (typeof id !== 'string' || id.length === 0) continue;
            const cell = sanitizeCell(raw);
            if (cell) byId.set(id, { id, ...cell });
        }
        out.charts = [...byId.values()];
    }
    if (typeof d.activeCellId === 'string') out.activeCellId = d.activeCellId;
    if (typeof d.timezone === 'string' && d.timezone) out.timezone = d.timezone;
    if (Array.isArray(d.favorites)) {
        const favs = d.favorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.favorites = favs;
    }
    if (Array.isArray(d.timeframeFavorites)) {
        const favs = d.timeframeFavorites.filter((f): f is string => typeof f === 'string');
        if (favs.length > 0) out.timeframeFavorites = favs;
    }
    const sync = sanitizeSync(d.sync);
    if (sync) out.sync = sync;
    const tracks = sanitizeTrackSizes(d.trackSizes);
    if (tracks) out.trackSizes = tracks;
    const panels = sanitizePanels(d.panels);
    if (panels) out.panels = panels;
    return out;
}

function sanitizeCell(raw: unknown): CellState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const c = raw as Record<string, unknown>;
    const out: CellState = {};
    if (typeof c.symbol === 'string') out.symbol = c.symbol;
    if (typeof c.provider === 'string') out.provider = c.provider;
    if (typeof c.timeframe === 'string') out.timeframe = c.timeframe;
    if (typeof c.priceStyle === 'string') out.priceStyle = c.priceStyle;
    if (typeof c.bars === 'number' && Number.isFinite(c.bars) && c.bars > 0) out.bars = c.bars;
    if (c.session === 'regular' || c.session === 'extended') out.session = c.session;
    if (typeof c.watermark === 'boolean') out.watermark = c.watermark;
    if (typeof c.indicatorTitles === 'boolean') out.indicatorTitles = c.indicatorTitles;
    if (typeof c.indicatorValues === 'boolean') out.indicatorValues = c.indicatorValues;
    if (c.rendererConfig != null && typeof c.rendererConfig === 'object') out.rendererConfig = c.rendererConfig;
    if (c.drawings != null && typeof c.drawings === 'object') out.drawings = c.drawings;
    const ind = c.indicators as Record<string, unknown> | undefined;
    if (ind != null && typeof ind === 'object') {
        const manifest = Array.isArray(ind.manifest) ? ind.manifest.filter((n): n is string => typeof n === 'string') : [];
        const natives = Array.isArray(ind.natives) ? ind.natives.filter((n): n is string => typeof n === 'string') : [];
        out.indicators = { manifest, natives };
    }
    return out;
}

function sanitizeSync(raw: unknown): SyncOptions | null {
    if (raw == null || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    const out: SyncOptions = {};
    for (const kind of ['viewport', 'symbol', 'timeframe', 'crosshair', 'drawings'] as const) {
        const v = s[kind];
        if (v === true) out[kind] = true;
        else if (v != null && typeof v === 'object') {
            const groups: Record<string, string> = {};
            for (const [id, g] of Object.entries(v as Record<string, unknown>)) if (typeof g === 'string') groups[id] = g;
            if (Object.keys(groups).length > 0) out[kind] = groups as SyncSetting;
        }
    }
    return Object.keys(out).length > 0 ? out : null;
}

function sanitizePanels(raw: unknown): PanelsState | null {
    if (raw == null || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;
    const out: PanelsState = {};
    if (typeof p.open === 'string' && p.open) out.open = p.open;
    if (p.widths != null && typeof p.widths === 'object') {
        const widths: Record<string, number> = {};
        // Widths are clamped again by the panel that receives them; here we only reject values
        // that are not a usable number at all.
        for (const [id, px] of Object.entries(p.widths as Record<string, unknown>)) {
            if (typeof px === 'number' && Number.isFinite(px) && px > 0) widths[id] = px;
        }
        if (Object.keys(widths).length > 0) out.widths = widths;
    }
    return out.open || out.widths ? out : null;
}

function sanitizeTrackSizes(raw: unknown): Record<string, TrackSizes> | null {
    if (raw == null || typeof raw !== 'object') return null;
    const out: Record<string, TrackSizes> = {};
    for (const [layoutId, ts] of Object.entries(raw as Record<string, unknown>)) {
        if (ts == null || typeof ts !== 'object') continue;
        const t = ts as Record<string, unknown>;
        const entry: TrackSizes = {};
        for (const axis of ['cols', 'rows'] as const) {
            const arr = t[axis];
            if (Array.isArray(arr) && arr.length > 0 && arr.every((w) => typeof w === 'number' && Number.isFinite(w) && w > 0)) {
                entry[axis] = arr as number[];
            }
        }
        if (entry.cols || entry.rows) out[layoutId] = entry;
    }
    return Object.keys(out).length > 0 ? out : null;
}
