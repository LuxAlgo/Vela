// Symbol picker — a search dialog over the providers' eager symbol indexes
// (`chart.data.symbols()`). Kit Dialog + a lightweight ranked filter; selection reports
// the ticker upward (the widget rebuilds the chart on it).
import type { SymbolDescriptor } from '../core/ports/DataProvider';
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { tickerIconEl, baseOf } from './symbol-icon';
import { symbolRanking } from './contributions';

/** First occurrence wins, keyed by venue+ticker — a ranking hook may inject an entry
 *  that also exists later in the pool; the injected one keeps position AND data. */
function dedupeSymbols(list: readonly SymbolDescriptor[]): SymbolDescriptor[] {
    const seen = new Set<string>();
    const out: SymbolDescriptor[] = [];
    for (const s of list) {
        const key = `${(s.prefix ?? s.provider ?? '').toLowerCase()}:${s.ticker.toUpperCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
    }
    return out;
}

/** The pinned head of the empty-query list (majors first, like the reference picker). */
const TOP_TICKERS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'];

/** Deterministic avatar hue from a ticker (self-contained — no external icon service). */
export function avatarColor(ticker: string): string {
    let h = 0;
    for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) % 360;
    return `hsl(${h}, 42%, 38%)`;
}

/**
 * Split a query into an optional venue SCOPE and a search TERM. A leading token — before a `:`
 * or a space — naming a venue present in the list (exactly, or as a unique prefix) scopes the
 * search to it: `binance:BTC`, `binance BTC` and `bina BTC` all read as Binance's BTC…; a token
 * that is no venue (`BTC USD`) leaves the whole query as the term.
 */
function parseQuery(raw: string, venues: readonly string[]): { scope: string | null; term: string } {
    const m = raw.match(/^\s*([^\s:]+)\s*[:\s]\s*(.*)$/);
    if (m) {
        const t = m[1]!.toLowerCase();
        const scope = venues.includes(t) ? t : onlyOne(venues.filter((v) => v.startsWith(t)));
        if (scope) return { scope, term: m[2]!.trim() };
    }
    return { scope: null, term: raw.trim() };
}

function onlyOne<T>(matches: readonly T[]): T | null {
    return matches.length === 1 ? matches[0]! : null;
}

/**
 * Rank: ticker prefix > ticker substring > description substring > venue-name substring (typing
 * `binance` surfaces that venue's symbols after any literal matches). An optional venue prefix
 * (see {@link parseQuery}) scopes the pool first — venue alone browses it whole, alphabetically.
 * Pure — unit-tested.
 */
/** The row's venue label — the LISTING prefix the data declares, else the provider name. */
const venueOf = (s: SymbolDescriptor): string | undefined => s.prefix ?? s.provider;

export function filterSymbols(list: readonly SymbolDescriptor[], query: string, limit = 100, top: readonly string[] | false = TOP_TICKERS): SymbolDescriptor[] {
    // The venues are the list's own — the picker's pool is already tab-filtered, and a scope
    // token must never resolve to a venue that has nothing to show. Both spellings scope:
    // the displayed listing venue (`nasdaq AAP`) and the provider id (`edgx AAP`).
    const venues = [...new Set(list.flatMap((s) => [venueOf(s)?.toLowerCase(), s.provider?.toLowerCase()]).filter((p): p is string => !!p))];
    const { scope, term } = parseQuery(query, venues);
    const pool = scope ? list.filter((s) => venueOf(s)?.toLowerCase() === scope || s.provider?.toLowerCase() === scope) : list;
    const q = term.toUpperCase();
    if (!q) {
        // Venue alone: browse the whole venue, alphabetically. Empty query: pin the `top`
        // tickers that exist in the index, then fill with the head — `top: false` trusts
        // the pool's own order instead (a registered symbol ranking already shaped it).
        if (scope) return [...pool].sort((a, b) => a.ticker.localeCompare(b.ticker)).slice(0, limit);
        if (top === false) return pool.slice(0, limit);
        const byTicker = new Map(pool.map((s) => [s.ticker.toUpperCase(), s]));
        const pinned = top.map((t) => byTicker.get(t)).filter((s): s is SymbolDescriptor => s !== undefined);
        const rest = pool.filter((s) => !top.includes(s.ticker.toUpperCase()));
        return [...pinned, ...rest].slice(0, limit);
    }
    const qLower = term.toLowerCase();
    const prefix: SymbolDescriptor[] = [];
    const substr: SymbolDescriptor[] = [];
    const desc: SymbolDescriptor[] = [];
    const venue: SymbolDescriptor[] = [];
    for (const s of pool) {
        const t = s.ticker.toUpperCase();
        if (t.startsWith(q)) prefix.push(s);
        else if (t.includes(q)) substr.push(s);
        else if ((s.description ?? '').toUpperCase().includes(q)) desc.push(s);
        // Inside a scope the venue is fixed — the tier would swallow the whole pool.
        else if (!scope && (venueOf(s)?.toLowerCase().includes(qLower) || s.provider?.toLowerCase().includes(qLower))) venue.push(s);
        if (prefix.length >= limit) break;
    }
    return [...prefix, ...substr, ...desc, ...venue].slice(0, limit);
}

const STYLE_ID = 'vela-widget-symbolpicker';
const CSS = `
.vela-sp-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
}
.vela-sp-searchrow:focus-within { border-color: var(--vela-border-strong); }
.vela-sp-searchrow .vela-icon { color: var(--vela-fg-muted); }
.vela-sp-input {
    flex: 1;
    background: transparent;
    color: var(--vela-fg);
    border: none;
    font-size: 14px;
    outline: none;
}
.vela-sp-tabs { display: flex; gap: 14px; margin: 12px 2px 6px; border-bottom: 1px solid var(--vela-border); padding-bottom: 8px; }
/* Mobile (fullscreen dialog): the asset-class strip scrolls sideways instead of
   overflowing the body, and the result list stops capping itself — the body owns
   the scrolling in the fullscreen presentation. */
[data-layout='mobile'] .vela-sp-tabs { overflow-x: auto; scrollbar-width: none; gap: 6px; }
[data-layout='mobile'] .vela-sp-tabs::-webkit-scrollbar { display: none; }
[data-layout='mobile'] .vela-sp-tab { flex: none; padding: 7px 10px; }
[data-layout='mobile'] .vela-sp-list { max-height: none; }
.vela-sp-tab {
    all: unset;
    padding: 3px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 13px;
    font-weight: 600;
}
.vela-sp-tab:hover { color: var(--vela-fg); }
.vela-sp-tab[data-active] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-sp-list { margin-top: var(--vela-space-2); max-height: 46vh; overflow: auto; }
.vela-sp-list::-webkit-scrollbar { width: 8px; }
.vela-sp-list::-webkit-scrollbar-thumb {
    background: var(--vela-scroll);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
.vela-sp-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    border-radius: 8px;
    cursor: pointer;
}
.vela-sp-row:hover, .vela-sp-row[data-highlighted] { background: var(--vela-hover); }
.vela-sp-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vela-fg-on-fill);
    font-size: var(--vela-font-size-md);
    font-weight: 700;
}
.vela-sp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-sp-ticker { font-weight: 700; color: var(--vela-fg-bright); font-size: 14px; }
.vela-sp-desc { color: var(--vela-fg-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-sp-badge {
    flex: none;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
/* Provider brand marks — fixed by the venue, deliberately outside the theme palette. */
.vela-sp-badge[data-p='binance'] { color: #f0b90b; } /* palette-exempt: venue brand mark */
.vela-sp-badge[data-p='hyperliquid'] { color: #50d2c1; } /* palette-exempt: venue brand mark */
.vela-sp-empty { padding: var(--vela-space-3); color: var(--vela-fg-muted); text-align: center; }
`;

export interface SymbolPickerOptions {
    /** `provider` is the venue of the chosen row — absent only for a source that has none. */
    /** Called with the CHOSEN symbol — `EXCHANGE:`-prefixed when the row named a venue,
     *  so the selection pins the venue the user actually pointed at. */
    onSelect: (symbol: string) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
    /** The row's icon URL — routed to the descriptor's OWNING provider
     *  (`resolveSymbolIcon`). Absent or `undefined` per row ⇒ the initials badge. */
    iconFor?: (d: SymbolDescriptor) => string | undefined;
}

/** Rows rendered per page — the list GROWS by this much every time the scroll nears the
 *  bottom, so a 13k-symbol venue browses whole without ever rendering 13k rows up front. */
const PAGE = 100;

export class SymbolPicker {
    private readonly dialog: Dialog;
    private readonly input: HTMLInputElement;
    private readonly list: HTMLElement;
    private source: () => readonly SymbolDescriptor[] = () => [];
    private rows: SymbolDescriptor[] = [];
    private highlighted = 0;
    private seed = '';
    private activeTab = 'All';
    private tabs!: HTMLElement;
    private visible = PAGE;
    /** The ranked pool cache — `key` fingerprints the raw pool the ranking ran on. */
    private ranked: { key: string; result: SymbolDescriptor[] } | null = null;
    private ranking = false;

    constructor(private readonly opts: SymbolPickerOptions) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        this.input = doc.createElement('input');
        this.input.className = 'vela-sp-input';
        this.input.placeholder = 'Search symbol…';
        this.input.setAttribute('spellcheck', 'false');
        const searchRow = doc.createElement('div');
        searchRow.className = 'vela-sp-searchrow';
        searchRow.append(iconEl('search', doc), this.input);
        this.tabs = doc.createElement('div');
        this.tabs.className = 'vela-sp-tabs';
        for (const t of ['All', 'Stocks', 'ETFs', 'Crypto', 'Forex', 'Commodities']) {
            const b = doc.createElement('button');
            b.className = 'vela-sp-tab';
            b.textContent = t;
            if (t === this.activeTab) b.dataset.active = '1';
            b.addEventListener('click', () => {
                this.activeTab = t;
                for (const c of this.tabs.children) delete (c as HTMLElement).dataset.active;
                b.dataset.active = '1';
                this.refresh();
            });
            this.tabs.appendChild(b);
        }
        this.list = doc.createElement('div');
        this.list.className = 'vela-sp-list';
        // Infinite scroll: nearing the bottom grows the page and APPENDS the new rows —
        // `filterSymbols` is a pure re-run with a larger limit whose result is a stable
        // superset (same ranking, same order), so appended rows never reshuffle the ones
        // already on screen. A short page (rows < visible) means the pool is exhausted.
        this.list.addEventListener('scroll', () => {
            if (this.rows.length < this.visible) return;
            if (this.list.scrollTop + this.list.clientHeight < this.list.scrollHeight - 200) return;
            this.visible += PAGE;
            this.grow();
        });

        this.dialog = new Dialog({
            title: 'Symbol Search',
            host: opts.host,
            closeOnInteractOutside: true,
            content: (body) => body.append(searchRow, this.tabs, this.list),
            onOpenChange: (open) => {
                if (open) {
                    this.input.value = this.seed;
                    this.seed = '';
                    this.refresh();
                    // Focus after the machine settles its own focus management.
                    setTimeout(() => {
                        this.input.focus();
                        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
                    }, 0);
                }
                opts.onOpenChange?.(open);
            },
        });

        this.input.addEventListener('input', () => this.refresh());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') this.moveHighlight(1);
            else if (e.key === 'ArrowUp') this.moveHighlight(-1);
            else if (e.key === 'Enter') {
                const pick = this.rows[this.highlighted];
                if (pick) this.select(pick.ticker, pick.prefix ?? pick.provider, opts.onSelect);
                return;
            } else return;
            e.preventDefault();
        });
        this.list.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.vela-sp-row');
            if (row?.dataset.ticker) this.select(row.dataset.ticker, row.dataset.venue, opts.onSelect);
        });
    }

    /** Wire where symbols come from (re-called on every widget rebuild). */
    setSource(source: () => readonly SymbolDescriptor[]): void {
        this.source = source;
    }

    open(initialQuery = ''): void {
        this.seed = initialQuery;
        this.dialog.show();
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private select(ticker: string, venue: string | undefined, onSelect: (symbol: string) => void): void {
        this.close();
        // The prefix IS the disambiguation: several venues may list this ticker, and the
        // user picked a specific row — a bare ticker would re-resolve by declaration order.
        // The committed form is the CANONICAL one: the listing prefix when the data
        // declares it (`NASDAQ:AAPL`), the provider name otherwise (`binance:BTCUSDT`).
        onSelect(venue ? `${venue}:${ticker}` : ticker);
    }

    private moveHighlight(delta: number): void {
        if (!this.rows.length) return;
        this.highlighted = Math.min(this.rows.length - 1, Math.max(0, this.highlighted + delta));
        this.renderHighlight();
    }

    private renderHighlight(): void {
        [...this.list.children].forEach((el, i) => {
            if (i === this.highlighted) {
                (el as HTMLElement).dataset.highlighted = '1';
                (el as HTMLElement).scrollIntoView({ block: 'nearest' });
            } else delete (el as HTMLElement).dataset.highlighted;
        });
    }

    /** The picker's pool: the source, shaped by the registered symbol ranking. Cached —
     *  the hook runs when the pool CHANGES (an index lands or refreshes), never per
     *  keystroke; an async hook resolves onto the next repaint (stale-while-revalidate
     *  in between, the raw pool before the first resolve). */
    private pool(): readonly SymbolDescriptor[] {
        const raw = this.source();
        const hook = symbolRanking();
        if (!hook) return raw;
        const key = `${raw.length}:${raw[0]?.ticker ?? ''}:${raw[raw.length - 1]?.ticker ?? ''}`;
        if (this.ranked?.key !== key && !this.ranking) {
            this.ranking = true;
            Promise.resolve([...raw])
                .then((copy) => hook(copy))
                .then((out) => {
                    this.ranked = { key, result: dedupeSymbols(out) };
                })
                .catch((err) => {
                    console.warn('[vela] symbol ranking failed — pool order kept:', err);
                    this.ranked = { key, result: [...raw] };
                })
                .finally(() => {
                    this.ranking = false;
                    this.refresh(); // repaint the (possibly open) list with the ranked pool
                });
        }
        return this.ranked?.result ?? raw;
    }

    private computeRows(): SymbolDescriptor[] {
        const TAB_TYPES: Record<string, string[]> = { Crypto: ['crypto'], Stocks: ['stock'], ETFs: ['etf'], Forex: ['forex'], Commodities: ['commodity'] };
        const all = this.pool();
        const pool =
            this.activeTab === 'All'
                ? all
                : all.filter((s) => TAB_TYPES[this.activeTab]?.includes((s.type ?? '').toLowerCase()) || (this.activeTab === 'Crypto' && (s.type ?? '').toLowerCase() === 'futures'));
        // A registered ranking OWNS the empty-query head — the built-in majors pin
        // stands down and the pool's own order shows.
        return filterSymbols(pool, this.input.value, this.visible, symbolRanking() ? false : TOP_TICKERS);
    }

    private refresh(): void {
        const doc = this.list.ownerDocument;
        this.visible = PAGE; // a new query/tab starts back at one page
        this.rows = this.computeRows();
        this.highlighted = 0;
        this.list.replaceChildren();
        if (!this.rows.length) {
            const empty = doc.createElement('div');
            empty.className = 'vela-sp-empty';
            empty.textContent = this.input.value ? 'No symbols match.' : 'No symbols indexed (provider still loading?).';
            this.list.appendChild(empty);
            return;
        }
        for (const s of this.rows) this.list.appendChild(this.rowEl(s));
        this.renderHighlight();
    }

    /** Append the page the grown `visible` just uncovered — rows already on screen stay put. */
    private grow(): void {
        const already = this.rows.length;
        this.rows = this.computeRows();
        for (const s of this.rows.slice(already)) this.list.appendChild(this.rowEl(s));
    }

    private rowEl(s: SymbolDescriptor): HTMLElement {
        const doc = this.list.ownerDocument;
        const row = doc.createElement('div');
        row.className = 'vela-sp-row';
        row.dataset.ticker = s.ticker;
        // The venue the user is pointing at travels with the pick — the same ticker can be
        // listed by several providers, and dropping it would silently route to another one.
        // The LISTING prefix wins over the provider id: it is the canonical spelling.
        const venue = s.prefix ?? s.provider;
        if (venue) row.dataset.venue = venue;
        const av = tickerIconEl(doc, baseOf(s), s.ticker, 'vela-sp-avatar', this.opts.iconFor?.(s));
        const main = doc.createElement('span');
        main.className = 'vela-sp-main';
        const t = doc.createElement('span');
        t.className = 'vela-sp-ticker';
        t.textContent = s.ticker;
        const d = doc.createElement('span');
        d.className = 'vela-sp-desc';
        d.textContent = s.description ?? (s.type ?? '');
        main.append(t, d);
        row.append(av, main);
        if (venue) {
            const badge = doc.createElement('span');
            badge.className = 'vela-sp-badge';
            // Brand colors key on the PROVIDER id; the visible text is the venue label.
            badge.dataset.p = s.provider ?? venue;
            badge.textContent = venue;
            row.appendChild(badge);
        }
        return row;
    }
}
