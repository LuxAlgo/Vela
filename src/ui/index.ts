// vela/ui — the component kit. Each component is one file, `components/<name>.ts`: its
// declaration (parts and settings), its variants, its CSS in the `vela.ui` cascade layer and
// a `create<Name>` function; overlays and composite controls run Zag machines. The lists
// below are the public API: a component file's other exports stay internal.
export { injectStyles, withAlpha, overlayScrollbarCss, FIELD_FOCUS_CSS, FIELD_FOCUS_RING } from './styles';
export { applyThemeTokens, applyPlotOverlayTokens, ensureUIHost } from './tokens';
export { registerIcon, iconMarkup, iconEl, svg16, svg24 } from './icons';
export { runMachine, nextUid, normalizeProps, spreadProps, type MachineHandle } from './zag';
export { SURFACE_OPEN_EVENT, SURFACE_CLOSE_EVENT, type SurfaceKind, type SurfaceEventDetail } from './surface-events';
export { KeymapManager, type KeyBindingDescriptor, type ResolvedBinding, type KeymapOptions } from './keymap';
export { applyProps, type PartProps } from './headless';

export { Tooltip, createTooltip, tooltipController, type TooltipOptions, type TooltipProps, type TooltipController, type TooltipControllerOptions, type TooltipApi, type TooltipService } from './components/tooltip';
export { Menu, createMenu, menuController, type MenuOptions, type MenuProps, type MenuController, type MenuControllerOptions, type MenuItemDescriptor, type MenuApi, type MenuService } from './components/menu';
export { Dialog, createDialog, dialogController, type DialogOptions, type DialogProps, type DialogVariant, type DialogController, type DialogControllerOptions, type DialogApi, type DialogService } from './components/dialog';
export { Drawer, createDrawer, drawerController, type DrawerOptions, type DrawerProps, type DrawerController, type DrawerControllerOptions, type DrawerApi, type DrawerService } from './components/drawer';
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
} from './components/popover';
export { Switch, createSwitch, switchController, type SwitchOptions, type SwitchProps, type SwitchController, type SwitchControllerOptions, type SwitchSize, type SwitchTone } from './components/switch';
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
} from './components/select';
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
} from './components/number-input';
export { TextField, createTextField, textFieldController, type TextFieldOptions, type TextFieldProps, type TextFieldController, type TextFieldControllerOptions, type TextFieldSize } from './components/text-field';
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
} from './components/color-picker';
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
} from './components/field';
export { TextArea, createTextArea, textAreaController, type TextAreaOptions, type TextAreaProps, type TextAreaController, type TextAreaControllerOptions, type TextAreaSize } from './components/text-area';
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
} from './components/glyph-select';
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
} from './components/callout-bubble';
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
} from './components/date-picker';
export { createButton, type ButtonProps, type ButtonHandle, type ButtonVariant, type ButtonSize } from './components/button';
export { createTabs, type TabsProps, type TabsHandle, type TabsVariant, type TabItem } from './components/tabs';
export { createToggleGroup, type ToggleGroupProps, type ToggleGroupHandle, type ToggleGroupItem, type ToggleGroupSingleProps, type ToggleGroupMultipleProps } from './components/toggle-group';
export { createBadge, type BadgeProps, type BadgeHandle, type BadgeVariant } from './components/badge';
