// The kit's earlier names for components renamed after shadcn's (Switch is a checkbox, a text
// field an input, a menu a dropdown menu), and the classes the button, badge, tabs and toggle
// group had before they became `create<Name>` functions. Kept for one release.
import { buttonVariants, createButton, type ButtonHandle, type ButtonProps, type ButtonSize, type ButtonVariant } from '@luxalgo/vela-ui/button';
import { createBadge, type BadgeHandle, type BadgeVariant } from '@luxalgo/vela-ui/badge';
import type { PartProps } from '@luxalgo/vela-ui/headless';
import { createTabs, type TabItem, type TabsHandle, type TabsVariant } from '@luxalgo/vela-ui/tabs';
import { createToggleGroup, type ToggleGroupHandle, type ToggleGroupItem } from '@luxalgo/vela-ui/toggle-group';
import {
    Checkbox,
    checkboxController,
    createCheckbox,
    type CheckboxController,
    type CheckboxControllerOptions,
    type CheckboxOptions,
    type CheckboxProps,
    type CheckboxSize,
    type CheckboxTone,
} from '@luxalgo/vela-ui/checkbox';
import {
    DropdownMenu,
    createDropdownMenu,
    dropdownMenuController,
    type DropdownMenuApi,
    type DropdownMenuController,
    type DropdownMenuControllerOptions,
    type DropdownMenuOptions,
    type DropdownMenuProps,
    type DropdownMenuService,
} from '@luxalgo/vela-ui/dropdown-menu';
import {
    Input,
    createInput,
    inputController,
    type InputController,
    type InputControllerOptions,
    type InputOptions,
    type InputProps,
    type InputSize,
} from '@luxalgo/vela-ui/input';

/** @deprecated Use `Checkbox`. */
export const Switch = Checkbox;
/** @deprecated Use `Checkbox`. */
export type Switch = Checkbox;
/** @deprecated Use `createCheckbox`. */
export const createSwitch = createCheckbox;
/** @deprecated Use `checkboxController`. */
export const switchController = checkboxController;
/** @deprecated Use `CheckboxOptions`. */
export type SwitchOptions = CheckboxOptions;
/** @deprecated Use `CheckboxProps`. */
export type SwitchProps = CheckboxProps;
/** @deprecated Use `CheckboxController`. */
export type SwitchController = CheckboxController;
/** @deprecated Use `CheckboxControllerOptions`. */
export type SwitchControllerOptions = CheckboxControllerOptions;
/** @deprecated Use `CheckboxSize`. */
export type SwitchSize = CheckboxSize;
/** @deprecated Use `CheckboxTone`. */
export type SwitchTone = CheckboxTone;

/** @deprecated Use `Input`. */
export const TextField = Input;
/** @deprecated Use `Input`. */
export type TextField = Input;
/** @deprecated Use `createInput`. */
export const createTextField = createInput;
/** @deprecated Use `inputController`. */
export const textFieldController = inputController;
/** @deprecated Use `InputOptions`. */
export type TextFieldOptions = InputOptions;
/** @deprecated Use `InputProps`. */
export type TextFieldProps = InputProps;
/** @deprecated Use `InputController`. */
export type TextFieldController = InputController;
/** @deprecated Use `InputControllerOptions`. */
export type TextFieldControllerOptions = InputControllerOptions;
/** @deprecated Use `InputSize`. */
export type TextFieldSize = InputSize;

/** @deprecated Use `DropdownMenu`. */
export const Menu = DropdownMenu;
/** @deprecated Use `DropdownMenu`. */
export type Menu = DropdownMenu;
/** @deprecated Use `createDropdownMenu`. */
export const createMenu = createDropdownMenu;
/** @deprecated Use `dropdownMenuController`. */
export const menuController = dropdownMenuController;
/** @deprecated Use `DropdownMenuOptions`. */
export type MenuOptions = DropdownMenuOptions;
/** @deprecated Use `DropdownMenuProps`. */
export type MenuProps = DropdownMenuProps;
/** @deprecated Use `DropdownMenuController`. */
export type MenuController = DropdownMenuController;
/** @deprecated Use `DropdownMenuControllerOptions`. */
export type MenuControllerOptions = DropdownMenuControllerOptions;
/** @deprecated Use `DropdownMenuService`. */
export type MenuService = DropdownMenuService;
/** @deprecated Use `DropdownMenuApi`. */
export type MenuApi = DropdownMenuApi;

/** @deprecated Use `ButtonProps`. */
export interface ButtonControllerOptions {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Accessible name; required for the `icon*` sizes. */
    label?: string;
    /** A toggle button's state (`aria-pressed`). Omitted: not a toggle. */
    pressed?: boolean;
    disabled?: boolean;
}
/** @deprecated Use `createButton`, whose handle holds the state. */
export interface ButtonController {
    readonly variant: ButtonVariant;
    readonly size: ButtonSize;
    readonly iconOnly: boolean;
    readonly pressed: boolean | undefined;
    readonly disabled: boolean;
    setPressed(pressed: boolean): void;
    setDisabled(disabled: boolean): void;
    setLabel(label: string): void;
    rootProps(): PartProps;
}
/** @deprecated Use `createButton`. */
export function buttonController(opts: ButtonControllerOptions = {}): ButtonController {
    let pressed = opts.pressed;
    let disabled = opts.disabled ?? false;
    let label = opts.label;
    const { variant, size } = buttonVariants.resolve(opts);
    const iconOnly = size.startsWith('icon');
    return {
        variant,
        size,
        iconOnly,
        get pressed() {
            return pressed;
        },
        get disabled() {
            return disabled;
        },
        setPressed: (v) => (pressed = v),
        setDisabled: (v) => (disabled = v),
        setLabel: (v) => (label = v),
        rootProps: () => ({
            type: 'button',
            'data-slot': 'button',
            ...buttonVariants({ variant, size }),
            'data-pressed': pressed === true,
            'aria-pressed': pressed === undefined ? undefined : String(pressed),
            'aria-label': iconOnly ? label : undefined,
            disabled,
        }),
    };
}
/** @deprecated Use `ButtonProps`. */
export type ButtonOptions = ButtonProps;
/** @deprecated Use `createButton`. */
export class Button {
    readonly el: HTMLButtonElement;
    private readonly handle: ButtonHandle;
    constructor(opts: ButtonOptions = {}) {
        this.handle = createButton(opts);
        this.el = this.handle.el;
    }
    get pressed(): boolean | undefined {
        return this.handle.pressed;
    }
    setPressed(pressed: boolean): void {
        this.handle.setPressed(pressed);
    }
    setDisabled(disabled: boolean): void {
        this.handle.setDisabled(disabled);
    }
    /** New text (or, for an `icon*` size, a new accessible name). */
    setText(text: string): void {
        this.handle.setText(text);
    }
}

/** @deprecated Use `BadgeProps`. */
export interface BadgeControllerOptions {
    variant?: BadgeVariant;
    /** A round count pill (`3`, `9+`) rather than a label. */
    count?: boolean;
}
/** @deprecated Use `createBadge`, whose handle holds the state. */
export interface BadgeController {
    readonly variant: BadgeVariant;
    setVariant(variant: BadgeVariant): void;
    rootProps(): PartProps;
}
/** @deprecated Use `createBadge`. */
export function badgeController(opts: BadgeControllerOptions = {}): BadgeController {
    let variant = opts.variant ?? 'default';
    return {
        get variant() {
            return variant;
        },
        setVariant: (v) => (variant = v),
        rootProps: () => ({ 'data-slot': 'badge', 'data-variant': variant, 'data-count': opts.count === true }),
    };
}
/** @deprecated Use `BadgeProps`. */
export interface BadgeOptions extends BadgeControllerOptions {
    text: string;
    className?: string;
}
/** @deprecated Use `createBadge`. */
export class Badge {
    readonly el: HTMLSpanElement;
    private readonly handle: BadgeHandle;
    constructor(opts: BadgeOptions) {
        this.handle = createBadge(opts);
        this.el = this.handle.el;
    }
    setText(text: string): void {
        this.handle.setText(text);
    }
    setVariant(variant: BadgeVariant): void {
        this.handle.setVariant(variant);
    }
}

/** An item as the deprecated `Tabs` and `ToggleGroup` take it: keyed by `id` (the kit's
 *  items carry `value`), or already in the kit's shape. */
type Keyed<T extends { value: string }> = T | (Omit<T, 'value'> & { id: string });

function withValue<T extends { value: string }>(item: Keyed<T>): T {
    if ('value' in item) return item;
    const { id, ...rest } = item;
    return { ...rest, value: id } as unknown as T;
}

/** A tab a user can reach: neither disabled nor hidden. */
export const tabAvailable = (item: { disabled?: boolean; hidden?: boolean }): boolean => !item.disabled && !item.hidden;

/** @deprecated Use `TabsProps`. */
export interface TabsControllerOptions {
    items: readonly Keyed<TabItem>[];
    /** The selected tab (default: the first available one). */
    value?: string;
    orientation?: 'horizontal' | 'vertical';
    activationMode?: 'automatic' | 'manual';
    /** Accepted for compatibility: a tab links to its panel once `attachPanel` gives it one. */
    panels?: boolean;
    dir?: 'ltr' | 'rtl';
    onChange?: (id: string) => void;
}
/** @deprecated Use `TabsProps`. */
export interface TabsOptions extends TabsControllerOptions {
    variant?: TabsVariant;
    className?: string;
    tabClassName?: string;
}
/** @deprecated Use `createTabs`: items carry `value` instead of `id`, `onChange` is
 *  `onValueChange`, `tab()` is `trigger()` and `attachPanel()` is `panel()`. */
export class Tabs {
    readonly el: HTMLElement;
    private readonly handle: TabsHandle;
    constructor(opts: TabsOptions) {
        this.handle = createTabs({
            items: opts.items.map(withValue),
            defaultValue: opts.value,
            onValueChange: opts.onChange,
            orientation: opts.orientation,
            activationMode: opts.activationMode,
            dir: opts.dir,
            variant: opts.variant,
            className: opts.className,
            triggerClassName: opts.tabClassName,
        });
        this.el = this.handle.el;
    }
    get value(): string | null {
        return this.handle.value;
    }
    /** Show a tab as selected without notifying. */
    setValue(id: string | null): void {
        this.handle.setValue(id);
    }
    setItems(items: readonly Keyed<TabItem>[]): void {
        this.handle.setItems(items.map(withValue));
    }
    /** Hide or show a tab. Hiding the selected tab selects the first available one (notified). */
    setHidden(id: string, hidden: boolean): void {
        this.handle.setHidden(id, hidden);
    }
    /** The button of a tab (null: unknown id). */
    tab(id: string): HTMLButtonElement | null {
        return this.handle.trigger(id);
    }
    /** Make `el` the panel of tab `id`. */
    attachPanel(id: string, el: HTMLElement): void {
        this.handle.panel(id, el);
    }
    destroy(): void {
        this.handle.destroy();
    }
}

interface ToggleGroupCommonOptions {
    items: readonly Keyed<ToggleGroupItem>[];
    /** Accessible name of the group. */
    label?: string;
    iconOnly?: boolean;
    dir?: 'ltr' | 'rtl';
}
/** @deprecated Use `ToggleGroupSingleProps`. */
export interface ToggleGroupSingleOptions extends ToggleGroupCommonOptions {
    type?: 'single';
    value?: string;
    onChange?: (value: string) => void;
}
/** @deprecated Use `ToggleGroupMultipleProps`. */
export interface ToggleGroupMultipleOptions extends ToggleGroupCommonOptions {
    type: 'multiple';
    value?: readonly string[];
    onChange?: (value: string[]) => void;
}
/** @deprecated Use `ToggleGroupProps`. */
export type ToggleGroupControllerOptions = ToggleGroupSingleOptions | ToggleGroupMultipleOptions;
/** @deprecated Use `ToggleGroupProps`. */
export type ToggleGroupOptions = ToggleGroupControllerOptions & {
    size?: 'default' | 'sm';
    fill?: boolean;
    className?: string;
};
/** @deprecated Use `createToggleGroup`: items carry `value` instead of `id`, `value` is
 *  `defaultValue` and `onChange` is `onValueChange`. */
export class ToggleGroup {
    readonly el: HTMLElement;
    private readonly handle: ToggleGroupHandle;
    constructor(opts: ToggleGroupOptions) {
        const common = {
            items: opts.items.map(withValue),
            label: opts.label,
            iconOnly: opts.iconOnly,
            dir: opts.dir,
            size: opts.size,
            fill: opts.fill,
            className: opts.className,
        };
        this.handle =
            opts.type === 'multiple'
                ? createToggleGroup({ ...common, type: 'multiple', defaultValue: opts.value, onValueChange: opts.onChange })
                : createToggleGroup({ ...common, type: 'single', defaultValue: opts.value, onValueChange: opts.onChange });
        this.el = this.handle.el;
    }
    /** The options turned on. */
    get values(): readonly string[] {
        return this.handle.values;
    }
    /** Show options as on without notifying. */
    setValue(value: string | readonly string[] | null): void {
        this.handle.setValue(value);
    }
    setItems(items: readonly Keyed<ToggleGroupItem>[]): void {
        this.handle.setItems(items.map(withValue));
    }
    destroy(): void {
        this.handle.destroy();
    }
}
