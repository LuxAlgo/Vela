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
    /** Checkmark state for toggle items (undefined = plain item). */
    checked?: boolean;
    /** Render as a SWITCH row (a right-aligned toggle pill reflecting `checked`)
     *  instead of the accent checkmark, and keep the menu OPEN on selection —
     *  the shape for boolean settings living inside a dropdown. */
    toggle?: boolean;
    /** Icon id (see the `vela/ui` icon registry) rendered before the label. */
    icon?: string;
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
    /** Share the trigger's DOM id with other machines composed on the same element. */
    triggerId?: string;
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
            id: nextUid('vela-menu'),
            ids: opts.triggerId ? { trigger: opts.triggerId } : undefined,
            positioning: { placement: opts.placement ?? 'bottom-start' },
            onSelect: (d: menu.SelectionDetails) => opts.onSelect?.(d.value),
            onOpenChange: (d: menu.OpenChangeDetails) => opts.onOpenChange?.(d.open),
        } satisfies Partial<menu.Props>,
        connect: (service: MenuService): MenuApi => menu.connect(service, normalizeProps),
    };
}
