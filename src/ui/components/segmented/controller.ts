// Segmented CONTROLLER — one choice among a few options shown side by side (a radio group):
// the chosen value, keyboard moves, and the attributes of the group and each option. No DOM.
import { rovingMove, rovingTarget, type PartProps } from '../../headless';

export interface SegmentedItem {
    id: string;
    /** Visible text, or the accessible name of an icon-only option. */
    label: string;
    icon?: string;
    disabled?: boolean;
}

export interface SegmentedControllerOptions {
    items: readonly SegmentedItem[];
    value?: string;
    /** Accessible name of the group. */
    label?: string;
    /** Options show their icon only; each label becomes its option's accessible name. */
    iconOnly?: boolean;
    dir?: 'ltr' | 'rtl';
    onChange?: (id: string) => void;
}

export interface SegmentedController {
    readonly items: readonly SegmentedItem[];
    readonly value: string | null;
    /** Choose an option; notifies `onChange` when the value changed. False for an unknown or disabled option. */
    select(id: string): boolean;
    /** Show an option as chosen without notifying. */
    setValue(id: string | null): void;
    setItems(items: readonly SegmentedItem[]): void;
    /** The option an arrow key moves to from `from` (null: not a navigation key). */
    focusTarget(from: string | null, key: string): string | null;
    rootProps(): PartProps;
    itemProps(id: string): PartProps;
}

export function segmentedController(opts: SegmentedControllerOptions): SegmentedController {
    let items = [...opts.items];
    let value: string | null = opts.value ?? items.find((i) => !i.disabled)?.id ?? null;
    return {
        get items() {
            return items;
        },
        get value() {
            return value;
        },
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
            if (value !== null && !items.some((i) => i.id === value)) value = items.find((i) => !i.disabled)?.id ?? null;
        },
        focusTarget(from, key) {
            const move = rovingMove(key, 'horizontal', opts.dir);
            return move ? rovingTarget(items, from, move) : null;
        },
        rootProps: () => ({ role: 'radiogroup', 'aria-label': opts.label }),
        itemProps(id) {
            const item = items.find((i) => i.id === id);
            const checked = id === value;
            return {
                role: 'radio',
                type: 'button',
                'aria-checked': String(checked),
                'aria-label': opts.iconOnly ? item?.label : undefined,
                'aria-disabled': item?.disabled ? 'true' : undefined,
                tabindex: checked ? 0 : -1,
                'data-state': checked ? 'on' : 'off',
                'data-disabled': item?.disabled === true,
            };
        },
    };
}
