// Tabs CONTROLLER — the selected tab, keyboard moves between tabs, and the attributes of
// the list, each tab and each panel (WAI-ARIA tabs). No DOM.
import { nextPartId, rovingMove, rovingTarget, type PartProps } from '../../headless';

export interface TabItem {
    id: string;
    label: string;
    disabled?: boolean;
}

export interface TabsControllerOptions {
    items: readonly TabItem[];
    /** The selected tab (default: the first enabled one). */
    value?: string;
    orientation?: 'horizontal' | 'vertical';
    /** `automatic` (default): moving focus with the arrow keys selects. `manual`: Enter or
     *  Space selects the focused tab. */
    activation?: 'automatic' | 'manual';
    /** The tabs control panels the caller renders (`aria-controls` / `tabpanel`). Off for a
     *  strip that filters one view (default false). */
    panels?: boolean;
    /** The text direction the arrow keys follow (default `ltr`). */
    dir?: 'ltr' | 'rtl';
    onChange?: (id: string) => void;
}

export interface TabsController {
    readonly items: readonly TabItem[];
    readonly value: string | null;
    readonly orientation: 'horizontal' | 'vertical';
    readonly activation: 'automatic' | 'manual';
    /** Select a tab; notifies `onChange` when the selection changed. False for an unknown or disabled tab. */
    select(id: string): boolean;
    /** Show a tab as selected without notifying (a host restoring its own state). */
    setValue(id: string | null): void;
    setItems(items: readonly TabItem[]): void;
    /** The tab a key moves focus to from `from` (null: not a navigation key, or nothing to reach). */
    focusTarget(from: string | null, key: string): string | null;
    listProps(): PartProps;
    tabProps(id: string): PartProps;
    panelProps(id: string): PartProps;
}

export function tabsController(opts: TabsControllerOptions): TabsController {
    let items = [...opts.items];
    const firstEnabled = (): string | null => items.find((i) => !i.disabled)?.id ?? null;
    let value: string | null = opts.value ?? firstEnabled();
    const orientation = opts.orientation ?? 'horizontal';
    const activation = opts.activation ?? 'automatic';
    const uid = nextPartId('vela-tabs');
    const tabId = (id: string): string => `${uid}-tab-${id}`;
    const panelId = (id: string): string => `${uid}-panel-${id}`;
    return {
        get items() {
            return items;
        },
        get value() {
            return value;
        },
        orientation,
        activation,
        select(id) {
            const item = items.find((i) => i.id === id);
            if (!item || item.disabled) return false;
            if (value === id) return true;
            value = id;
            opts.onChange?.(id);
            return true;
        },
        setValue(id) {
            value = id;
        },
        setItems(next) {
            items = [...next];
            if (value !== null && !items.some((i) => i.id === value)) value = firstEnabled();
        },
        focusTarget(from, key) {
            const move = rovingMove(key, orientation, opts.dir);
            return move ? rovingTarget(items, from, move) : null;
        },
        listProps: () => ({ role: 'tablist', 'aria-orientation': orientation, 'data-orientation': orientation }),
        tabProps(id) {
            const item = items.find((i) => i.id === id);
            const selected = id === value;
            return {
                role: 'tab',
                type: 'button',
                id: tabId(id),
                'aria-selected': String(selected),
                'aria-controls': opts.panels ? panelId(id) : undefined,
                'aria-disabled': item?.disabled ? 'true' : undefined,
                tabindex: selected ? 0 : -1,
                'data-state': selected ? 'active' : 'inactive',
                'data-orientation': orientation,
                'data-disabled': item?.disabled === true,
            };
        },
        panelProps(id) {
            const selected = id === value;
            return {
                role: 'tabpanel',
                id: panelId(id),
                'aria-labelledby': tabId(id),
                tabindex: 0,
                'data-state': selected ? 'active' : 'inactive',
                hidden: !selected,
            };
        },
    };
}
