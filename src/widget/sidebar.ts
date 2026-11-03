// The SIDEBAR — the shell's right-edge toolbar, the counterpart of the topbar, the bottom bar
// and the drawing toolbar on the fourth side. It hosts the side-panel toggles (the dock
// drives it through {@link PanelChrome}, as it drives the topbar) and the actions plugins
// register with `target: 'sidebar'`, laid out by the host's `sidebar` composition. Desktop
// only: on the mobile layout the panels keep their menu rows and the actions join them.
import { Tooltip } from '@luxalgo/vela-ui/tooltip';
import { iconEl } from '@luxalgo/vela-ui/icons';
import { injectStyles } from '@luxalgo/vela-ui/styles';
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageLike, Translator } from '../core/i18n/types';
import type { PanelChrome } from './panel-dock';
import { widgetActions, type SidebarControl, type SidePanelButton, type WidgetActionDescriptor, type WidgetContext } from './contributions';
import { composeSidebar, type SidebarComposition } from './sidebar-composition';

const TEXT = {
    sidebar: msg('vela.sidebar.label', 'Sidebar'),
} as const;

export const SIDEBAR_WIDTH_PX = 44;

const STYLE_ID = 'vela-sidebar';
const CSS = `
.vela-sidebar {
    order: 1;
    width: ${SIDEBAR_WIDTH_PX}px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 12px;
    padding: var(--vela-space-1) 0;
    border-left: 1px solid var(--vela-border-soft);
    color: var(--vela-fg-muted);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    user-select: none;
}
.vela-sidebar::-webkit-scrollbar { display: none; }
[data-layout='mobile'] .vela-sidebar { display: none; }
.vela-sidebar-section, .vela-sidebar-group { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.vela-sidebar-section { gap: 6px; }
.vela-sidebar-sep { width: 20px; height: 1px; background: var(--vela-border); }
.vela-sidebar-btn {
    all: unset;
    box-sizing: border-box;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 30px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-sidebar-btn:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-sidebar-btn[data-active='1'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-sidebar-btn:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
.vela-sidebar-badge {
    position: absolute;
    top: 1px;
    right: 1px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 7px;
    background: var(--vela-accent);
    color: var(--vela-fg-on-fill);
    font-size: 9px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
}
`;

export interface SidebarOptions {
    /** The host's layout of the entries (default: panels on top, the inspection panels and
     *  the actions at the bottom). */
    composition?: SidebarComposition;
    /** Where the tooltips mount (the shell root: it carries the theme tokens). */
    host: HTMLElement;
    /** The shell's translator. Absent: English. */
    i18n?: Translator;
    /** The live widget context, handed to the actions. */
    context(): WidgetContext;
}

interface Entry {
    id: string;
    kind: 'panel' | 'action';
    order: number;
    title: string;
    icon: string;
    active: boolean;
    run(): void;
}

export class Sidebar implements PanelChrome {
    readonly el: HTMLElement;
    private readonly topEl: HTMLElement;
    private readonly bottomEl: HTMLElement;
    private panels: SidePanelButton[] = [];
    private onPanel: (id: string) => void = () => {};
    private readonly open = new Set<string>();
    private readonly badges = new Map<string, string>();
    /** Entries a plugin hid at runtime (`ctx.sidebar.setVisible`). */
    private readonly hidden = new Set<string>();
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private tooltips: Tooltip[] = [];
    /** The shell finished building: the actions (which read the context) may show. */
    private live = false;

    constructor(private readonly opts: SidebarOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('nav');
        this.el.className = 'vela-sidebar';
        this.topEl = doc.createElement('div');
        this.topEl.className = 'vela-sidebar-section';
        this.topEl.dataset.section = 'top';
        this.bottomEl = doc.createElement('div');
        this.bottomEl.className = 'vela-sidebar-section';
        this.bottomEl.dataset.section = 'bottom';
        this.el.append(this.topEl, this.bottomEl);
        this.relocalize();
    }

    setPanelButtons(buttons: readonly SidePanelButton[], onClick: (id: string) => void): void {
        this.panels = [...buttons];
        this.onPanel = onClick;
        this.render();
    }

    setPanelActive(id: string, open: boolean): void {
        if (open) this.open.add(id);
        else this.open.delete(id);
        const b = this.buttons.get(id);
        if (b) this.paintActive(b, open);
    }

    setBadge(id: string, badge: string | number | null): void {
        const text = badge == null || badge === 0 || badge === '' ? null : typeof badge === 'number' && badge > 99 ? '99+' : String(badge);
        if ((this.badges.get(id) ?? null) === text) return;
        if (text === null) this.badges.delete(id);
        else this.badges.set(id, text);
        this.render();
    }

    isVisible(id: string): boolean {
        return this.buttons.has(id);
    }

    setVisible(id: string, visible: boolean): void {
        if (visible === !this.hidden.has(id)) return;
        if (visible) this.hidden.delete(id);
        else this.hidden.add(id);
        this.render();
    }

    /** The shell is built: show the actions from now on. */
    activate(): void {
        this.live = true;
        this.render();
    }

    /** Redraw from the dock's panels and the registered sidebar actions. */
    render(): void {
        for (const t of this.tooltips) t.destroy();
        this.tooltips = [];
        this.buttons.clear();
        const entries: Entry[] = [
            ...this.panels.map((p, i) => ({ id: p.id, kind: 'panel' as const, order: i, title: p.title, icon: p.icon, active: this.open.has(p.id), run: () => this.onPanel(p.id) })),
            ...(this.live ? this.actions(this.opts.context()) : []),
        ];
        const layout = composeSidebar(
            entries.filter((e) => !this.hidden.has(e.id)),
            this.opts.composition,
        );
        this.topEl.replaceChildren(...this.groups(layout.top));
        this.bottomEl.replaceChildren(...this.groups(layout.bottom));
    }

    relocalize(): void {
        this.el.setAttribute('aria-label', this.t(TEXT.sidebar));
        this.render();
    }

    destroy(): void {
        for (const t of this.tooltips) t.destroy();
        this.tooltips = [];
        this.el.remove();
    }

    private actions(ctx: WidgetContext): Entry[] {
        const out: Entry[] = [];
        // `widgetActions` is the registry's order; the index keeps it as the flow order.
        for (const [i, a] of sidebarActions(ctx).entries()) {
            out.push({
                id: a.id,
                kind: 'action',
                order: i,
                title: this.t(a.label),
                icon: a.icon ?? 'kebab',
                active: safe(() => a.active?.(ctx) ?? false),
                run: () => {
                    a.run(this.opts.context());
                    this.render();
                },
            });
        }
        return out;
    }

    private groups(groups: Entry[][]): HTMLElement[] {
        const doc = this.el.ownerDocument;
        const out: HTMLElement[] = [];
        groups.forEach((g, i) => {
            if (i > 0) {
                const sep = doc.createElement('div');
                sep.className = 'vela-sidebar-sep';
                sep.setAttribute('role', 'separator');
                out.push(sep);
            }
            const group = doc.createElement('div');
            group.className = 'vela-sidebar-group';
            group.append(...g.map((e) => this.button(e)));
            out.push(group);
        });
        return out;
    }

    private button(e: Entry): HTMLButtonElement {
        const doc = this.el.ownerDocument;
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'vela-sidebar-btn';
        b.dataset.id = e.id;
        b.dataset.kind = e.kind;
        // The same hooks as the topbar's and the mobile bar's buttons: a plugin anchors its
        // popover to `[data-action-id="<its id>"]`.
        if (e.kind === 'action') b.dataset.actionId = e.id;
        else b.dataset.panelId = e.id;
        b.setAttribute('aria-label', e.title);
        b.appendChild(iconEl(e.icon, doc));
        const badge = this.badges.get(e.id);
        if (badge) {
            const span = doc.createElement('span');
            span.className = 'vela-sidebar-badge';
            span.textContent = badge;
            b.appendChild(span);
        }
        this.paintActive(b, e.active);
        b.addEventListener('click', () => e.run());
        this.tooltips.push(new Tooltip(b, { content: e.title, placement: 'left', triggerId: `vela-sidebar-${e.id}`, host: this.opts.host }));
        this.buttons.set(e.id, b);
        return b;
    }

    private paintActive(b: HTMLButtonElement, on: boolean): void {
        b.dataset.active = on ? '1' : '';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    private t(m: MessageLike): string {
        return textOf(this.opts.i18n ?? null, m);
    }
}

/** `ctx.sidebar` over a shell's sidebar, if it has one (read at call time). */
export function sidebarControl(get: () => Sidebar | null): SidebarControl {
    return {
        get enabled() {
            return get() !== null;
        },
        setBadge: (id, badge) => get()?.setBadge(id, badge),
        refresh: () => get()?.render(),
        isVisible: (id) => get()?.isVisible(id) ?? false,
        setVisible: (id, visible) => get()?.setVisible(id, visible),
    };
}

/** The actions contributed to the sidebar, `when`-filtered. */
export function sidebarActions(ctx: WidgetContext): WidgetActionDescriptor[] {
    return widgetActions('sidebar', ctx);
}

function safe(fn: () => boolean): boolean {
    try {
        return fn();
    } catch {
        return false;
    }
}
