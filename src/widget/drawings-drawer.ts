// Drawings drawer (mobile) — the bottom-sheet counterpart of the docked drawing
// toolbar: a search bar, the tool groups as horizontally scrollable tabs, and the
// active group's tools as a touch-sized list with favorite stars. Searching flattens
// every group into one filtered list. Data comes from the same DOM-free toolbar model
// the docked bar paints (`ToolbarDefinition`), so custom `options.drawings` sets and
// plugin-registered types appear here automatically.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import type { ToolbarDefinition, ToolDefinition } from '../core/drawings/toolbar';
import type { DrawingTypeKey } from '../core/drawings/Drawing';

const STYLE_ID = 'vela-widget-drawings-drawer';
const CSS = `
/* Search + tabs stay pinned while the tool list scrolls underneath. */
.vela-dd-sticky {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--vela-surface);
    padding-top: 2px;
}
.vela-dd-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    margin: 0 2px 8px;
    border: 1px solid var(--vela-border);
    border-radius: 8px;
    color: var(--vela-fg-muted);
    background: var(--vela-surface);
}
.vela-dd-search input {
    all: unset;
    flex: 1 1 auto;
    min-width: 0;
    font-size: 14px;
    color: var(--vela-fg-bright);
}
.vela-dd-tabs {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    /* The strip scrolls sideways itself — its touches are native scroll, not tab swipes
       (the drawer body is pan-y so everywhere ELSE a sideways move swipes the tabs). */
    touch-action: pan-x;
    padding: 0 2px 8px;
    border-bottom: 1px solid var(--vela-border);
    background: var(--vela-surface);
}
.vela-dd-tabs::-webkit-scrollbar { display: none; }
.vela-dd-tab {
    all: unset;
    flex: none;
    min-height: 36px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-tab[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-dd-list { padding: 6px 0 4px; }
.vela-dd-section {
    padding: 10px 2px 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    color: var(--vela-fg-muted);
}
.vela-dd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-row:active { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] { background: var(--vela-hover); }
.vela-dd-row[data-active='1'] .vela-dd-label { color: var(--vela-accent); }
.vela-dd-glyph { flex: none; width: 24px; height: 24px; color: var(--vela-fg); }
.vela-dd-glyph svg { width: 24px; height: 24px; }
.vela-dd-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dd-star {
    all: unset;
    flex: none;
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    color: var(--vela-fg-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-dd-star[data-on='1'] { color: var(--vela-highlight); }
.vela-dd-empty { padding: 18px 2px; color: var(--vela-fg-muted); font-size: 13px; }
`;

export interface DrawingsDrawerOptions {
    host: HTMLElement;
    /** Read live at open — the toolbar model (custom sets / late-registered types apply). */
    toolbar: () => ToolbarDefinition;
    currentTool: () => DrawingTypeKey | null;
    isFavorite: (type: DrawingTypeKey) => boolean;
    onFavorite: (type: DrawingTypeKey, on: boolean) => void;
    onSelect: (type: DrawingTypeKey) => void;
    onOpenChange?: (open: boolean) => void;
}

export class DrawingsDrawer {
    private readonly drawer: Drawer;
    private readonly input: HTMLInputElement;
    private readonly tabs: HTMLElement;
    private readonly list: HTMLElement;
    private definition: ToolbarDefinition = { groups: [] };
    private activeGroup = '';

    constructor(private readonly opts: DrawingsDrawerOptions) {
        const doc = opts.host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.drawer = new Drawer({
            host: opts.host,
            title: 'Drawings',
            onOpenChange: opts.onOpenChange,
            // Swiping across the tool list pages through the group tabs.
            onSwipe: (dir) => this.stepGroup(dir === 'left' ? 1 : -1),
        });

        const sticky = doc.createElement('div');
        sticky.className = 'vela-dd-sticky';

        const search = doc.createElement('div');
        search.className = 'vela-dd-search';
        search.appendChild(iconEl('search', doc));
        this.input = doc.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = 'Search tools…';
        this.input.addEventListener('input', () => this.renderList());
        search.appendChild(this.input);

        this.tabs = doc.createElement('div');
        this.tabs.className = 'vela-dd-tabs';
        sticky.append(search, this.tabs);

        this.list = doc.createElement('div');
        this.list.className = 'vela-dd-list';

        this.drawer.body.append(sticky, this.list);
    }

    open(): void {
        this.definition = this.opts.toolbar();
        if (!this.definition.groups.some((g) => g.id === this.activeGroup)) this.activeGroup = this.definition.groups[0]?.id ?? '';
        this.input.value = '';
        this.renderTabs();
        this.renderList();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    /** Move the active group tab by `step` (a horizontal swipe on the list). Search mode
     *  shows the flattened results — no tabs to page through, so the swipe is inert. */
    private stepGroup(step: number): void {
        if (this.input.value.trim()) return;
        const groups = this.definition.groups;
        const next = groups[groups.findIndex((g) => g.id === this.activeGroup) + step];
        if (!next) return;
        this.activeGroup = next.id;
        this.renderTabs();
        this.renderList();
        this.tabs.querySelector('[data-active="1"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    private renderTabs(): void {
        const doc = this.tabs.ownerDocument;
        this.tabs.replaceChildren();
        for (const group of this.definition.groups) {
            const tab = doc.createElement('button');
            tab.className = 'vela-dd-tab';
            tab.textContent = group.label;
            if (group.id === this.activeGroup) tab.dataset.active = '1';
            tab.addEventListener('click', () => {
                this.activeGroup = group.id;
                this.input.value = ''; // picking a tab leaves search mode
                this.renderTabs();
                this.renderList();
            });
            this.tabs.appendChild(tab);
        }
    }

    private renderList(): void {
        const doc = this.list.ownerDocument;
        this.list.replaceChildren();
        const query = this.input.value.trim().toLowerCase();
        const active = this.opts.currentTool();

        const section = (label: string): void => {
            const el = doc.createElement('div');
            el.className = 'vela-dd-section';
            el.textContent = label;
            this.list.appendChild(el);
        };
        const row = (tool: ToolDefinition): void => {
            const el = doc.createElement('div');
            el.className = 'vela-dd-row';
            if (tool.type === active) el.dataset.active = '1';
            const glyph = doc.createElement('span');
            glyph.className = 'vela-dd-glyph';
            glyph.innerHTML = tool.icon;
            const label = doc.createElement('span');
            label.className = 'vela-dd-label';
            label.textContent = tool.label;
            const star = doc.createElement('button');
            star.className = 'vela-dd-star';
            const paintStar = (on: boolean): void => {
                star.replaceChildren(iconEl(on ? 'star-filled' : 'star', doc));
                if (on) star.dataset.on = '1';
                else delete star.dataset.on;
            };
            paintStar(this.opts.isFavorite(tool.type));
            star.setAttribute('aria-label', `Favorite ${tool.label}`);
            star.addEventListener('click', (e) => {
                e.stopPropagation(); // the row underneath arms the tool — a star tap must not
                const on = !this.opts.isFavorite(tool.type);
                this.opts.onFavorite(tool.type, on);
                paintStar(on);
            });
            el.append(glyph, label, star);
            el.addEventListener('click', () => {
                this.opts.onSelect(tool.type);
                this.drawer.hide();
            });
            this.list.appendChild(el);
        };

        if (query) {
            // Search flattens every group; group labels become the section headers.
            let any = false;
            for (const group of this.definition.groups) {
                const hits = group.tools.filter((t) => t.label.toLowerCase().includes(query));
                if (hits.length === 0) continue;
                any = true;
                section(group.label);
                for (const tool of hits) row(tool);
            }
            if (!any) {
                const empty = doc.createElement('div');
                empty.className = 'vela-dd-empty';
                empty.textContent = 'No tools match.';
                this.list.appendChild(empty);
            }
            return;
        }

        const group = this.definition.groups.find((g) => g.id === this.activeGroup);
        if (!group) return;
        if (group.sections && group.sections.length > 0) {
            for (const s of group.sections) {
                section(s.label);
                for (const tool of s.tools) row(tool);
            }
        } else {
            for (const tool of group.tools) row(tool);
        }
    }
}
