// vela/ui — the component kit, re-exported from `@luxalgo/vela-ui` (each component one file,
// its CSS in the `vela.ui` cascade layer, a `create<Name>` function; overlays and composite
// controls run Zag machines), next to what stays Vela's own: the keymap. The lists below are
// the public API: a component file's other exports stay internal.
export { injectStyles, withAlpha, overlayScrollbarCss, FIELD_FOCUS_CSS, FIELD_FOCUS_RING } from '@luxalgo/vela-ui/styles';
export { css, t, type Token } from '@luxalgo/vela-ui';
export {
    applyThemeTokens,
    applyPlotOverlayTokens,
    ensureUIHost,
    createTheme,
    applyTheme,
    checkTheme,
    type UiTheme,
    type ThemeInput,
    type ThemeSettings,
    type CreateThemeOptions,
    type ComponentSettings,
    type TokenName,
} from '@luxalgo/vela-ui/theme';
export { registerIcon, iconMarkup, iconEl, svg16, svg24 } from '@luxalgo/vela-ui/icons';
export { runMachine, nextUid, normalizeProps, spreadProps, type MachineHandle } from '@luxalgo/vela-ui/zag';
export { SURFACE_OPEN_EVENT, SURFACE_CLOSE_EVENT, type SurfaceKind, type SurfaceEventDetail } from '@luxalgo/vela-ui/surface-events';
export { KeymapManager, type KeyBindingDescriptor, type ResolvedBinding, type KeymapOptions } from './keymap';
export { applyProps, type PartProps } from '@luxalgo/vela-ui/headless';

export { Tooltip, createTooltip, tooltipController, type TooltipOptions, type TooltipProps, type TooltipController, type TooltipControllerOptions, type TooltipApi, type TooltipService } from '@luxalgo/vela-ui/tooltip';
export { Menu, createMenu, menuController, type MenuOptions, type MenuProps, type MenuController, type MenuControllerOptions, type MenuItemDescriptor, type MenuApi, type MenuService } from '@luxalgo/vela-ui/menu';
export { Dialog, createDialog, dialogController, type DialogOptions, type DialogProps, type DialogVariant, type DialogController, type DialogControllerOptions, type DialogApi, type DialogService } from '@luxalgo/vela-ui/dialog';
export { Drawer, createDrawer, drawerController, type DrawerOptions, type DrawerProps, type DrawerController, type DrawerControllerOptions, type DrawerApi, type DrawerService } from '@luxalgo/vela-ui/drawer';
export {
    Popover,
    createPopover,
    closeOpenPopovers,
    isPopoverOpen,
    openPopoverTrigger,
    eventDismissedPopover,
    popoverController,
    placePopover,
    insetRect,
    intersectRects,
    viewportRect,
    type PopoverOptions,
    type PopoverProps,
    type PopoverBoundary,
    type PopoverController,
    type PopoverControllerOptions,
    type PopoverAlign,
    type PopoverPosition,
    type PlaceArgs,
    type PlaceResult,
    type Rect,
} from '@luxalgo/vela-ui/popover';
export { Checkbox, createCheckbox, checkboxController, type CheckboxOptions, type CheckboxProps, type CheckboxController, type CheckboxControllerOptions, type CheckboxSize, type CheckboxTone } from '@luxalgo/vela-ui/checkbox';
export { Input, createInput, inputController, type InputOptions, type InputProps, type InputController, type InputControllerOptions, type InputSize } from '@luxalgo/vela-ui/input';
export { createEmpty, type EmptyProps, type EmptyHandle } from '@luxalgo/vela-ui/empty';
export {
    Switch,
    createSwitch,
    switchController,
    TextField,
    createTextField,
    textFieldController,
    type SwitchOptions,
    type SwitchProps,
    type SwitchController,
    type SwitchControllerOptions,
    type SwitchSize,
    type SwitchTone,
    type TextFieldOptions,
    type TextFieldProps,
    type TextFieldController,
    type TextFieldControllerOptions,
    type TextFieldSize,
} from './renamed';
export {
    Select,
    createSelect,
    openSelectList,
    toggleSelectList,
    fillSelectList,
    decorateSelectScroll,
    selectController,
    type SelectOptions,
    type SelectProps,
    type SelectListPopoverOpts,
    type SelectController,
    type SelectControllerOptions,
    type SelectOption,
    type SelectSize,
} from '@luxalgo/vela-ui/select';
export {
    NumberInput,
    createNumberInput,
    numberInputController,
    clampNumber,
    snapToStep,
    type NumberInputOptions,
    type NumberInputProps,
    type NumberInputController,
    type NumberInputControllerOptions,
    type NumberSize,
    type NumberCommit,
} from '@luxalgo/vela-ui/number-input';

export {
    ColorField,
    createColorField,
    colorField,
    buildColorPicker,
    closeColorPopover,
    splitColor,
    combineColor,
    blendOver,
    transparencyChecker,
    hslHex,
    buildPalette,
    colorPickerController,
    type ColorFieldOpts,
    type ColorFieldProps,
    type ColorCommit,
    type ColorPickerOptions,
    type ColorPickerController,
    type ColorPickerControllerOptions,
    type ColorFieldShape,
} from '@luxalgo/vela-ui/color-picker';
export {
    fieldGrid,
    fieldSection,
    fieldSeparator,
    fieldRow,
    buildFieldControl,
    fieldGridColumns,
    FIELD_GAP_PX,
    type FieldGridOptions,
    type FieldSectionOptions,
    type FieldRowOptions,
    type FieldToggleOpts,
    type FieldInlineItem,
    type FieldControlDesc,
    type FieldControlHandle,
    type FieldGridVariant,
    type FieldLabelSize,
} from '@luxalgo/vela-ui/field';
export { TextArea, createTextArea, textAreaController, type TextAreaOptions, type TextAreaProps, type TextAreaController, type TextAreaControllerOptions, type TextAreaSize } from '@luxalgo/vela-ui/text-area';
export {
    GlyphSelect,
    createGlyphSelect,
    widthField,
    closeWidthPopover,
    glyphSelectController,
    widthFieldOptions,
    lineWidthGlyph,
    WIDTH_FIELD_OPTIONS,
    type GlyphSelectOptions,
    type GlyphSelectProps,
    type GlyphOption,
    type GlyphSelectController,
    type GlyphSelectControllerOptions,
} from '@luxalgo/vela-ui/glyph-select';
export {
    CalloutBubble,
    createCalloutBubble,
    closesPanel,
    calloutPanelRows,
    CALLOUT_STYLE_ID,
    CALLOUT_CSS,
    type CalloutBubbleOptions,
    type CalloutBubbleProps,
    type CalloutBubbleSpec,
    type CalloutPanel,
    type CalloutPanelItem,
    type CalloutPanelRow,
} from '@luxalgo/vela-ui/callout-bubble';
export {
    DatePicker,
    createDatePicker,
    datePickerController,
    normalizeDateInput,
    isoDate,
    type DatePickerOptions,
    type DatePickerProps,
    type DatePickerController,
    type DatePickerControllerOptions,
    type DatePickerCell,
    type DatePickerPanel,
} from '@luxalgo/vela-ui/date-picker';
export { createButton, type ButtonProps, type ButtonHandle, type ButtonVariant, type ButtonSize } from '@luxalgo/vela-ui/button';
export { createTabs, type TabsProps, type TabsHandle, type TabsVariant, type TabItem } from '@luxalgo/vela-ui/tabs';
export { createToggleGroup, type ToggleGroupProps, type ToggleGroupHandle, type ToggleGroupItem, type ToggleGroupSingleProps, type ToggleGroupMultipleProps } from '@luxalgo/vela-ui/toggle-group';
export { createBadge, type BadgeProps, type BadgeHandle, type BadgeVariant } from '@luxalgo/vela-ui/badge';
