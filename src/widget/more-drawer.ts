// The three-dots drawer (mobile) — the catch-all for everything the hidden topbar and
// desktop bottombar used to carry: undo/redo/screenshot as an action row, then rows for
// chart type, the multi-chart layout (workspace shells), the side panels (data window,
// object tree, contributed), alerts, and every contributed topbar action. Chart type,
// layout and alerts open as IN-DRAWER sub-views with a back button — a drawer inside a
// drawer would stack sheets. Time zone lives on a long-press of the time axis (see
// `timezone-drawer.ts`), not here.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { layoutGridCanvas, paintLayoutGrid } from './layout-picker';

const STYLE_ID = 'vela-widget-more-drawer';
const CSS = `
.vela-md-actions {
    display: flex;
    gap: 6px;
    padding: 2px 2px 10px;
    border-bottom: 1px solid var(--vela-border);
}
.vela-md-action {
    all: unset;
    flex: 1 1 0;
    min-height: 48px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-radius: 8px;
    font-size: 11px;
    color: var(--vela-fg);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-action:active { background: var(--vela-hover); }
.vela-md-action:disabled { opacity: 0.35; cursor: default; }
.vela-md-action .vela-icon { font-size: 17px; width: 17px; height: 17px; }
.vela-md-list { padding: 6px 0 4px; }
.vela-md-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-md-row:active { background: var(--vela-hover); }
.vela-md-row[data-checked='1'] { background: var(--vela-hover-strong); }
.vela-md-row .vela-icon { flex: none; font-size: 17px; width: 17px; height: 17px; color: var(--vela-fg-muted); }
.vela-md-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-md-row-value { flex: none; font-size: 13px; color: var(--vela-fg-muted); }
.vela-md-back {
    all: unset;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
    border-bottom: 1px solid var(--vela-border);
    width: 100%;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
}
/* The layout sub-view's grid canvas, centered and touch-sized (the base .vela-lp-grid
   squares are popover-sized for a mouse). */
.vela-md-gridwrap { display: flex; justify-content: center; padding: 14px 0 10px; }
.vela-md-gridwrap .vela-lp-grid { grid-template-columns: repeat(4, 44px); grid-auto-rows: 44px; gap: 8px; }
.vela-md-section {
    padding: 12px 2px 4px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-md-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
`;

export interface MoreDrawerAction {
    label: string;
    icon?: string;
    run: () => void;
}

export interface MoreDrawerOptions {
    host: HTMLElement;
    /** Omitted (with onRedo) ⇒ no undo/redo action buttons — the shell's topbar
     *  composition removed `'undo-redo'`; the keyboard chords are the shell's call. */
    onUndo?: () => void;
    onRedo?: () => void;
    /** Omitted ⇒ no screenshot action button (composition removed `'screenshot'`). */
    onScreenshot?: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    /** Chart style list + current selection (read live at open). */
    priceStyles: () => Array<{ id: string; label: string; icon?: string }>;
    priceStyle: () => string;
    onPriceStyle: (id: string) => void;
    /** Docked side panels (built-in + contributed), toggled by id. */
    panels: () => Array<{ id: string; title: string; icon: string }>;
    onTogglePanel: (id: string) => void;
    /** Omitted ⇒ no Alerts row (composition removed `'alerts'`). */
    alerts?: () => Array<{ title: string; message: string; time: number }>;
    /** Contributed topbar actions, projected as plain rows. */
    actions: () => MoreDrawerAction[];
    /** Multi-chart layout switching (workspace shells) — the row is hidden when omitted.
     *  The sub-view carries the SAME surface as the desktop layout dropdown: the 4×4
     *  tap-to-apply grid canvas, the presets the canvas cannot express as rows, and the
     *  sync switches. Everything is read live at open. */
    layout?: {
        /** Current layout's canvas shape (null = a preset the canvas cannot express). */
        shape: () => { rows: number; cols: number } | null;
        /** Registered layouts NOT expressible on the canvas — rendered as labeled rows. */
        presets: () => Array<{ id: string; label: string; checked: boolean }>;
        onSelectGrid: (rows: number, cols: number) => void;
        onSelectPreset: (id: string) => void;
        syncs?: () => Array<{ id: string; label: string; checked: boolean }>;
        onToggleSync?: (id: string) => void;
    };
    onOpenChange?: (open: boolean) => void;
}

type MoreView = 'main' | 'style' | 'layout' | 'alerts';

export class MoreDrawer {
    private readonly drawer: Drawer;
    private view: MoreView = 'main';

    constructor(private readonly opts: MoreDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, onOpenChange: opts.onOpenChange });
    }

    open(): void {
        this.view = 'main';
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private show(view: MoreView): void {
        this.view = view;
        this.render();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();

        if (this.view !== 'main') {
            const back = doc.createElement('button');
            back.className = 'vela-md-back';
            back.appendChild(iconEl('chevron-left', doc));
            back.appendChild(doc.createTextNode(this.view === 'style' ? 'Chart type' : this.view === 'layout' ? 'Layout' : 'Alerts'));
            back.addEventListener('click', () => this.show('main'));
            this.drawer.body.appendChild(back);
        }

        if (this.view === 'main') this.renderMain(doc);
        else if (this.view === 'style') this.renderStyle(doc);
        else if (this.view === 'layout') this.renderLayout(doc);
        else this.renderAlerts(doc);
    }

    private row(doc: Document, label: string, opts: { icon?: string; value?: string; chevron?: boolean; checked?: boolean; onClick: () => void }): HTMLElement {
        const el = doc.createElement('div');
        el.className = 'vela-md-row';
        if (opts.icon) el.appendChild(iconEl(opts.icon, doc));
        const text = doc.createElement('span');
        text.className = 'vela-md-row-label';
        text.textContent = label;
        el.appendChild(text);
        if (opts.value) {
            const value = doc.createElement('span');
            value.className = 'vela-md-row-value';
            value.textContent = opts.value;
            el.appendChild(value);
        }
        if (opts.checked) el.dataset.checked = '1';
        if (opts.chevron) el.appendChild(iconEl('chevron-right', doc));
        el.addEventListener('click', opts.onClick);
        return el;
    }

    private renderMain(doc: Document): void {
        const actions = doc.createElement('div');
        actions.className = 'vela-md-actions';
        const action = (icon: string, label: string, enabled: boolean, run: () => void): void => {
            const b = doc.createElement('button');
            b.className = 'vela-md-action';
            b.disabled = !enabled;
            b.appendChild(iconEl(icon, doc));
            b.appendChild(doc.createTextNode(label));
            b.addEventListener('click', () => {
                run();
                this.drawer.hide();
            });
            actions.appendChild(b);
        };
        if (this.opts.onUndo) action('undo', 'Undo', this.opts.canUndo(), this.opts.onUndo);
        if (this.opts.onRedo) action('redo', 'Redo', this.opts.canRedo(), this.opts.onRedo);
        if (this.opts.onScreenshot) action('camera', 'Screenshot', true, this.opts.onScreenshot);
        if (actions.childElementCount > 0) this.drawer.body.appendChild(actions);

        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        const current = this.opts.priceStyles().find((s) => s.id === this.opts.priceStyle());
        list.appendChild(this.row(doc, 'Chart type', { icon: 'style-line', value: current?.label, chevron: true, onClick: () => this.show('style') }));
        if (this.opts.layout) {
            const shape = this.opts.layout.shape();
            const value = shape ? `${shape.cols} × ${shape.rows}` : this.opts.layout.presets().find((p) => p.checked)?.label;
            list.appendChild(this.row(doc, 'Layout', { icon: 'layout', value, chevron: true, onClick: () => this.show('layout') }));
        }
        for (const panel of this.opts.panels()) {
            list.appendChild(
                this.row(doc, panel.title, {
                    icon: panel.icon,
                    onClick: () => {
                        this.opts.onTogglePanel(panel.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        if (this.opts.alerts) {
            const alertCount = this.opts.alerts().length;
            list.appendChild(this.row(doc, 'Alerts', { icon: 'bell', value: alertCount > 0 ? String(alertCount) : undefined, chevron: true, onClick: () => this.show('alerts') }));
        }
        for (const act of this.opts.actions()) {
            list.appendChild(
                this.row(doc, act.label, {
                    icon: act.icon,
                    onClick: () => {
                        act.run();
                        this.drawer.hide();
                    },
                }),
            );
        }
        this.drawer.body.appendChild(list);
    }

    private renderStyle(doc: Document): void {
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        const current = this.opts.priceStyle();
        for (const style of this.opts.priceStyles()) {
            list.appendChild(
                this.row(doc, style.label, {
                    icon: style.icon,
                    checked: style.id === current,
                    onClick: () => {
                        this.opts.onPriceStyle(style.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        this.drawer.body.appendChild(list);
    }

    private renderLayout(doc: Document): void {
        const layout = this.opts.layout;
        if (!layout) return;
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        // The desktop dropdown's grid canvas, touch-sized: the current rows×cols
        // rectangle is lit, a tap applies that grid immediately (no hover preview).
        const wrap = doc.createElement('div');
        wrap.className = 'vela-md-gridwrap';
        const { el: grid, squares } = layoutGridCanvas(doc);
        paintLayoutGrid(squares, layout.shape());
        grid.addEventListener('click', (e) => {
            const sq = (e.target as Element | null)?.closest?.('.vela-lp-sq');
            if (!(sq instanceof HTMLButtonElement)) return;
            layout.onSelectGrid(Number(sq.dataset.r) + 1, Number(sq.dataset.c) + 1);
            this.drawer.hide();
        });
        wrap.appendChild(grid);
        list.appendChild(wrap);
        for (const preset of layout.presets()) {
            list.appendChild(
                this.row(doc, preset.label, {
                    checked: preset.checked,
                    onClick: () => {
                        layout.onSelectPreset(preset.id);
                        this.drawer.hide();
                    },
                }),
            );
        }
        const syncs = layout.syncs?.() ?? [];
        if (syncs.length > 0) {
            const heading = doc.createElement('div');
            heading.className = 'vela-md-section';
            heading.textContent = 'Sync';
            list.appendChild(heading);
            for (const s of syncs) {
                list.appendChild(
                    this.row(doc, s.label, {
                        checked: s.checked,
                        onClick: () => {
                            layout.onToggleSync?.(s.id);
                            this.render(); // a toggle stays in the drawer — reflect the flip in place
                        },
                    }),
                );
            }
        }
        this.drawer.body.appendChild(list);
    }

    private renderAlerts(doc: Document): void {
        const alerts = this.opts.alerts?.() ?? [];
        if (alerts.length === 0) {
            const empty = doc.createElement('div');
            empty.className = 'vela-md-empty';
            empty.textContent = 'No alerts yet.';
            this.drawer.body.appendChild(empty);
            return;
        }
        const list = doc.createElement('div');
        list.className = 'vela-md-list';
        for (const a of alerts) {
            list.appendChild(this.row(doc, `${a.title}: ${a.message}`, { value: new Date(a.time).toLocaleTimeString(), onClick: () => undefined }));
        }
        this.drawer.body.appendChild(list);
    }
}
