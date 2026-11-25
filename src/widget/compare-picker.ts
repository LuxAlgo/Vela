// Compare symbol picker — search dialog to overlay one or more secondary symbols on the
// active chart, with per-row hover placement actions (Same % scale / New price scale /
// New pane) and removable chips for already-added comparisons.
import type { SymbolDescriptor } from '../core/ports/DataProvider';
import type { ComparePlacement } from '../core/native-indicators/compare';
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageDescriptor, Translator } from '../core/i18n/types';
import { Dialog } from '@luxalgo/vela-ui/dialog';
import { createTabs, type TabsHandle } from '@luxalgo/vela-ui/tabs';
import { iconEl } from '@luxalgo/vela-ui/icons';
import { injectChromeStyles } from '../ui/chromeStyles';
import { tickerIconEl, baseOf } from './symbol-icon';
import { filterSymbols, foldGroups } from './symbol-picker';
import { symbolRanking } from './contributions';
import { isGroupRow, groupKeyOf, groupMembers, defaultMemberOf } from '../data/symbol-groups';
import { css } from '@luxalgo/vela-ui/css';
import { t } from '@luxalgo/vela-ui/t';

export interface ActiveCompareItem {
    id: string;
    symbol: string;
    title: string;
    color: string;
}

export interface ComparePickerOptions {
    onAdd: (symbol: string, placement: ComparePlacement) => void;
    onRemove?: (id: string) => void;
    activeItems?: () => readonly ActiveCompareItem[];
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
    iconFor?: (d: SymbolDescriptor) => string | undefined;
    i18n?: Translator;
}

type SymbolTab = 'all' | 'stocks' | 'etfs' | 'crypto' | 'futures' | 'forex' | 'commodities';

const TABS: ReadonlyArray<{ id: SymbolTab; label: MessageDescriptor }> = [
    { id: 'all', label: msg('widget.symbolPicker.tab.all', 'All') },
    { id: 'stocks', label: msg('widget.symbolPicker.tab.stocks', 'Stocks') },
    { id: 'etfs', label: msg('widget.symbolPicker.tab.etfs', 'ETFs') },
    { id: 'crypto', label: msg('widget.symbolPicker.tab.crypto', 'Crypto') },
    { id: 'futures', label: msg('widget.symbolPicker.tab.futures', 'Futures') },
    { id: 'forex', label: msg('widget.symbolPicker.tab.forex', 'Forex') },
    { id: 'commodities', label: msg('widget.symbolPicker.tab.commodities', 'Commodities') },
];

const TAB_TYPES: Readonly<Record<Exclude<SymbolTab, 'all'>, readonly string[]>> = {
    crypto: ['crypto'],
    stocks: ['stock'],
    etfs: ['etf'],
    futures: ['futures', 'root'],
    forex: ['forex'],
    commodities: ['commodity'],
};

const PLACEMENTS: ReadonlyArray<{ id: ComparePlacement; label: MessageDescriptor }> = [
    { id: 'same', label: msg('widget.comparePicker.placement.same', 'Same % scale') },
    { id: 'new-scale', label: msg('widget.comparePicker.placement.newScale', 'New price scale') },
    { id: 'new-pane', label: msg('widget.comparePicker.placement.newPane', 'New pane') },
];

const TEXT = {
    title: msg('widget.comparePicker.title', 'Compare symbol'),
    search: msg('widget.comparePicker.search', 'Search symbol to compare…'),
    noMatch: msg('widget.symbolPicker.noMatch', 'No symbols match.'),
    empty: msg('widget.symbolPicker.empty', 'No symbols available yet.'),
    showContracts: msg('widget.symbolPicker.showContracts', 'Show contracts'),
    remove: msg('widget.comparePicker.remove', 'Remove comparison'),
};

const TOP_TICKERS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'];
const PAGE = 100;

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

const STYLE_ID = 'vela-widget-comparepicker';
const CSS = css`@layer vela.chrome {

.vela-cp-head { flex: none; padding: ${t.space[4]} ${t.space[4]} 0; }
.vela-cp-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    background: ${t.surface.elev};
    border: 1px solid ${t.border};
    border-radius: ${t.radius.md};
}
.vela-cp-searchrow:focus-within { border-color: ${t.border.strong}; }
.vela-cp-searchrow .vela-icon { color: ${t.fg.muted}; }
.vela-cp-input {
    flex: 1;
    background: transparent;
    color: ${t.fg};
    border: none;
    font-size: 14px;
    outline: 2px solid transparent;
    text-transform: uppercase;
}
.vela-cp-input::placeholder { text-transform: none; }
.vela-cp-active {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-block-start: 10px;
}
.vela-cp-active:empty { display: none; }
.vela-cp-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding-inline: 8px 4px;
    border-radius: ${t.radius.sm};
    background: ${t.surface.elev};
    border: 1px solid ${t.border};
    color: ${t.fg.bright};
    font-size: 12px;
    font-weight: 600;
}
.vela-cp-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
}
.vela-cp-chip-x {
    all: unset;
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    border-radius: ${t.radius.sm};
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: ${t.fg.muted};
}
.vela-cp-chip-x:hover { background: ${t.hover}; color: ${t.fg.bright}; }
.vela-cp-chip-x .vela-icon { width: 12px; height: 12px; font-size: 12px; }
.vela-cp-tabs { display: flex; gap: 14px; margin: 12px 2px 0; border-block-end: 1px solid ${t.border}; padding-block-end: 8px; }
.vela-cp-list {
    min-height: 0;
    margin: ${t.space[2]} ${t.space[4]} ${t.space[4]};
    max-height: 46vh;
    overflow: auto;
}
[data-layout='mobile'] .vela-cp-tabs { overflow-x: auto; scrollbar-width: none; gap: 6px; }
[data-layout='mobile'] .vela-cp-tabs::-webkit-scrollbar { display: none; }
[data-layout='mobile'] .vela-cp-tabs > .vela-tab { flex: none; padding: 7px 10px; }
[data-layout='mobile'] .vela-cp-list { flex: 1 1 auto; max-height: none; margin-block-end: 0; }
.vela-cp-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 7px 10px;
    border-radius: ${t.radius.md};
    cursor: pointer;
}
.vela-cp-row:hover, .vela-cp-row[data-highlighted] { background: ${t.hover}; }
.vela-cp-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: ${t.fg.onFill};
    font-size: ${t.fontSize.md};
    font-weight: 700;
}
.vela-cp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.vela-cp-ticker { font-weight: 700; color: ${t.fg.bright}; font-size: 14px; text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-cp-desc { color: ${t.fg.muted}; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-cp-badge {
    flex: none;
    padding: 2px 8px;
    border-radius: ${t.radius.sm};
    background: ${t.surface.elev};
    border: 1px solid ${t.border};
    color: ${t.fg.muted};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.vela-cp-actions {
    display: none;
    flex: none;
    align-items: center;
    gap: 4px;
}
.vela-cp-row:hover .vela-cp-actions { display: inline-flex; }
.vela-cp-row:hover .vela-cp-badge { display: none; }
[data-layout='mobile'] .vela-cp-row:hover .vela-cp-actions { display: none; }
[data-layout='mobile'] .vela-cp-row:hover .vela-cp-badge { display: inline-flex; }
.vela-cp-action {
    all: unset;
    box-sizing: border-box;
    height: 24px;
    padding: 0 8px;
    border-radius: ${t.radius.sm};
    border: 1px solid ${t.border};
    background: ${t.surface.elev};
    color: ${t.fg};
    font-size: 11px;
    font-weight: 550;
    white-space: nowrap;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
}
.vela-cp-action:hover {
    background: ${t.selected.bg};
    color: ${t.selected.fg};
    border-color: transparent;
}
.vela-cp-empty { padding: ${t.space[3]}; color: ${t.fg.muted}; text-align: center; }
.vela-cp-expander {
    all: unset;
    box-sizing: border-box;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: ${t.radius.sm};
    cursor: pointer;
    color: ${t.fg.muted};
}
.vela-cp-expander:hover { background: ${t.surface.elev}; color: ${t.fg}; }
.vela-cp-row[data-member] { padding-inline-start: 34px; }

}`;

export class ComparePicker {
    private readonly dialog: Dialog;
    private readonly input: HTMLInputElement;
    private readonly list: HTMLElement;
    private readonly activeEl: HTMLElement;
    private readonly tabs: TabsHandle;
    private source: () => readonly SymbolDescriptor[] = () => [];
    private rows: SymbolDescriptor[] = [];
    private highlighted = 0;
    private activeTab: SymbolTab = 'all';
    private visible = PAGE;
    private exhausted = false;
    private readonly expanded = new Set<string>();
    private ranked: { key: string; result: SymbolDescriptor[] } | null = null;
    private ranking = false;
    private shown = false;
    private focusTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly opts: ComparePickerOptions) {
        const doc = (opts.host ?? document.body).ownerDocument;
        injectChromeStyles(STYLE_ID, CSS, doc);

        this.input = doc.createElement('input');
        this.input.className = 'vela-cp-input';
        this.input.placeholder = textOf(opts.i18n, TEXT.search);
        this.input.setAttribute('spellcheck', 'false');
        const searchRow = doc.createElement('div');
        searchRow.className = 'vela-cp-searchrow';
        searchRow.append(iconEl('search', doc), this.input);

        this.activeEl = doc.createElement('div');
        this.activeEl.className = 'vela-cp-active';

        this.tabs = createTabs({
            variant: 'filled',
            className: 'vela-cp-tabs',
            items: TABS.map((tab) => ({ value: tab.id, label: textOf(opts.i18n, tab.label) })),
            defaultValue: this.activeTab,
            onValueChange: (id) => {
                this.activeTab = id as SymbolTab;
                this.refresh();
            },
        });

        const head = doc.createElement('div');
        head.className = 'vela-cp-head';
        head.append(searchRow, this.activeEl, this.tabs.el);

        this.list = doc.createElement('div');
        this.list.className = 'vela-cp-list';
        this.list.addEventListener('scroll', () => {
            if (this.exhausted) return;
            if (this.list.scrollTop + this.list.clientHeight < this.list.scrollHeight - 200) return;
            this.visible += PAGE;
            this.grow();
        });

        this.dialog = new Dialog({
            title: textOf(opts.i18n, TEXT.title),
            ...(opts.i18n ? { i18n: opts.i18n } : {}),
            host: opts.host,
            closeOnInteractOutside: true,
            flush: true,
            content: (body) => body.append(head, this.list),
            onOpenChange: (open) => {
                this.shown = open;
                if (open) {
                    this.relabel();
                    this.input.value = '';
                    this.renderActive();
                    this.refresh();
                    if (this.focusTimer !== null) clearTimeout(this.focusTimer);
                    this.focusTimer = setTimeout(() => {
                        this.focusTimer = null;
                        if (this.shown) this.input.focus();
                    }, 0);
                } else {
                    if (this.focusTimer !== null) {
                        clearTimeout(this.focusTimer);
                        this.focusTimer = null;
                    }
                    this.input.blur();
                }
                opts.onOpenChange?.(open);
            },
        });

        this.input.addEventListener('input', () => {
            const next = this.input.value.toUpperCase();
            if (this.input.value !== next) {
                const start = this.input.selectionStart;
                const end = this.input.selectionEnd;
                this.input.value = next;
                if (start != null && end != null) this.input.setSelectionRange(start, end);
            }
            this.refresh();
        });
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') this.moveHighlight(1);
            else if (e.key === 'ArrowUp') this.moveHighlight(-1);
            else if (e.key === 'Enter') {
                const pick = this.rows[this.highlighted];
                if (pick) this.pick(pick, 'same');
                return;
            } else return;
            e.preventDefault();
        });
        this.list.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const row = target.closest<HTMLElement>('.vela-cp-row');
            if (!row) return;
            const s = this.rows[Number(row.dataset.i)];
            if (!s) return;
            if (target.closest('.vela-cp-expander')) {
                this.toggleExpand(s);
                return;
            }
            const actionBtn = target.closest<HTMLElement>('.vela-cp-action');
            const placement = (actionBtn?.dataset.placement as ComparePlacement | undefined) ?? 'same';
            this.pick(s, placement);
        });
    }

    setSource(source: () => readonly SymbolDescriptor[]): void {
        this.source = source;
    }

    open(): void {
        this.dialog.show();
    }

    close(): void {
        this.dialog.hide();
    }

    get isOpen(): boolean {
        return this.dialog.open;
    }

    destroy(): void {
        this.shown = false;
        if (this.focusTimer !== null) {
            clearTimeout(this.focusTimer);
            this.focusTimer = null;
        }
        this.tabs.destroy();
        this.dialog.destroy();
    }

    relabel(): void {
        const i18n = this.opts.i18n;
        this.dialog.titleEl.textContent = textOf(i18n, TEXT.title);
        this.dialog.setI18n(i18n ?? null);
        this.input.placeholder = textOf(i18n, TEXT.search);
        this.tabs.setItems(TABS.map((tab) => ({ value: tab.id, label: textOf(i18n, tab.label) })));
    }

    private renderActive(): void {
        const doc = this.activeEl.ownerDocument;
        this.activeEl.replaceChildren();
        const items = this.opts.activeItems?.() ?? [];
        for (const item of items) {
            const chip = doc.createElement('span');
            chip.className = 'vela-cp-chip';
            chip.dataset.compareId = item.id;
            const dot = doc.createElement('span');
            dot.className = 'vela-cp-dot';
            dot.style.background = item.color;
            const label = doc.createElement('span');
            label.textContent = item.title;
            const x = doc.createElement('button');
            x.type = 'button';
            x.className = 'vela-cp-chip-x';
            x.setAttribute('aria-label', textOf(this.opts.i18n, TEXT.remove));
            x.appendChild(iconEl('close', doc));
            x.addEventListener('click', () => {
                this.opts.onRemove?.(item.id);
                this.renderActive();
            });
            chip.append(dot, label, x);
            this.activeEl.appendChild(chip);
        }
    }

    private pick(s: SymbolDescriptor, placement: ComparePlacement): void {
        const target = isGroupRow(s) ? (defaultMemberOf(this.pool(), s) ?? s) : s;
        const venue = target.prefix ?? target.provider;
        const canonical = venue ? `${venue}:${target.ticker}` : target.ticker;
        this.close();
        this.opts.onAdd(canonical, placement);
    }

    private toggleExpand(s: SymbolDescriptor): void {
        const key = groupKeyOf(s);
        if (!this.expanded.delete(key)) this.expanded.add(key);
        const scrollTop = this.list.scrollTop;
        const focus = this.rows[this.highlighted];
        this.rows = this.computeRows();
        this.list.replaceChildren();
        this.rows.forEach((r, i) => this.list.appendChild(this.rowEl(r, i)));
        const at = focus ? this.rows.indexOf(focus) : -1;
        this.highlighted = at >= 0 ? at : Math.min(this.highlighted, Math.max(0, this.rows.length - 1));
        this.renderHighlight();
        this.list.scrollTop = scrollTop;
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
                .catch(() => {
                    this.ranked = { key, result: [...raw] };
                })
                .finally(() => {
                    this.ranking = false;
                    if (this.shown) this.refresh();
                });
        }
        return this.ranked?.result ?? raw;
    }

    private computeRows(): SymbolDescriptor[] {
        const all = this.pool();
        const tab = this.activeTab;
        const pool =
            tab === 'all'
                ? all
                : all.filter((s) => TAB_TYPES[tab].includes((s.type ?? '').toLowerCase()) || (tab === 'crypto' && (s.type ?? '').toLowerCase() === 'futures'));
        const filtered = filterSymbols(pool, this.input.value, this.visible, symbolRanking() ? false : TOP_TICKERS);
        this.exhausted = filtered.length < this.visible;
        const folded = foldGroups(filtered);
        if (!this.expanded.size) return folded;
        const keyOf = (s: SymbolDescriptor): string => `${(s.prefix ?? s.provider ?? '').toLowerCase()}:${s.ticker.toUpperCase()}`;
        const present = new Set(folded.map(keyOf));
        const out: SymbolDescriptor[] = [];
        for (const s of folded) {
            out.push(s);
            if (!isGroupRow(s) || !this.expanded.has(groupKeyOf(s))) continue;
            for (const m of groupMembers(all, s)) {
                if (present.has(keyOf(m))) continue;
                present.add(keyOf(m));
                out.push(m);
            }
        }
        return out;
    }

    private refresh(): void {
        const doc = this.list.ownerDocument;
        this.visible = PAGE;
        this.rows = this.computeRows();
        this.highlighted = 0;
        this.list.replaceChildren();
        if (!this.rows.length) {
            const empty = doc.createElement('div');
            empty.className = 'vela-cp-empty';
            empty.textContent = textOf(this.opts.i18n, this.input.value ? TEXT.noMatch : TEXT.empty);
            this.list.appendChild(empty);
            return;
        }
        this.rows.forEach((s, i) => this.list.appendChild(this.rowEl(s, i)));
        this.renderHighlight();
    }

    private grow(): void {
        const already = this.rows.length;
        this.rows = this.computeRows();
        this.rows.slice(already).forEach((s, j) => this.list.appendChild(this.rowEl(s, already + j)));
    }

    private rowEl(s: SymbolDescriptor, i: number): HTMLElement {
        const doc = this.list.ownerDocument;
        const row = doc.createElement('div');
        row.className = 'vela-cp-row';
        row.dataset.i = String(i);
        row.dataset.ticker = s.ticker;
        const venue = s.prefix ?? s.provider;
        if (venue) row.dataset.venue = venue;
        const av = tickerIconEl(doc, baseOf(s), s.ticker, 'vela-cp-avatar', this.opts.iconFor?.(s));
        const main = doc.createElement('span');
        main.className = 'vela-cp-main';
        const ticker = doc.createElement('span');
        ticker.className = 'vela-cp-ticker';
        ticker.textContent = s.ticker;
        const desc = doc.createElement('span');
        desc.className = 'vela-cp-desc';
        desc.textContent = s.description ?? (s.type ?? '');
        main.append(ticker, desc);
        row.append(av, main);
        if (isGroupRow(s)) {
            row.dataset.group = '1';
            const expander = doc.createElement('button');
            expander.type = 'button';
            expander.className = 'vela-cp-expander';
            expander.setAttribute('aria-label', textOf(this.opts.i18n, TEXT.showContracts));
            expander.appendChild(iconEl(this.expanded.has(groupKeyOf(s)) ? 'chevron-down' : 'chevron-right', doc));
            row.appendChild(expander);
        } else if (s.group != null && this.expanded.has(groupKeyOf(s))) row.dataset.member = '1';

        const actions = doc.createElement('span');
        actions.className = 'vela-cp-actions';
        for (const p of PLACEMENTS) {
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'vela-cp-action';
            btn.dataset.placement = p.id;
            btn.textContent = textOf(this.opts.i18n, p.label);
            actions.appendChild(btn);
        }
        row.appendChild(actions);

        if (venue) {
            const badge = doc.createElement('span');
            badge.className = 'vela-cp-badge';
            badge.dataset.p = s.provider ?? venue;
            badge.textContent = venue;
            row.appendChild(badge);
        }
        return row;
    }
}
