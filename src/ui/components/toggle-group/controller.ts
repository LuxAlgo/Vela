// ToggleGroup CONTROLLER — a few options shown side by side. `single`: one is always chosen
// (a radio group, a segmented control). `multiple`: each option toggles on its own. Holds
// the value, keyboard moves, and the attributes of the group and each option. No DOM.
import { rovingMove, rovingTarget, type PartProps } from '../../headless';

export interface ToggleGroupItem {
    id: string;
    /** Visible text, or the accessible name of an icon-only option. */
    label: string;
    icon?: string;
    disabled?: boolean;
}

interface ToggleGroupCommonOptions {
    items: readonly ToggleGroupItem[];
    /** Accessible name of the group. */
    label?: string;
    /** Options show their icon only; each label becomes its option's accessible name. */
    iconOnly?: boolean;
    dir?: 'ltr' | 'rtl';
}

export interface ToggleGroupSingleOptions extends ToggleGroupCommonOptions {
    type?: 'single';
    /** The chosen option (default: the first enabled one). */
    value?: string;
    onChange?: (value: string) => void;
}

export interface ToggleGroupMultipleOptions extends ToggleGroupCommonOptions {
    type: 'multiple';
    /** The options turned on (default: none). */
    value?: readonly string[];
    onChange?: (value: string[]) => void;
}

export type ToggleGroupControllerOptions = ToggleGroupSingleOptions | ToggleGroupMultipleOptions;

export interface ToggleGroupController {
    readonly type: 'single' | 'multiple';
    readonly items: readonly ToggleGroupItem[];
    /** The options turned on (one at most for `single`). */
    readonly values: readonly string[];
    isOn(id: string): boolean;
    /** A press on an option: `single` chooses it, `multiple` flips it. Notifies `onChange`
     *  when the value changed; false for an unknown or disabled option. */
    toggle(id: string): boolean;
    /** Show options as on without notifying (a string or null for `single`). */
    setValue(value: string | readonly string[] | null): void;
    setItems(items: readonly ToggleGroupItem[]): void;
    /** The option an arrow key moves focus to from `from` (null: not a navigation key). */
    focusTarget(from: string | null, key: string): string | null;
    rootProps(): PartProps;
    itemProps(id: string): PartProps;
}

export function toggleGroupController(opts: ToggleGroupControllerOptions): ToggleGroupController {
    const type = opts.type ?? 'single';
    let items = [...opts.items];
    const firstEnabled = (): string | null => items.find((i) => !i.disabled)?.id ?? null;
    const initial = opts.type === 'multiple' ? [...(opts.value ?? [])] : [opts.value ?? firstEnabled()].filter((v): v is string => v !== null);
    let values: string[] = initial;
    const notify = (): void => {
        if (opts.type === 'multiple') opts.onChange?.([...values]);
        else if (values[0] !== undefined) opts.onChange?.(values[0]);
    };
    /** The option that holds the group's one tab stop. */
    const tabStop = (): string | null => items.find((i) => !i.disabled && values.includes(i.id))?.id ?? firstEnabled();
    return {
        type,
        get items() {
            return items;
        },
        get values() {
            return values;
        },
        isOn: (id) => values.includes(id),
        toggle(id) {
            const item = items.find((i) => i.id === id);
            if (!item || item.disabled) return false;
            if (type === 'single') {
                if (values[0] === id) return true;
                values = [id];
            } else {
                values = values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
            }
            notify();
            return true;
        },
        setValue(value) {
            values = value === null ? [] : typeof value === 'string' ? [value] : [...value];
        },
        setItems(next) {
            items = [...next];
            values = values.filter((v) => items.some((i) => i.id === v));
            if (type === 'single' && values.length === 0) values = [firstEnabled()].filter((v): v is string => v !== null);
        },
        focusTarget(from, key) {
            const move = rovingMove(key, 'horizontal', opts.dir);
            return move ? rovingTarget(items, from, move) : null;
        },
        rootProps: () => ({
            role: type === 'single' ? 'radiogroup' : 'group',
            'data-slot': 'toggle-group',
            'data-type': type,
            'aria-label': opts.label,
        }),
        itemProps(id) {
            const item = items.find((i) => i.id === id);
            const on = values.includes(id);
            return {
                type: 'button',
                role: type === 'single' ? 'radio' : undefined,
                'data-slot': 'toggle-group-item',
                'aria-checked': type === 'single' ? String(on) : undefined,
                'aria-pressed': type === 'multiple' ? String(on) : undefined,
                'aria-label': opts.iconOnly ? item?.label : undefined,
                'aria-disabled': item?.disabled ? 'true' : undefined,
                tabindex: id === tabStop() ? 0 : -1,
                'data-state': on ? 'on' : 'off',
                'data-disabled': item?.disabled === true,
            };
        },
    };
}
