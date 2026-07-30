// Symbol picker — a search dialog over the providers' eager symbol indexes
// (`chart.data.symbols()`). Kit Dialog + a lightweight ranked filter; selection reports
// the ticker upward (the widget rebuilds the chart on it).
import type { SymbolDescriptor } from '../core/ports/DataProvider';
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';
import { tickerIconEl, baseOf } from './symbol-icon';

/** The pinned head of the empty-query list (majors first, like the reference picker). */
const TOP_TICKERS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'];

/** Deterministic avatar hue from a ticker (self-contained — no external icon service). */
export function avatarColor(ticker: string): string {
    let h = 0;
    for (let i = 0; i < ticker.length; i++) h = (h * 31 + ticker.charCodeAt(i)) % 360;
    return `hsl(${h}, 42%, 38%)`;
}

/** Rank: ticker prefix > ticker substring > description substring. Pure — unit-tested. */
export function filterSymbols(list: readonly SymbolDescriptor[], query: string, limit = 100): SymbolDescriptor[] {
    const q = query.trim().toUpperCase();
    if (!q) {
        // Empty query: pin the majors that exist in the index, then fill with the head.
        const byTicker = new Map(list.map((s) => [s.ticker.toUpperCase(), s]));
        const top = TOP_TICKERS.map((t) => byTicker.get(t)).filter((s): s is SymbolDescriptor => s !== undefined);
        const rest = list.filter((s) => !TOP_TICKERS.includes(s.ticker.toUpperCase()));
        return [...top, ...rest].slice(0, limit);
    }
    const prefix: SymbolDescriptor[] = [];
    const substr: SymbolDescriptor[] = [];
    const desc: SymbolDescriptor[] = [];
    for (const s of list) {
        const t = s.ticker.toUpperCase();
        if (t.startsWith(q)) prefix.push(s);
        else if (t.includes(q)) substr.push(s);
        else if ((s.description ?? '').toUpperCase().includes(q)) desc.push(s);
        if (prefix.length >= limit) break;
    }
    return [...prefix, ...substr, ...desc].slice(0, limit);
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
.vela-sp-row:hover, .vela-sp-row[data-highlighted] { background: var(--vela-surface-elev); }
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
    onSelect: (ticker: string) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
}

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

    constructor(opts: SymbolPickerOptions) {
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
                if (pick) this.select(pick.ticker, opts.onSelect);
                return;
            } else return;
            e.preventDefault();
        });
        this.list.addEventListener('click', (e) => {
            const row = (e.target as HTMLElement).closest<HTMLElement>('.vela-sp-row');
            if (row?.dataset.ticker) this.select(row.dataset.ticker, opts.onSelect);
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

    private select(ticker: string, onSelect: (t: string) => void): void {
        this.close();
        onSelect(ticker);
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

    private refresh(): void {
        const doc = this.list.ownerDocument;
        const TAB_TYPES: Record<string, string[]> = { Crypto: ['crypto'], Stocks: ['stock'], ETFs: ['etf'], Forex: ['forex'], Commodities: ['commodity'] };
        const pool =
            this.activeTab === 'All'
                ? this.source()
                : this.source().filter((s) => TAB_TYPES[this.activeTab]?.includes((s.type ?? '').toLowerCase()) || (this.activeTab === 'Crypto' && (s.type ?? '').toLowerCase() === 'futures'));
        this.rows = filterSymbols(pool, this.input.value);
        this.highlighted = 0;
        this.list.replaceChildren();
        if (!this.rows.length) {
            const empty = doc.createElement('div');
            empty.className = 'vela-sp-empty';
            empty.textContent = this.input.value ? 'No symbols match.' : 'No symbols indexed (provider still loading?).';
            this.list.appendChild(empty);
            return;
        }
        for (const s of this.rows) {
            const row = doc.createElement('div');
            row.className = 'vela-sp-row';
            row.dataset.ticker = s.ticker;
            const av = tickerIconEl(doc, baseOf(s), s.ticker, 'vela-sp-avatar');
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
            if (s.provider) {
                const badge = doc.createElement('span');
                badge.className = 'vela-sp-badge';
                badge.dataset.p = s.provider;
                badge.textContent = s.provider;
                row.appendChild(badge);
            }
            this.list.appendChild(row);
        }
        this.renderHighlight();
    }
}
