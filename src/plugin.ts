// The Vela PLUGIN SDK — the public extension surface a plugin package (e.g. Vela-Pro)
// builds against. Everything here is framework-free and side-effect-free to import.
//
// Extension seams:
//  - CHART TYPES (`registerChartType`): a new price style contributing a bar transform
//    (view-bar stream), a per-chart data engine (secondary per-bar data pushed through the
//    renderer's native channels, incl. the `<id>-pending` loading protocol), and an
//    extended-ticker modifier (`"SYM;id"` for scripts).
//  - NATIVE INDICATORS (`registerNativeIndicator`): core-computed indicators with renderer
//    layers driven through the same native-data channels (volume and VPVR are built on it).
//
// UI contributions (style-picker entries, settings sections, shortcuts) arrive with the
// widget SDK — contributions are DATA descriptors, never DOM.
export {
    registerChartType,
    unregisterChartType,
    chartType,
    chartTypes,
    tickerModifierIds,
    type ChartTypeDefinition,
    type ChartTypeSettingsSection,
    type SettingsRowDescriptor,
    type SeriesDataEngine,
    type SeriesDataEngineHost,
} from './chart-types/registry';
export type { BarTransform } from './core/price-styles/BarTransform';
export {
    registerNativeIndicator,
    unregisterNativeIndicator,
    getNativeIndicator,
    nativeIndicatorTypes,
    type NativeIndicator,
    type NativeIndicatorDescriptor,
    type NativeIndicatorContext,
    type NativeIndicatorOutput,
    type NativeIndicatorInfo,
} from './core/native-indicators/NativeIndicator';
export {
    registerRendererLayer,
    unregisterRendererLayer,
    rendererLayers,
    type RendererLayerDefinition,
    type RendererLayerInstance,
    type RendererLayerArgs,
} from './renderers/native/layers';
export {
    registerWidgetAction,
    unregisterWidgetAction,
    widgetActions,
    registerWidgetAttachment,
    unregisterWidgetAttachment,
    widgetAttachments,
    registerSidePanel,
    unregisterSidePanel,
    sidePanels,
    type WidgetActionDescriptor,
    type WidgetActionTarget,
    type WidgetAttachment,
    type WidgetContext,
    type SidePanelDescriptor,
    type SidePanelHandle,
    type SidePanelButton,
} from './widget/contributions';
// A plugin panel gets the shell's own column; these bounds are what `resizable` clamps to.
export { clampPanelWidth, DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_MAX_WIDTH, type SidePanelOptions } from './widget/side-panel';
export { drawingTypes, getDrawingType, type DrawingTypeMeta } from './core/drawings/registry';
export type { DrawingTypeKey } from './core/drawings/Drawing';
export { registerIcon, iconMarkup } from './ui/icons';
export type { KeyBindingDescriptor, ResolvedBinding } from './ui/keymap';
export type { PriceStyle } from './core/options';
export type { OHLCV } from './core/model/ohlcv';
export type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from './core/ports/DataProvider';
