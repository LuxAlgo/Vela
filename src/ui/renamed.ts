// The kit's earlier names for components renamed after shadcn's (Switch is a checkbox, a text
// field an input, a menu a dropdown menu). Kept for one release.
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
