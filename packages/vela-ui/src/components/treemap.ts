// Treemap: weighted items laid into a rectangle as tiles close to square, each tinted by its
// value on a diverging scale (up above zero, down below, stronger as the value grows) and
// labeled when it has room. Items with children are groups: their tiles share a block headed
// by the group's name and a figure of its values. With `drill`, a group's header zooms into it
// and a breadcrumb leads back. Values repaint without a new layout, and a tile keeps its
// element across layouts, so a resize or a zoom moves it instead of redrawing it.
import { showTip } from '../lib/chart';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { msg, textOf, type Translator } from '../lib/i18n';
import { kitTranslator } from '../lib/kit-text';
import { t } from '../lib/t';

export const treemapDef = defineComponent({
    name: 'treemap',
    parts: ['root', 'crumbs', 'crumb', 'map', 'group', 'group-name', 'group-value', 'tile', 'tile-label', 'tile-value', 'legend', 'legend-bar', 'tip'],
    settings: {
        radius: t.radius.sm,
        up: t.up,
        down: t.down,
        'tile-bg': `color-mix(in srgb, ${t.fg.bright} 2.5%, ${t.surface})`,
        'tint-min': '3%',
        'tint-max': '25%',
        'hover-z': '1',
        'tip-radius': t.radius.md,
        'tip-bg': t.surface.elev,
        'tip-shadow': t.shadow,
        'tip-z': '2',
    },
});

export interface TreemapItem {
    /** Stable across updates: a tile keeps its element by id. */
    id: string;
    label: string;
    /** The tile's share of the area (default 1, equal tiles); zero or less leaves it out. A
     *  group's share is the sum of its items'. */
    weight?: number;
    /** What the tile is tinted by and shows; null while it is unknown. */
    value?: number | null;
    /** The tile's ink instead of its value's tone: a token's `var()` (`t.accent.var`) or a color. */
    color?: string;
    /** The group's items: the item becomes a group. */
    children?: readonly TreemapItem[];
}

/** How a group's header sums up its items' values, or a function of them. */
export type TreemapGroupValue = 'median' | 'mean' | 'sum' | 'none' | ((values: readonly number[], group: TreemapItem) => number | null);

export interface TreemapProps {
    items?: readonly TreemapItem[];
    /** The size of a value whose tint is full. Default: the largest one on the map. */
    domain?: number;
    /** A value as the tiles, the headers, the readout and the legend write it. Default: signed,
     *  two decimals. */
    format?: (value: number) => string;
    /** A group header's figure (default the median of its items' values). */
    groupValue?: TreemapGroupValue;
    /** The readout beside a hovered or focused tile, or `false` for none. Default: its label,
     *  value and groups. */
    tip?: ((item: TreemapItem, path: readonly TreemapItem[]) => string | Node) | false;
    /** A tile's click, Enter or Space. `path` lists its groups, outermost first. */
    onSelect?: (item: TreemapItem, path: readonly TreemapItem[]) => void;
    /** The id of the tile drawn as selected. */
    selected?: string | null;
    /** Group headers zoom into their group, and a breadcrumb above the map leads back. */
    drill?: boolean;
    /** A zoom changed: `path` is the zoomed group's path (empty at the top). */
    onDrill?: (path: readonly TreemapItem[]) => void;
    /** The breadcrumb's first entry (default "All"). */
    rootLabel?: string;
    /** A scale under the map, from the negative to the positive domain. */
    legend?: boolean;
    /** Space between tiles, in pixels (default 3). */
    gap?: number;
    /** The map's accessible name. */
    label?: string;
    /** The translator of the treemap's own words. Default: the kit build's, else English. */
    i18n?: Translator | null;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface TreemapHandle {
    readonly el: HTMLElement;
    /** New items: lays the map out again. A zoom stays on its group while the group exists. */
    setData(items: readonly TreemapItem[]): void;
    /** New values by id: repaints the tints, figures and readout without a new layout. */
    setValues(values: ReadonlyMap<string, number | null> | Readonly<Record<string, number | null>>): void;
    setSelected(id: string | null): void;
    /** Zoom into a group by id, or back to the top with null. */
    drillTo(id: string | null): void;
    destroy(): void;
}

export interface TreemapRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Lay weighted items into `bounds` as tiles close to square (the squarified layout): areas
 *  follow the weights and fill the bounds exactly, heaviest first. Items weighing nothing are
 *  left out. */
export function squarify<T extends { weight: number }>(items: readonly T[], bounds: TreemapRect): Array<T & TreemapRect> {
    const total = items.reduce((s, item) => s + Math.max(0, item.weight), 0);
    if (!total || bounds.w <= 0 || bounds.h <= 0) return [];
    const scale = (bounds.w * bounds.h) / total;
    let queue = items
        .filter((item) => item.weight > 0)
        .map((item) => ({ item, area: item.weight * scale }))
        .sort((a, b) => b.area - a.area);
    let { x, y, w, h } = bounds;
    const out: Array<T & TreemapRect> = [];
    const worst = (row: ReadonlyArray<{ area: number }>, side: number): number => {
        const sum = row.reduce((s, r) => s + r.area, 0);
        const max = Math.max(...row.map((r) => r.area));
        const min = Math.min(...row.map((r) => r.area));
        return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
    };
    while (queue.length) {
        const side = Math.min(w, h);
        const row = [queue[0]!];
        let i = 1;
        while (i < queue.length && worst([...row, queue[i]!], side) <= worst(row, side)) row.push(queue[i++]!);
        queue = queue.slice(i);
        const sum = row.reduce((s, r) => s + r.area, 0);
        if (w >= h) {
            const cw = sum / h;
            let cy = y;
            for (const r of row) {
                const ch = r.area / cw;
                out.push({ ...r.item, x, y: cy, w: cw, h: ch });
                cy += ch;
            }
            x += cw;
            w -= cw;
        } else {
            const rh = sum / w;
            let cx = x;
            for (const r of row) {
                const rw = r.area / rh;
                out.push({ ...r.item, x: cx, y, w: rw, h: rh });
                cx += rw;
            }
            y += rh;
            h -= rh;
        }
    }
    return out;
}

const TEXT = {
    all: msg('ui.treemap.all', 'All'),
    zoomIn: msg('ui.treemap.zoomIn', 'Zoom in'),
};

/** A group's header row, and the smallest block that gets one. */
const HEADER = 16;
const HEADED = { w: 80, h: 64 };

const injectStyles = defineStyles(
    'vela-ui-treemap',
    css`
        @layer vela.ui {
            [data-slot='treemap'] {
                position: relative;
                width: 100%;
                height: 100%;
                min-height: 0;
                color: ${t.fg};
                font-size: ${t.fontSize.sm};

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
            }
            [data-slot='treemap-crumbs'] {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 2px;
                min-height: 22px;
                font-size: 12px;
                color: ${t.fg.muted};
            }
            [data-slot='treemap-crumb'] {
                all: unset;
                padding: 2px 6px;
                border-radius: ${treemapDef.vars.radius};
                cursor: pointer;

                &:hover {
                    background: ${t.hover};
                    color: ${t.fg.bright};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                }
                &[aria-current] {
                    cursor: default;
                    color: ${t.fg.bright};
                    font-weight: 600;
                    background: none;
                }
                &:not(:first-child)::before {
                    content: '›';
                    margin-inline-end: 8px;
                    color: ${t.fg.faint};
                }
            }
            [data-slot='treemap-map'] {
                position: relative;
                flex: 1 1 auto;
                min-height: 0;
                isolation: isolate;
            }
            [data-slot='treemap-group'] {
                all: unset;
                position: absolute;
                display: flex;
                align-items: center;
                gap: 6px;
                height: 16px;
                padding-inline: 2px;
                overflow: hidden;
                font-size: 9px;
                font-weight: 500;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                white-space: nowrap;
                color: ${t.fg.muted};
                transition:
                    left ${t.dur.med} ${t.ease},
                    top ${t.dur.med} ${t.ease},
                    width ${t.dur.med} ${t.ease};

                &[data-drill] {
                    border-radius: ${treemapDef.vars.radius};
                    cursor: zoom-in;
                }
                &[data-drill]:hover {
                    color: ${t.fg.bright};
                    background: ${t.hover};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                }
            }
            [data-slot='treemap-group-name'] {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            [data-slot='treemap-group-value'] {
                margin-inline-start: auto;
                font-variant-numeric: tabular-nums;

                &[data-tone='up'] {
                    color: ${treemapDef.vars.up};
                }
                &[data-tone='down'] {
                    color: ${treemapDef.vars.down};
                }
            }
            [data-slot='treemap-tile'] {
                all: unset;
                --_tone: ${t.fg.muted};
                --_tint: calc(${treemapDef.vars['tint-min']} + (${treemapDef.vars['tint-max']} - ${treemapDef.vars['tint-min']}) * var(--_level, 0));

                position: absolute;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 1px;
                overflow: hidden;
                border: 1px solid color-mix(in srgb, var(--_tone) calc(var(--_tint) * 0.8), ${t.border});
                border-radius: ${treemapDef.vars.radius};
                background: color-mix(in srgb, var(--_tone) var(--_tint), ${treemapDef.vars['tile-bg']});
                text-align: center;
                cursor: pointer;
                transition:
                    left ${t.dur.med} ${t.ease},
                    top ${t.dur.med} ${t.ease},
                    width ${t.dur.med} ${t.ease},
                    height ${t.dur.med} ${t.ease},
                    background-color ${t.dur.med} linear,
                    scale ${t.dur.fast} ${t.ease};

                &[data-tone='up'] {
                    --_tone: ${treemapDef.vars.up};
                }
                &[data-tone='down'] {
                    --_tone: ${treemapDef.vars.down};
                }
                &[data-tone='custom'] {
                    --_tone: var(--_color);
                }
                &[data-tone='none'] {
                    --_tint: 0%;
                }
                &:hover {
                    z-index: ${treemapDef.vars['hover-z']};
                    scale: 1.04;
                    border-color: ${t.fg.bright};
                }
                &:focus-visible {
                    z-index: ${treemapDef.vars['hover-z']};
                    outline: 2px solid ${t.focus};
                }
                &[data-selected] {
                    border-color: ${t.fg.bright};
                    outline: 1px solid ${t.fg.bright};
                }
            }
            [data-slot='treemap-tile-label'] {
                max-width: 100%;
                overflow: hidden;
                text-overflow: ellipsis;
                font-weight: 600;
                line-height: 1.1;
                white-space: nowrap;
                color: ${t.fg.bright};
            }
            [data-slot='treemap-tile-value'] {
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
                color: ${t.fg.bright};
                opacity: 0.92;
            }
            [data-slot='treemap-legend'] {
                display: grid;
                grid-template-columns: auto 1fr auto;
                align-items: center;
                gap: 8px;
                font-size: 10px;
                font-variant-numeric: tabular-nums;
                color: ${t.fg.muted};
            }
            [data-slot='treemap-legend-bar'] {
                height: 6px;
                border: 1px solid ${t.border};
                border-radius: 999px;
                background: linear-gradient(
                    to right,
                    color-mix(in srgb, ${treemapDef.vars.down} 70%, ${treemapDef.vars['tile-bg']}),
                    ${treemapDef.vars['tile-bg']},
                    color-mix(in srgb, ${treemapDef.vars.up} 70%, ${treemapDef.vars['tile-bg']})
                );
            }
            [data-slot='treemap-tip'] {
                position: absolute;
                z-index: ${treemapDef.vars['tip-z']};
                top: 0;
                gap: 2px;
                pointer-events: none;
                padding: 8px;
                border: 1px solid ${t.border};
                border-radius: ${treemapDef.vars['tip-radius']};
                background: ${treemapDef.vars['tip-bg']};
                box-shadow: ${treemapDef.vars['tip-shadow']};
                color: ${t.fg.bright};
                font-size: 12px;
                line-height: 1.35;
                white-space: nowrap;
                font-variant-numeric: tabular-nums;
                transition:
                    left ${t.dur.fast} ease-out,
                    top ${t.dur.fast} ease-out;

                &:where(:not([hidden])) {
                    display: grid;
                }
                &[data-instant] {
                    transition: none;
                }
                & [data-tone='up'] {
                    color: ${treemapDef.vars.up};
                }
                & [data-tone='down'] {
                    color: ${treemapDef.vars.down};
                }
                & small {
                    color: ${t.fg.muted};
                }
            }
        }
    `,
);

const weightOf = (item: TreemapItem): number => (item.children ? item.children.reduce((s, c) => s + weightOf(c), 0) : Math.max(0, item.weight ?? 1));

function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = (sorted.length - 1) / 2;
    return (sorted[Math.floor(mid)]! + sorted[Math.ceil(mid)]!) / 2;
}

const toneOf = (value: number | null): 'up' | 'down' | 'flat' | 'none' => (value === null ? 'none' : value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

const defaultFormat = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(2)}`;

interface Placed extends TreemapRect {
    item: TreemapItem;
    /** The groups above it, outermost first. */
    path: TreemapItem[];
}

interface TileView {
    el: HTMLButtonElement;
    label: HTMLElement | null;
    value: HTMLElement | null;
    placed: Placed;
}

interface GroupView {
    el: HTMLElement;
    value: HTMLElement;
    placed: Placed;
}

class TreemapImpl implements TreemapHandle {
    readonly el: HTMLElement;
    private readonly map: HTMLElement;
    private readonly tip: HTMLElement;
    private readonly crumbs: HTMLElement | null;
    private readonly legend: { low: HTMLElement; high: HTMLElement } | null;
    private readonly ro: ResizeObserver | null;
    private readonly i18n: Translator | null;
    private readonly gap: number;
    private items: readonly TreemapItem[];
    private readonly values = new Map<string, number | null>();
    private tiles = new Map<string, TileView>();
    private groups = new Map<string, GroupView>();
    /** The zoomed groups' ids, outermost first. */
    private zoom: string[] = [];
    private selected: string | null;
    /** The tile that takes the map's tab stop. */
    private current: string | null = null;
    /** The tile the readout describes. */
    private tipFor: string | null = null;
    private box = { w: 0, h: 0 };

    constructor(private readonly props: TreemapProps) {
        injectStyles(document);
        this.i18n = props.i18n ?? kitTranslator();
        this.gap = Math.max(0, props.gap ?? 3);
        this.items = props.items ?? [];
        this.selected = props.selected ?? null;
        this.map = h('div', { slot: treemapDef.slot('map'), attrs: { role: 'group', dir: 'ltr', 'aria-label': props.label ?? null } });
        this.tip = h('div', { slot: treemapDef.slot('tip'), attrs: { 'aria-hidden': 'true' } });
        this.tip.hidden = true;
        this.crumbs = props.drill ? h('nav', { slot: treemapDef.slot('crumbs') }) : null;
        let legendEl: HTMLElement | null = null;
        if (props.legend) {
            const low = h('span');
            const high = h('span');
            legendEl = h('div', { slot: treemapDef.slot('legend'), attrs: { 'aria-hidden': 'true', dir: 'ltr' } }, low, h('i', { slot: treemapDef.slot('legend-bar') }), high);
            this.legend = { low, high };
        } else this.legend = null;
        this.el = h('div', { className: props.className, slot: treemapDef.slot('root') }, this.crumbs, this.map, legendEl, this.tip);
        this.map.addEventListener('keydown', (e) => this.onKey(e));
        this.map.addEventListener('pointerleave', () => this.hideTip());
        this.el.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || this.zoom.length === 0) return;
            e.preventDefault();
            e.stopPropagation();
            this.setZoom(this.zoom.slice(0, -1), true);
        });
        this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
        this.ro?.observe(this.map);
        this.renderCrumbs();
        this.layout();
    }

    setData(items: readonly TreemapItem[]): void {
        this.items = items;
        this.values.clear();
        const zoom: string[] = [];
        let level = items;
        for (const id of this.zoom) {
            const group = level.find((item) => item.id === id && item.children);
            if (!group) break;
            zoom.push(id);
            level = group.children!;
        }
        const changed = zoom.length !== this.zoom.length;
        this.zoom = zoom;
        this.renderCrumbs();
        this.layout();
        if (changed) this.props.onDrill?.(this.zoomPath());
    }

    setValues(values: ReadonlyMap<string, number | null> | Readonly<Record<string, number | null>>): void {
        const entries = values instanceof Map ? values.entries() : Object.entries(values);
        for (const [id, value] of entries) this.values.set(id, value);
        this.paint();
    }

    setSelected(id: string | null): void {
        this.selected = id;
        for (const [key, tile] of this.tiles) tile.el.toggleAttribute('data-selected', key === id);
    }

    drillTo(id: string | null): void {
        if (id === null) {
            this.setZoom([], true);
            return;
        }
        const path = this.pathTo(id, this.items, []);
        if (path) this.setZoom([...path.map((g) => g.id), id], true);
    }

    destroy(): void {
        this.ro?.disconnect();
        this.el.remove();
    }

    private pathTo(id: string, level: readonly TreemapItem[], above: TreemapItem[]): TreemapItem[] | null {
        for (const item of level) {
            if (!item.children) continue;
            if (item.id === id) return above;
            const found = this.pathTo(id, item.children, [...above, item]);
            if (found) return found;
        }
        return null;
    }

    /** The zoomed groups, outermost first. */
    private zoomPath(): TreemapItem[] {
        const path: TreemapItem[] = [];
        let level = this.items;
        for (const id of this.zoom) {
            const group = level.find((item) => item.id === id);
            if (!group?.children) break;
            path.push(group);
            level = group.children;
        }
        return path;
    }

    private setZoom(zoom: string[], announce: boolean): void {
        if (zoom.join('\u0000') === this.zoom.join('\u0000')) return;
        this.zoom = zoom;
        this.current = null;
        this.hideTip();
        this.renderCrumbs();
        this.layout();
        if (announce) this.props.onDrill?.(this.zoomPath());
    }

    private renderCrumbs(): void {
        if (!this.crumbs) return;
        const path = this.zoomPath();
        const entries: Array<{ label: string; zoom: string[] }> = [{ label: this.props.rootLabel ?? textOf(this.i18n, TEXT.all), zoom: [] }];
        path.forEach((group, i) => entries.push({ label: group.label, zoom: this.zoom.slice(0, i + 1) }));
        this.crumbs.replaceChildren(
            ...entries.map((entry, i) => {
                const last = i === entries.length - 1;
                return h('button', {
                    slot: treemapDef.slot('crumb'),
                    text: entry.label,
                    attrs: { type: 'button', 'aria-current': last ? 'true' : null, tabindex: last ? '-1' : null },
                    on: { click: () => !last && this.setZoom(entry.zoom, true) },
                });
            }),
        );
    }

    private measure(): void {
        const w = this.map.clientWidth;
        const hh = this.map.clientHeight;
        if (Math.abs(w - this.box.w) < 0.5 && Math.abs(hh - this.box.h) < 0.5) return;
        this.box = { w, h: hh };
        this.layout();
    }

    /** The items on the map: the zoomed group's, or the top level's. */
    private level(): { items: readonly TreemapItem[]; path: TreemapItem[] } {
        const path = this.zoomPath();
        return { items: path.length > 0 ? path[path.length - 1]!.children! : this.items, path };
    }

    private place(items: readonly TreemapItem[], bounds: TreemapRect, path: TreemapItem[], groups: Placed[], tiles: Placed[]): void {
        const half = this.gap / 2;
        for (const r of squarify(
            items.map((item) => ({ item, weight: weightOf(item) })),
            bounds,
        )) {
            const box = { x: r.x + half, y: r.y + half, w: Math.max(0, r.w - this.gap), h: Math.max(0, r.h - this.gap) };
            if (r.item.children) {
                const headed = box.w >= HEADED.w && box.h >= HEADED.h;
                if (headed) groups.push({ item: r.item, path, ...box, h: HEADER });
                const top = headed ? HEADER : 0;
                this.place(r.item.children, { x: box.x, y: box.y + top, w: box.w, h: box.h - top }, [...path, r.item], groups, tiles);
            } else tiles.push({ item: r.item, path, ...box });
        }
    }

    private layout(): void {
        const level = this.level();
        const groups: Placed[] = [];
        const tiles: Placed[] = [];
        this.place(level.items, { x: 0, y: 0, w: this.box.w, h: this.box.h }, level.path, groups, tiles);

        const nextGroups = new Map<string, GroupView>();
        for (const placed of groups) {
            const view = this.groups.get(placed.item.id) ?? this.groupView(placed);
            view.placed = placed;
            view.el.firstElementChild!.textContent = placed.item.label;
            position(view.el, placed);
            nextGroups.set(placed.item.id, view);
        }
        const nextTiles = new Map<string, TileView>();
        for (const placed of tiles) {
            const old = this.tiles.get(placed.item.id);
            const view = old ?? this.tileView(placed);
            view.placed = placed;
            this.fitTile(view);
            position(view.el, placed);
            nextTiles.set(placed.item.id, view);
        }
        for (const [id, view] of this.groups) if (!nextGroups.has(id)) view.el.remove();
        for (const [id, view] of this.tiles) if (!nextTiles.has(id)) view.el.remove();
        this.groups = nextGroups;
        this.tiles = nextTiles;

        // Reading order: each group's header, then its tiles. Nodes that already sit in that
        // order stay put, as a moved node restarts its transitions.
        const order: HTMLElement[] = [];
        const headerOf = new Map(groups.map((g) => [g.item.id, nextGroups.get(g.item.id)!.el]));
        const written = new Set<string>();
        for (const placed of tiles) {
            for (const group of placed.path) {
                const header = headerOf.get(group.id);
                if (header && !written.has(group.id)) {
                    written.add(group.id);
                    order.push(header);
                }
            }
            order.push(nextTiles.get(placed.item.id)!.el);
        }
        const children = this.map.children;
        const same = children.length === order.length && order.every((node, i) => children[i] === node);
        if (!same) this.map.replaceChildren(...order);

        if (this.current === null || !this.tiles.has(this.current)) this.current = tiles[0]?.item.id ?? null;
        for (const [id, tile] of this.tiles) {
            tile.el.tabIndex = id === this.current ? 0 : -1;
            tile.el.toggleAttribute('data-selected', id === this.selected);
        }
        this.paint();
    }

    private groupView(placed: Placed): GroupView {
        const name = h('span', { slot: treemapDef.slot('group-name') });
        const value = h('span', { slot: treemapDef.slot('group-value') });
        const drill = this.props.drill === true;
        const el = drill
            ? h(
                  'button',
                  {
                      slot: treemapDef.slot('group'),
                      data: { drill: true },
                      attrs: { type: 'button', title: textOf(this.i18n, TEXT.zoomIn) },
                  },
                  name,
                  value,
              )
            : h('div', { slot: treemapDef.slot('group') }, name, value);
        const view: GroupView = { el, value, placed };
        if (drill) el.addEventListener('click', () => this.drillTo(view.placed.item.id));
        return view;
    }

    private tileView(placed: Placed): TileView {
        const el = h('button', { slot: treemapDef.slot('tile'), attrs: { type: 'button' } });
        const view: TileView = { el, label: null, value: null, placed };
        el.addEventListener('click', () => this.choose(view));
        el.addEventListener('focus', () => {
            this.current = view.placed.item.id;
            for (const tile of this.tiles.values()) tile.el.tabIndex = tile === view ? 0 : -1;
            this.showTipFor(view);
        });
        el.addEventListener('blur', () => this.hideTip());
        el.addEventListener('pointerenter', () => this.showTipFor(view));
        return view;
    }

    /** Text sized to the tile: the label from a small tile up, the value from a larger one. */
    private fitTile(view: TileView): void {
        const { w, h: ht } = view.placed;
        const font = Math.max(10, Math.min(18, Math.min(w, ht) / 4.2));
        const showLabel = w > 34 && ht > 20;
        const showValue = w > 48 && ht > 38;
        if (showLabel && !view.label) view.label = h('span', { slot: treemapDef.slot('tile-label') });
        if (!showLabel) view.label = null;
        if (showValue && !view.value) view.value = h('span', { slot: treemapDef.slot('tile-value') });
        if (!showValue) view.value = null;
        if (view.label) {
            view.label.textContent = view.placed.item.label;
            view.label.style.fontSize = `${font}px`;
        }
        if (view.value) view.value.style.fontSize = `${Math.max(9.5, font * 0.72)}px`;
        const parts = [view.label, view.value].filter((part): part is HTMLElement => part !== null);
        if (parts.length !== view.el.childElementCount || parts.some((part, i) => view.el.children[i] !== part)) view.el.replaceChildren(...parts);
    }

    private valueOf(item: TreemapItem): number | null {
        const value = this.values.has(item.id) ? this.values.get(item.id)! : (item.value ?? null);
        return value === null || !Number.isFinite(value) ? null : value;
    }

    private leafValues(item: TreemapItem): number[] {
        if (!item.children) {
            const value = this.valueOf(item);
            return value === null ? [] : [value];
        }
        return item.children.flatMap((child) => this.leafValues(child));
    }

    private groupFigure(group: TreemapItem): number | null {
        const mode = this.props.groupValue ?? 'median';
        if (mode === 'none') return null;
        const values = this.leafValues(group);
        if (typeof mode === 'function') return mode(values, group);
        if (values.length === 0) return null;
        if (mode === 'sum') return values.reduce((s, v) => s + v, 0);
        if (mode === 'mean') return values.reduce((s, v) => s + v, 0) / values.length;
        return median(values);
    }

    private format(value: number): string {
        return (this.props.format ?? defaultFormat)(value);
    }

    private paint(): void {
        let largest = 0;
        for (const tile of this.tiles.values()) largest = Math.max(largest, Math.abs(this.valueOf(tile.placed.item) ?? 0));
        const domain = this.props.domain !== undefined && this.props.domain > 0 ? this.props.domain : largest;
        for (const tile of this.tiles.values()) {
            const item = tile.placed.item;
            const value = this.valueOf(item);
            if (item.color !== undefined) {
                tile.el.dataset.tone = 'custom';
                tile.el.style.setProperty('--_color', item.color);
            } else tile.el.dataset.tone = toneOf(value);
            tile.el.style.setProperty('--_level', value === null || domain === 0 ? '0' : String(Math.min(Math.abs(value) / domain, 1)));
            const text = value === null ? '' : this.format(value);
            if (tile.value) tile.value.textContent = text;
            tile.el.setAttribute('aria-label', text === '' ? item.label : `${item.label} ${text}`);
        }
        for (const group of this.groups.values()) {
            const figure = this.groupFigure(group.placed.item);
            group.value.textContent = figure === null ? '' : this.format(figure);
            group.value.dataset.tone = toneOf(figure);
            const name = group.placed.item.label;
            group.el.setAttribute('aria-label', figure === null ? name : `${name} ${this.format(figure)}`);
        }
        if (this.legend) {
            this.legend.low.textContent = domain > 0 ? this.format(-domain) : '';
            this.legend.high.textContent = domain > 0 ? this.format(domain) : '';
        }
        const shown = this.tipFor !== null ? this.tiles.get(this.tipFor) : undefined;
        if (shown) this.showTipFor(shown);
        else this.hideTip();
    }

    private choose(view: TileView): void {
        this.props.onSelect?.(view.placed.item, view.placed.path);
    }

    private tipContent(view: TileView): string | Node | null {
        const { item, path } = view.placed;
        if (this.props.tip === false) return null;
        if (this.props.tip) return this.props.tip(item, path);
        const value = this.valueOf(item);
        return h(
            'div',
            {},
            h('div', {}, h('b', { text: item.label }), value === null ? null : h('span', { text: ` ${this.format(value)}`, data: { tone: toneOf(value) } })),
            path.length > 0 ? h('small', { text: path.map((g) => g.label).join(' › ') }) : null,
        );
    }

    private showTipFor(view: TileView): void {
        const content = this.tipContent(view);
        if (content === null) return;
        this.tipFor = view.placed.item.id;
        const { x, y, w, h: ht } = view.placed;
        showTip(this.tip, content, { w: this.el.clientWidth, h: this.el.clientHeight }, this.map.offsetLeft + x + w / 2, this.map.offsetTop + y + ht / 2);
    }

    private hideTip(): void {
        this.tipFor = null;
        this.tip.hidden = true;
    }

    /** Arrows move to the nearest tile that way, Home and End to the first and the last. */
    private onKey(e: KeyboardEvent): void {
        const from = this.current !== null ? this.tiles.get(this.current) : undefined;
        if (!from || !(e.target instanceof HTMLElement) || e.target.dataset.slot !== treemapDef.slot('tile')) return;
        const list = [...this.tiles.values()];
        let next: TileView | undefined;
        if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
        else {
            const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
            if (!dir) return;
            const cx = from.placed.x + from.placed.w / 2;
            const cy = from.placed.y + from.placed.h / 2;
            let best = Infinity;
            for (const tile of list) {
                if (tile === from) continue;
                const dx = tile.placed.x + tile.placed.w / 2 - cx;
                const dy = tile.placed.y + tile.placed.h / 2 - cy;
                const along = dx * dir[0]! + dy * dir[1]!;
                if (along <= 0) continue;
                const across = Math.abs(dx * dir[1]! - dy * dir[0]!);
                const score = along + across * 2;
                if (score < best) {
                    best = score;
                    next = tile;
                }
            }
        }
        if (!next) return;
        e.preventDefault();
        next.el.focus();
    }
}

function position(el: HTMLElement, box: TreemapRect): void {
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
}

export function createTreemap(props: TreemapProps = {}): TreemapHandle {
    return new TreemapImpl(props);
}
