// Tabs CONTROLLER — Zag's tabs machine (WAI-ARIA tabs: roving focus, arrow keys along the
// orientation, Home/End, automatic or manual activation), mapped from Vela's options.
// No DOM.
import * as tabs from '@zag-js/tabs';
import { nextUid, normalizeProps } from '../../zag';

export interface TabItem {
    id: string;
    label: string;
    disabled?: boolean;
    /** Out of the strip for now (its content does not apply); the arrow keys skip it. */
    hidden?: boolean;
}

export interface TabsControllerOptions {
    items: readonly TabItem[];
    /** The selected tab (default: the first available one). */
    value?: string;
    orientation?: 'horizontal' | 'vertical';
    /** `automatic` (default): moving focus with the arrow keys selects. `manual`: Enter or
     *  Space selects the focused tab. */
    activationMode?: 'automatic' | 'manual';
    /** The tabs control panels the caller renders (`aria-controls` / `tabpanel`). Off for a
     *  strip that filters one view (default false). */
    panels?: boolean;
    /** The text direction the arrow keys follow (default `ltr`). */
    dir?: 'ltr' | 'rtl';
    onChange?: (id: string) => void;
}

export interface TabsController {
    machine: typeof tabs.machine;
    props: Partial<tabs.Props>;
    connect(service: tabs.Service): tabs.Api;
}

/** A tab a user can reach: neither disabled nor hidden. */
export const tabAvailable = (item: TabItem): boolean => !item.disabled && !item.hidden;

export function tabsController(opts: TabsControllerOptions): TabsController {
    return {
        machine: tabs.machine,
        props: {
            id: nextUid('vela-tabs'),
            defaultValue: opts.value ?? opts.items.find(tabAvailable)?.id ?? null,
            orientation: opts.orientation ?? 'horizontal',
            activationMode: opts.activationMode ?? 'automatic',
            dir: opts.dir ?? 'ltr',
            loopFocus: true,
            onValueChange: ({ value }) => opts.onChange?.(value),
        },
        connect: (service) => tabs.connect(service, normalizeProps),
    };
}
