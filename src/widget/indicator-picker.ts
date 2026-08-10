// Indicator picker — a dialog over the widget's indicator manifest: toggle entries on/off
// (live add/remove on the current chart; state survives rebuilds via the widget).
import { Dialog } from '../ui/components/dialog';
import { injectStyles } from '../ui/styles';
import { iconEl } from '../ui/icons';

export interface IndicatorRow {
    name: string;
    language?: string;
    category?: string;
    /** Core-computed (native) indicator — accent styling + 'native' routing. */
    native?: boolean;
    /** Native type id (routing key for add/remove). */
    nativeType?: string;
    /** Beta badge (native catalog flag). */
    beta?: boolean;
}

const STYLE_ID = 'vela-widget-indpicker';
const CSS = `
.vela-ip-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    margin-bottom: var(--vela-space-2);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
}
.vela-ip-searchrow:focus-within { border-color: var(--vela-border-strong); }
.vela-ip-searchrow .vela-icon { color: var(--vela-fg-muted); }
.vela-ip-search { flex: 1; background: transparent; color: var(--vela-fg); border: none; font-size: 14px; outline: none; }
.vela-ip-list { max-height: 50vh; overflow: auto; min-width: 380px; }
/* Mobile (fullscreen dialog): no width floor — 380px would overflow a phone —
   and no height cap; the fullscreen body owns the scrolling. */
[data-layout='mobile'] .vela-ip-list { min-width: 0; max-height: none; }
.vela-ip-list::-webkit-scrollbar { width: 8px; }
.vela-ip-list::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
.vela-ip-group {
    color: var(--vela-fg-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 10px 4px 4px;
    border-bottom: 1px solid var(--vela-border);
    margin-bottom: 2px;
}
.vela-ip-oncard {
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-bottom: var(--vela-space-2);
}
.vela-ip-oncard .vela-ip-group { border-bottom: none; padding-top: 2px; }
.vela-ip-row {
    display: flex;
    align-items: center;
    gap: var(--vela-space-2);
    padding: 7px 6px;
    border-radius: var(--vela-radius-sm);
    cursor: pointer;
}
.vela-ip-row:hover { background: var(--vela-hover); }
.vela-ip-name { flex: 1; font-weight: 600; color: var(--vela-fg-bright); font-size: 13px; }
.vela-ip-badge {
    flex: none;
    padding: 1px 7px;
    border-radius: var(--vela-radius-sm);
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-accent);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}
.vela-ip-trash {
    all: unset;
    cursor: pointer;
    color: var(--vela-fg-muted);
    padding: 2px 4px;
    border-radius: var(--vela-radius-sm);
    font-size: var(--vela-font-size-md);
}
.vela-ip-trash:hover { color: var(--vela-down); background: var(--vela-hover); }
.vela-ip-empty { padding: var(--vela-space-3); color: var(--vela-fg-muted); text-align: center; }
`;

export interface IndicatorPickerOptions {
    /** The manifest library — clicking a row ADDS an instance (repeatable). */
    library: () => readonly IndicatorRow[];
    /** The live instances on the chart — the trash removes one. */
    onChart: () => readonly IndicatorRow[];
    onAdd: (libraryIndex: number) => void;
    onRemove: (instanceIndex: number) => void;
    onOpenChange?: (open: boolean) => void;
    host?: HTMLElement;
}

export class IndicatorPicker {
    private readonly dialog: Dialog;
    private readonly list: HTMLElement;
    private readonly search: HTMLInputElement;
    private readonly opts: IndicatorPickerOptions;
    private isOpen = false;

    constructor(opts: IndicatorPickerOptions) {
        this.opts = opts;
        const doc = (opts.host ?? document.body).ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.search = doc.createElement('input');
        this.search.className = 'vela-ip-search';
        this.search.placeholder = 'Search…';
        this.search.spellcheck = false;
        this.search.addEventListener('input', () => this.refresh());
        const searchRow = doc.createElement('div');
        searchRow.className = 'vela-ip-searchrow';
        searchRow.append(iconEl('search', doc), this.search);
        this.list = doc.createElement('div');
        this.list.className = 'vela-ip-list';
        this.dialog = new Dialog({
            title: 'Indicators',
            host: opts.host,
            draggable: true,
            closeOnInteractOutside: true,
            // The picker adds/removes indicators live — keep the chart undimmed behind it.
            content: (body) => body.append(searchRow, this.list),
            onOpenChange: (open) => {
                this.isOpen = open;
                if (open) {
                    this.search.value = '';
                    this.refresh();
                    setTimeout(() => this.search.focus(), 0);
                }
                opts.onOpenChange?.(open);
            },
        });
        this.list.addEventListener('click', (e) => {
            const trash = (e.target as HTMLElement).closest<HTMLElement>('.vela-ip-trash');
            const row = (e.target as HTMLElement).closest<HTMLElement>('.vela-ip-row');
            if (!row) return;
            if (trash) {
                this.opts.onRemove(Number(row.dataset.instance));
            } else if (row.dataset.library !== undefined) {
                this.opts.onAdd(Number(row.dataset.library));
            }
            this.refresh();
        });
    }

    open(): void {
        this.dialog.show();
    }

    /** Re-render the lists if the dialog is open (async catalog updates land late). */
    sync(): void {
        if (this.isOpen) this.refresh();
    }

    close(): void {
        this.dialog.hide();
    }

    destroy(): void {
        this.dialog.destroy();
    }

    private refresh(): void {
        const doc = this.list.ownerDocument;
        const q = this.search.value.trim().toLowerCase();
        const library = this.opts.library();
        const instances = this.opts.onChart();
        this.list.replaceChildren();
        const match = (r: IndicatorRow): boolean => !q || r.name.toLowerCase().includes(q);

        const rowEl = (r: IndicatorRow, opts: { library?: number; instance?: number }): HTMLElement => {
            const row = doc.createElement('div');
            row.className = 'vela-ip-row';
            if (opts.library !== undefined) row.dataset.library = String(opts.library);
            if (opts.instance !== undefined) row.dataset.instance = String(opts.instance);
            if (r.native) row.dataset.native = '1';
            const name = doc.createElement('span');
            name.className = 'vela-ip-name';
            name.textContent = r.name;
            row.appendChild(name);
            if (r.beta) {
                const beta = doc.createElement('span');
                beta.className = 'vela-ip-badge';
                beta.textContent = 'beta';
                row.appendChild(beta);
            }
            if (opts.instance !== undefined) {
                const badgeText = r.native ? 'vela' : r.language;
                if (badgeText) {
                    const badge = doc.createElement('span');
                    badge.className = 'vela-ip-badge';
                    badge.textContent = badgeText;
                    row.appendChild(badge);
                }
                const trash = doc.createElement('button');
                trash.className = 'vela-ip-trash';
                trash.appendChild(iconEl('trash', doc));
                trash.title = 'Remove from chart';
                row.appendChild(trash);
            }
            return row;
        };

        // "ON CHART · n" — every live instance (the same script may appear several times).
        const onChart = instances.map((r, i) => [r, i] as const).filter(([r]) => match(r));
        if (onChart.length) {
            const card = doc.createElement('div');
            card.className = 'vela-ip-oncard';
            const title = doc.createElement('div');
            title.className = 'vela-ip-group';
            title.textContent = `On chart · ${onChart.length}`;
            card.appendChild(title);
            for (const [r, i] of onChart) card.appendChild(rowEl(r, { instance: i }));
            this.list.appendChild(card);
        }

        // The library, grouped by category — clicking ADDS an instance (repeatable).
        const byCat = new Map<string, Array<readonly [IndicatorRow, number]>>();
        library.forEach((r, i) => {
            if (!match(r)) return;
            const cat = r.category ?? 'General';
            const bucket = byCat.get(cat) ?? [];
            bucket.push([r, i] as const);
            byCat.set(cat, bucket);
        });
        for (const [cat, bucket] of byCat) {
            const title = doc.createElement('div');
            title.className = 'vela-ip-group';
            title.textContent = cat;
            this.list.appendChild(title);
            for (const [r, i] of bucket) this.list.appendChild(rowEl(r, { library: i }));
        }
        if (!onChart.length && byCat.size === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-ip-empty';
            empty.textContent = library.length ? 'No indicators match.' : 'No indicators in the manifest.';
            this.list.appendChild(empty);
        }
    }
}
