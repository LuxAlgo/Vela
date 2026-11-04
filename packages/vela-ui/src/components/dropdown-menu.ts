// DropdownMenu: MenuItemDescriptor[] projected into a floating list over Zag's menu machine
// (keyboard navigation, typeahead and dismissal belong to the machine). Items are data
// descriptors, the plugin contribution currency. An item carrying `submenu` becomes a
// trigger row owning a nested machine and list, registered as this machine's child: Zag
// drives hover intent, arrow-key traversal and the dismiss chain across levels.
import * as zagMenu from '@zag-js/menu';
import { msg } from '../lib/i18n';
import { textOf } from '../lib/i18n';
import type { Translator } from '../lib/i18n';
import { iconEl } from '../lib/icons';
import { kitTranslator } from '../lib/kit-text';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { addSlot } from '../lib/h';
import { t } from '../lib/t';
import { announceSurface } from '../lib/surface-events';
import { holdForExit, type SurfaceExit } from '../lib/surface-exit';
import { floatingLayerHost } from '../lib/theme';
import { nextUid, normalizeProps, runMachine, spreadProps, type HandleOf } from '../lib/zag';
import { splitPlacement, zagPositioning, type PlacementProps } from '../lib/placement';

/** One menu entry. `id` is the selection value reported to `onSelect`. */
export interface MenuItemDescriptor {
    id: string;
    label: string;
    disabled?: boolean;
    /** Draw a separator line above this item. */
    separatorBefore?: boolean;
    /** Right-aligned hint (e.g. a shortcut display from KeymapManager). */
    hint?: string;
    /** Selected state (undefined = plain item). A plain checked item renders as a
     *  highlighted row (brighter surface + bright ink) — or, in a menu built with
     *  `checkmarks`, as a leading ✓ with the row surface left free for hover. */
    checked?: boolean;
    /** Render as a SWITCH row (a right-aligned toggle pill reflecting `checked`)
     *  instead of the selected-row highlight, and keep the menu OPEN on selection —
     *  the shape for boolean settings living inside a dropdown. */
    toggle?: boolean;
    /** Icon id (see the `vela/ui` icon registry) rendered before the label. A level where
     *  any row has one gives its iconless rows an empty slot, so the labels align. */
    icon?: string;
    /** Favorite-star affordance at the row's right edge: `false` renders an outline
     *  star revealed on row hover, `true` a filled star that stays visible. Clicking
     *  it reports through the menu's `onFavorite` WITHOUT selecting (or closing) the
     *  row — undefined rows carry no star at all. */
    favorite?: boolean;
    /** Nested entries — the row becomes a submenu trigger opening its own list to the side.
     *  A branch is not selectable itself: `onSelect` only ever reports leaf ids. */
    submenu?: readonly MenuItemDescriptor[];
}

export interface DropdownMenuControllerOptions extends PlacementProps {
    items: readonly MenuItemDescriptor[];
    onSelect?: (id: string) => void;
    /** @deprecated Use `side` and `align`. */
    placement?: zagMenu.Props['positioning'] extends infer P | undefined ? (P extends { placement?: infer PL } ? PL : never) : never;
    onOpenChange?: (open: boolean) => void;
    /** Pin the floating list to this rect (viewport coords). Used to keep an open
     *  menu still when its trigger moves — starring a timeframe adds a chip and
     *  would otherwise drag the list with the caret. `null` falls through to the
     *  live trigger. */
    getAnchorRect?: () => { x: number; y: number; width: number; height: number } | null;
    /** Share the trigger's DOM id with other machines composed on the same element. */
    triggerId?: string;
    /** Pin the machine's own id instead of taking a fresh one. A parent registers its
     *  submenus under this key, so rebuilding a branch replaces its entry rather than
     *  piling a new one on top. */
    id?: string;
}

export type DropdownMenuService = zagMenu.Service;
export type DropdownMenuApi = zagMenu.Api;

export interface DropdownMenuController {
    machine: typeof zagMenu.machine;
    props: Partial<zagMenu.Props>;
    connect(service: DropdownMenuService): DropdownMenuApi;
}

/** Zag's menu machine with the options mapped onto it, for any view layer. */
export function dropdownMenuController(opts: DropdownMenuControllerOptions): DropdownMenuController {
    return {
        machine: zagMenu.machine,
        props: {
            id: opts.id ?? nextUid('vela-menu'),
            ids: opts.triggerId ? { trigger: opts.triggerId } : undefined,
            positioning: {
                ...zagPositioning(opts, opts.placement ? splitPlacement(opts.placement) : { side: 'bottom', align: 'start' }),
                ...(opts.getAnchorRect ? { getAnchorRect: () => opts.getAnchorRect!() } : {}),
            },
            onSelect: (d: zagMenu.SelectionDetails) => opts.onSelect?.(d.value),
            onOpenChange: (d: zagMenu.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<zagMenu.Props>,
        connect: (service: DropdownMenuService): DropdownMenuApi => zagMenu.connect(service, normalizeProps),
    };
}

export const dropdownMenuDef = defineComponent({
    name: 'dropdown-menu',
    parts: ['content', 'item', 'icon', 'label', 'hint', 'mark', 'badge', 'star', 'switch', 'arrow', 'separator'],
    settings: { radius: t.radius.md, 'switch-radius': '9px' },
});

const injectStyles = defineStyles(
    'vela-ui-menu',
    css`
        @layer vela.ui {
            [data-slot~='dropdown-menu-content'] {
                /* The list is a <ul>: without this, block rows (the separator) paint a ::marker dot. */
                list-style: none;
                margin: 0;
                background: ${t.surface};
                color: ${t.fg};
                border: 1px solid ${t.border.strong};
                border-radius: ${dropdownMenuDef.vars.radius};
                box-shadow: ${t.shadow};
                padding: 6px;
                min-width: 180px;
                /* Never past the room its clipping container leaves on the side it opened on
                   (Zag measures it onto the positioner): a menu in a short chart scrolls inside
                   itself instead of overflowing the chart and scrolling the page around it. */
                max-height: min(60vh, var(--available-height, 60vh));
                overflow-y: auto;
                font-size: 13px;
                z-index: ${t.z.menu};
                outline: 2px solid transparent;

                &[data-state='open'] {
                    animation: vela-menu-in ${t.dur.fast} ${t.ease};
                }
            }
            @keyframes vela-menu-in {
                from {
                    opacity: 0;
                    transform: translateY(-3px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            [data-slot~='dropdown-menu-item'] {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 7px 10px;
                border-radius: ${t.radius.sm};
                cursor: pointer;
                user-select: none;
                white-space: nowrap;

                &[data-highlighted] {
                    background: ${t.hover};
                }
                &[data-disabled] {
                    opacity: 0.4;
                    cursor: default;
                }
                & [data-slot~='dropdown-menu-icon'] {
                    width: 16px;
                    height: 16px;
                    font-size: 16px;
                    justify-content: center;
                    color: ${t.fg.muted};
                }
                & [data-slot~='dropdown-menu-label'] {
                    flex: 1 1 auto;
                }
                & [data-slot~='dropdown-menu-hint'] {
                    color: ${t.fg.faint};
                    font-size: ${t.fontSize.sm};
                }
                /* The active entry: the row surface carries the selection, a stronger wash
                   than the hover one plus bright ink. After the hover rule, so a selected row
                   stays visibly selected while highlighted. */
                &[data-checked] {
                    background: ${t.hover.strong};
                    color: ${t.fg.bright};
                }
                /* Checkmark mode (context and action menus): every row reserves the leading
                   mark column so labels align; a checked row fills it with a ✓ and brightens
                   its ink, leaving the row surface free for the hover wash. */
                & [data-slot~='dropdown-menu-mark'] {
                    width: 14px;
                    flex: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                & [data-slot~='dropdown-menu-mark'] [data-slot~='dropdown-menu-icon'] {
                    width: 14px;
                    height: 14px;
                    font-size: 14px;
                    color: ${t.fg.bright};
                }
                &[data-checkmark] {
                    color: ${t.fg.bright};
                }
                /* Badge mode: the row icon sits in a rounded tile and the row grows to fit it.
                   An icon-less row of the same level keeps an invisible slot, so labels align. */
                & [data-slot~='dropdown-menu-badge'] {
                    width: 24px;
                    height: 24px;
                    padding: 3px;
                    flex: none;
                    box-sizing: border-box;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: ${t.radius.md};
                    background: ${t.hover};
                    border: 1px solid ${t.border};
                    color: ${t.fg.muted};
                    transition:
                        background ${t.dur.fast} ${t.ease},
                        border-color ${t.dur.fast} ${t.ease},
                        color ${t.dur.fast} ${t.ease};
                }
                & [data-slot~='dropdown-menu-badge']:empty {
                    background: transparent;
                    border-color: transparent;
                }
                & [data-slot~='dropdown-menu-badge'] [data-slot~='dropdown-menu-icon'] {
                    color: inherit;
                }
                &[data-highlighted] [data-slot~='dropdown-menu-badge']:not(:empty) {
                    color: ${t.fg.bright};
                }
                /* The selected tile inverts: a bright fill under the surface-colored glyph.
                   After the hover rule, so a selected row keeps its tile while highlighted. */
                &[data-checked] [data-slot~='dropdown-menu-badge']:not(:empty),
                &[data-checkmark] [data-slot~='dropdown-menu-badge']:not(:empty) {
                    background: color-mix(in srgb, ${t.fg.bright} 83%, ${t.surface});
                    border-color: color-mix(in srgb, ${t.fg.bright} 40%, transparent);
                    color: ${t.surface};
                }
                /* The favorite star: reserved space always (it fades in on row hover instead
                   of shifting the layout), and a starred row keeps its filled star visible. */
                & [data-slot~='dropdown-menu-star'] {
                    order: 98;
                    /* Pad the 16px icon slot into a bigger hit target without moving the row's
                       layout: the box is the icon plus its padding. */
                    width: 26px;
                    height: 22px;
                    margin-block: -3px;
                    margin-inline: 0 -5px;
                    padding: 3px 5px;
                    border-radius: ${t.radius.sm};
                    opacity: 0;
                    transition:
                        opacity ${t.dur.fast} ease,
                        background ${t.dur.fast} ease;
                }
                &[data-highlighted] [data-slot~='dropdown-menu-star'] {
                    opacity: 0.55;
                }
                & [data-slot~='dropdown-menu-star']:hover {
                    opacity: 1;
                    background: ${t.hover.strong};
                }
                & [data-slot~='dropdown-menu-star'][data-fav] {
                    opacity: 0.95;
                    color: ${t.highlight};
                }
                /* A submenu trigger row: a chevron at the end, and the row stays highlighted
                   while its own list is open, so the path you came down remains readable. */
                & [data-slot~='dropdown-menu-arrow'] {
                    order: 99;
                    margin-inline-start: auto;
                    width: 12px;
                    flex: none;
                    font-size: 11px;
                    color: ${t.fg.faint};
                }
                &[data-state='open'] {
                    background: ${t.hover};
                }
            }
            [data-slot~='dropdown-menu-content'][data-badges] > [data-slot~='dropdown-menu-item'] {
                padding-block: 5px;
                padding-inline: 6px 10px;
            }
            /* Switch rows (boolean settings in a dropdown): a toggle pill at the row's end,
               the same control language as the settings dialog's toggles. */
            [data-slot~='dropdown-menu-switch'] {
                order: 99;
                margin-inline-start: auto;
                position: relative;
                flex: none;
                width: 34px;
                height: 18px;
                border-radius: ${dropdownMenuDef.vars['switch-radius']};
                background: ${t.surface.overlay};
                border: 1px solid ${t.border.soft};
                transition:
                    background ${t.dur.med} ease,
                    border-color ${t.dur.med} ease;

                &::after {
                    content: '';
                    position: absolute;
                    top: 2px;
                    inset-inline-start: 2px;
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: ${t.fg.muted};
                    transition:
                        transform ${t.dur.med} ease,
                        background ${t.dur.med} ease;
                }
                &[data-on] {
                    background: var(${t.accent.bright.name}, ${t.accent});
                    border-color: var(${t.accent.bright.name}, ${t.accent});
                }
                &[data-on]::after {
                    transform: translateX(16px);
                    background: ${t.bg};
                }
            }
            [data-slot~='dropdown-menu-separator'] {
                height: 1px;
                margin: 4px 6px;
                background: ${t.border};
            }
        }
    `,
);

/** An icon in a menu row, carrying the row icon part. */
function menuIcon(id: string, doc: Document): HTMLElement {
    const el = iconEl(id, doc);
    el.dataset.slot = dropdownMenuDef.slot('icon');
    return el;
}

const TEXT = {
    addFavorite: msg('ui.menu.addFavorite', 'Add to favorites'),
    removeFavorite: msg('ui.menu.removeFavorite', 'Remove from favorites'),
};

export type DropdownMenuProps = DropdownMenuOptions;

export interface DropdownMenuOptions extends DropdownMenuControllerOptions {
    /** Element that opens the menu on click (gets the machine's trigger props). */
    trigger?: HTMLElement;
    host?: HTMLElement;
    /** Override the root list's min-width (the stylesheet default suits full-word labels;
     *  compact lists like the timeframe dropdown pass something snug). Submenus keep the
     *  default. */
    minWidth?: string;
    /** Star-toggle reports from items carrying `favorite` (the menu stays open — starring
     *  is a side action on a row, never a selection). */
    onFavorite?: (id: string, on: boolean) => void;
    /** Mark checked items with a leading ✓ instead of the selected-row background wash —
     *  the shape for pointer-anchored action menus (right-click context menus), where a
     *  washed row reads as hover state. A level holding checkable rows reserves the mark
     *  column on all its rows so labels align; an all-action level keeps its natural left
     *  edge. Submenus inherit the mode. Dropdown menus (a trigger button opening a
     *  picker) keep the default wash. */
    checkmarks?: boolean;
    /** Sit each row's icon in a squared badge (a 24px rounded tile with a faint fill and a soft
     *  border) instead of a bare glyph: its glyph brightens on a hovered row, and the tile
     *  inverts on the selected one. A
     *  level where some rows carry an icon reserves the badge column on all its rows so
     *  labels align; a level with no icon keeps its natural left edge. With `checkmarks`,
     *  the mark column leads and the badge follows. Submenus inherit the mode. */
    iconBadges?: boolean;
    /** The translator of the menu's own words (a star's name). Default: the kit build's, else English. */
    i18n?: Translator | null;
}

/** Where a menu level opens: the shadcn props, or the deprecated `placement`. */
type MenuPlacement = PlacementProps & Pick<DropdownMenuControllerOptions, 'placement'>;

interface SurfaceOptions {
    host: HTMLElement;
    placement: MenuPlacement;
    onSelect: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
    trigger?: HTMLElement;
    /** A submenu's branch row — announced as its opener (it takes trigger-ITEM props, not `trigger`'s). */
    opener?: HTMLElement;
    triggerId?: string;
    id?: string;
    minWidth?: string;
    onFavorite?: (id: string, on: boolean) => void;
    checkmarks?: boolean;
    iconBadges?: boolean;
    i18n: Translator | null;
}

/**
 * One menu level: a Zag machine plus the floating list it projects onto. The root menu is a
 * surface and every branch spawns another, so nesting is depth-agnostic. Private — `Menu`
 * is the public face.
 */
class Surface {
    readonly list: HTMLElement;
    readonly handle: HandleOf<typeof zagMenu.machine>;
    private readonly positioner: HTMLElement;
    private readonly ctrl: DropdownMenuController;
    private readonly mid: string;
    private readonly doc: Document;
    private readonly host: HTMLElement;
    private readonly onSelect: (id: string) => void;
    private readonly onFavorite?: (id: string, on: boolean) => void;
    private readonly i18n: Translator | null;
    private readonly checkmarks: boolean;
    private readonly iconBadges: boolean;
    private items: readonly MenuItemDescriptor[] = [];
    /** Branch item id → the surface it opens. */
    private readonly subs = new Map<string, Surface>();
    /** Trigger rect captured when this level opened — the list stays put if the
     *  trigger then moves (favorite chips shifting the caret). */
    private pinnedAnchor: { x: number; y: number; width: number; height: number } | null = null;
    /** The open state last announced — see {@link announce}. */
    private shown = false;
    /** The list's exit animation after a close; a reopen cancels it. */
    private exit: SurfaceExit | null = null;
    private readonly opener: HTMLElement | null;

    constructor(doc: Document, opts: SurfaceOptions) {
        this.doc = doc;
        this.host = opts.host;
        this.onSelect = opts.onSelect;
        this.onFavorite = opts.onFavorite;
        this.i18n = opts.i18n;
        this.checkmarks = opts.checkmarks === true;
        this.iconBadges = opts.iconBadges === true;

        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-ui-layer';
        this.list = doc.createElement('ul');
        this.list.className = 'vela-menu';
        this.list.dataset.slot = dropdownMenuDef.slot('content');
        if (opts.minWidth) this.list.style.minWidth = opts.minWidth;
        this.positioner.appendChild(this.list);
        this.host.appendChild(this.positioner);

        const trigger = opts.trigger;
        this.opener = trigger ?? opts.opener ?? null;
        this.ctrl = dropdownMenuController({
            items: [],
            id: opts.id,
            ...opts.placement,
            onSelect: (id) => this.onSelect(id),
            getAnchorRect: () => this.pinnedAnchor,
            onOpenChange: (open) => {
                if (open && trigger) {
                    const r = trigger.getBoundingClientRect();
                    this.pinnedAnchor = { x: r.x, y: r.y, width: r.width, height: r.height };
                } else {
                    this.pinnedAnchor = null;
                }
                opts.onOpenChange?.(open);
            },
            triggerId: opts.triggerId,
        });
        this.mid = String(this.ctrl.props.id);
        if (opts.triggerId && trigger) trigger.id = opts.triggerId;
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            // Close announces while the list still shows, open once it does.
            const closing = this.shown && !api.open;
            if (closing) this.announce(false);
            if (api.open && this.exit) {
                this.exit.cancel();
                this.exit = null;
            }
            if (trigger) spreadProps(trigger, api.getTriggerProps(), this.mid);
            spreadProps(this.positioner, api.getPositionerProps(), this.mid);
            spreadProps(this.list, api.getContentProps(), this.mid);
            this.project(api);
            if (closing) this.holdExit();
            if (api.open && !this.shown) this.announce(true);
        });
    }

    /** Keep the just-closed list up through its exit animation. `spreadProps` re-applies
     *  `hidden` only when the machine's value for it changes, so the list stays shown until
     *  the exit ends — or until a reopen, which projects `hidden: false` itself. */
    private holdExit(): void {
        this.list.hidden = false;
        this.exit = holdForExit(this.list, () => {
            this.exit = null;
            if (!this.shown) this.list.hidden = true;
        });
    }

    get api(): zagMenu.Api {
        return this.ctrl.connect(this.handle.service);
    }

    private announce(open: boolean): void {
        this.shown = open;
        announceSurface(this.list, open, 'menu', this.opener);
    }

    setItems(items: readonly MenuItemDescriptor[]): void {
        this.items = items;
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        this.build();
        const api = this.api;
        for (const sub of this.subs.values()) {
            api.setChild(sub.handle.service);
            sub.api.setParent(this.handle.service);
        }
        this.handle.flush();
        // Those two are queued sends: a child only learns it IS a submenu on the next
        // microtask, and a branch row's props (hover intent, the trigger-item part) are
        // derived from that. Re-project once the queue has drained.
        if (this.subs.size > 0) queueMicrotask(() => this.handle.flush());
    }

    destroy(): void {
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        this.exit?.finish();
        this.handle.stop();
        // Torn down while open: the stopped machine never projects the close.
        if (this.shown) this.announce(false);
        this.positioner.remove();
    }

    private byId(id: string): MenuItemDescriptor | undefined {
        return this.items.find((i) => i.id === id);
    }

    /** Push the machine's item props onto the rendered rows. A branch takes the submenu
     *  trigger props, which carry the child's ids and hover handlers; a leaf takes plain ones. */
    private project(api: zagMenu.Api): void {
        for (const li of this.list.children) {
            const id = (li as HTMLElement).dataset.veiId;
            if (!id) continue;
            const sub = this.subs.get(id);
            if (sub) {
                spreadProps(li as HTMLElement, api.getTriggerItemProps(sub.api), this.mid);
                continue;
            }
            const item = this.byId(id);
            // Switch rows keep the menu OPEN on selection — flip, see, flip again.
            spreadProps(li as HTMLElement, api.getItemProps({ value: id, disabled: item?.disabled, closeOnSelect: item?.toggle ? false : undefined }), this.mid);
        }
    }

    private build(): void {
        const doc = this.doc;
        this.list.replaceChildren();
        // Reserve the leading mark column only when THIS level actually holds checkable
        // rows — an all-action list (e.g. the chart-body context menu) keeps its natural
        // left edge instead of carrying an empty gutter.
        const markable = this.checkmarks
            && this.items.some((i) => !(i.submenu && i.submenu.length > 0) && !i.toggle && i.checked !== undefined);
        // Same for icons: once a row of this level carries one, the others keep an empty
        // icon slot (an empty badge in badge mode) so every label shares one left edge.
        const iconic = this.items.some((i) => !!i.icon);
        const badged = this.iconBadges && iconic;
        if (badged) this.list.dataset.badges = '1';
        else delete this.list.dataset.badges;
        for (const item of this.items) {
            if (item.separatorBefore) {
                const sep = doc.createElement('li');
                sep.className = 'vela-menu-sep';
                sep.dataset.slot = dropdownMenuDef.slot('separator');
                sep.setAttribute('role', 'separator');
                this.list.appendChild(sep);
            }
            const branch = item.submenu !== undefined && item.submenu.length > 0;
            const li = doc.createElement('li');
            li.className = 'vela-menu-item';
            li.dataset.slot = dropdownMenuDef.slot('item');
            li.dataset.veiId = item.id;
            if (item.toggle) {
                // Switch row: the pill carries the state.
                // (Zag owns the item's ARIA props; the pill below is decorative.)
                li.dataset.toggle = '1';
            }
            if (markable) {
                // Mark mode: a leading ✓ slot on every row of this level (empty when
                // unchecked, so labels share a left edge); the row surface stays free
                // for hover.
                const mark = doc.createElement('span');
                mark.className = 'vela-menu-mark';
                mark.dataset.slot = dropdownMenuDef.slot('mark');
                if (!branch && !item.toggle && item.checked) {
                    mark.appendChild(menuIcon('check', doc));
                    li.dataset.checkmark = '1';
                }
                li.appendChild(mark);
            } else if (!branch && !item.toggle && item.checked) {
                // Selection reads from the row surface: a stronger background wash
                // marks the active entry (hover stays the lighter wash).
                li.dataset.checked = '1';
            }
            if (badged) {
                const badge = doc.createElement('span');
                badge.className = 'vela-menu-badge';
                badge.dataset.slot = dropdownMenuDef.slot('badge');
                if (item.icon) badge.appendChild(menuIcon(item.icon, doc));
                li.appendChild(badge);
            } else if (item.icon) {
                li.appendChild(menuIcon(item.icon, doc));
            } else if (iconic) {
                li.appendChild(menuIcon('', doc));
            }
            const label = doc.createElement('span');
            label.className = 'vela-menu-label';
            label.dataset.slot = dropdownMenuDef.slot('label');
            label.textContent = item.label;
            li.appendChild(label);
            if (item.hint) {
                const hint = doc.createElement('span');
                hint.className = 'vela-menu-hint';
                hint.dataset.slot = dropdownMenuDef.slot('hint');
                hint.textContent = item.hint;
                li.appendChild(hint);
            }
            if (item.favorite !== undefined && this.onFavorite) {
                const on = item.favorite;
                const star = menuIcon(on ? 'star-filled' : 'star', doc);
                star.classList.add('vela-menu-star');
                addSlot(star, dropdownMenuDef.slot('star'));
                if (on) {
                    star.classList.add('vela-fav');
                    star.dataset.fav = '';
                }
                star.removeAttribute('aria-hidden'); // iconEl hides decorative icons; this one is a control
                star.setAttribute('role', 'button');
                star.setAttribute('aria-label', textOf(this.i18n, on ? TEXT.removeFavorite : TEXT.addFavorite));
                star.setAttribute('aria-pressed', on ? 'true' : 'false');
                // Swallow the whole pointer sequence: the machine selects rows on click,
                // and a press that starts on the star must never reach the row.
                for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const) {
                    star.addEventListener(ev, (e) => e.stopPropagation());
                }
                star.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.onFavorite?.(item.id, !on);
                });
                li.appendChild(star);
            }
            if (item.toggle) {
                const sw = doc.createElement('span');
                sw.className = 'vela-menu-switch' + (item.checked ? ' on' : '');
                sw.dataset.slot = dropdownMenuDef.slot('switch');
                if (item.checked) sw.dataset.on = '';
                sw.setAttribute('aria-hidden', 'true');
                li.appendChild(sw);
            }
            if (branch) {
                li.dataset.branch = '1';
                const arrow = menuIcon('chevron-right', doc);
                arrow.classList.add('vela-menu-arrow');
                addSlot(arrow, dropdownMenuDef.slot('arrow'));
                li.appendChild(arrow);
                const sub = new Surface(doc, {
                    host: this.host,
                    placement: { placement: 'right-start' },
                    opener: li,
                    onSelect: this.onSelect,
                    onFavorite: this.onFavorite,
                    i18n: this.i18n,
                    checkmarks: this.checkmarks,
                    iconBadges: this.iconBadges,
                    id: `${this.mid}--${item.id}`,
                });
                sub.setItems(item.submenu ?? []);
                this.subs.set(item.id, sub);
            }
            this.list.appendChild(li);
        }
    }
}

export class DropdownMenu {
    private readonly root: Surface;

    constructor(opts: DropdownMenuOptions) {
        const anchor = opts.trigger ?? opts.host ?? document.body;
        const doc = anchor.ownerDocument;
        injectStyles(doc);
        const host = floatingLayerHost(opts.host ?? anchor, doc.body);
        this.root = new Surface(doc, {
            host,
            placement: {
                placement: opts.placement,
                side: opts.side,
                align: opts.align,
                sideOffset: opts.sideOffset,
                alignOffset: opts.alignOffset,
                avoidCollisions: opts.avoidCollisions,
                collisionPadding: opts.collisionPadding,
                collisionBoundary: opts.collisionBoundary,
            },
            onSelect: (id) => opts.onSelect?.(id),
            onOpenChange: opts.onOpenChange,
            trigger: opts.trigger,
            triggerId: opts.triggerId,
            id: opts.id,
            minWidth: opts.minWidth,
            onFavorite: opts.onFavorite,
            i18n: opts.i18n ?? kitTranslator(),
            checkmarks: opts.checkmarks,
            iconBadges: opts.iconBadges,
        });
        this.root.setItems(opts.items);
    }

    get api(): zagMenu.Api {
        return this.root.api;
    }

    open(): void {
        this.api.setOpen(true);
    }

    /** Open anchored to a viewport point (context menus). */
    openAt(clientX: number, clientY: number): void {
        const api = this.api;
        api.setOpen(true);
        api.reposition({ getAnchorRect: () => ({ x: clientX, y: clientY, width: 0, height: 0 }) });
    }

    close(): void {
        this.api.setOpen(false);
    }

    /** Swap the item descriptors (e.g. checked states) and re-project. */
    setItems(items: readonly MenuItemDescriptor[]): void {
        this.root.setItems(items);
    }

    destroy(): void {
        this.root.destroy();
    }
}

export function createDropdownMenu(props: DropdownMenuProps): DropdownMenu {
    return new DropdownMenu(props);
}
