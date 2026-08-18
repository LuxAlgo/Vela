// Menu CONTROLLER — Zag menu machine + Vela's descriptor mapping. Items are DATA
// descriptors (the plugin contribution currency): any view layer projects them.
import * as menu from '@zag-js/menu';
import { nextUid, normalizeProps } from '../../zag';

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
    /** Icon id (see the `vela/ui` icon registry) rendered before the label. */
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

export interface MenuControllerOptions {
    items: readonly MenuItemDescriptor[];
    onSelect?: (id: string) => void;
    placement?: menu.Props['positioning'] extends infer P | undefined
        ? P extends { placement?: infer PL }
            ? PL
            : never
        : never;
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

export type MenuService = menu.Service;
export type MenuApi = menu.Api;

export interface MenuController {
    machine: typeof menu.machine;
    props: Partial<menu.Props>;
    connect(service: MenuService): MenuApi;
}

export function menuController(opts: MenuControllerOptions): MenuController {
    return {
        machine: menu.machine,
        props: {
            id: opts.id ?? nextUid('vela-menu'),
            ids: opts.triggerId ? { trigger: opts.triggerId } : undefined,
            positioning: {
                placement: opts.placement ?? 'bottom-start',
                ...(opts.getAnchorRect ? { getAnchorRect: () => opts.getAnchorRect!() } : {}),
            },
            onSelect: (d: menu.SelectionDetails) => opts.onSelect?.(d.value),
            onOpenChange: (d: menu.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<menu.Props>,
        connect: (service: MenuService): MenuApi => menu.connect(service, normalizeProps),
    };
}
