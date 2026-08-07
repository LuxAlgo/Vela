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
//  - SCRIPTING ENGINES (`chart.registerEngine`): a language runtime executing indicator
//    scripts against Vela-owned bars through the `ScriptingEngine` port — see the section
//    at the bottom for the port plus the model/identity/palette vocabulary it builds with.
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
    type ChartTypeSettingsInstance,
    type ChartTypeSettingsSubsection,
    type SettingsRowDescriptor,
    type SettingsRowSwatch,
    type SettingsRowWidth,
    type SettingsSelectOption,
    type SettingsRowCondition,
    type SettingsRowWhen,
    type SeriesDataEngine,
    type SeriesDataEngineHost,
} from './chart-types/registry';
export type { BarTransform } from './core/price-styles/BarTransform';
export { registerRendererDefaults, unregisterRendererDefaults, rendererDefaults } from './core/renderer-defaults';
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
    type BasePaintingModulation,
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
    registerLegendAction,
    unregisterLegendAction,
    legendActions,
    registerDefaultEngine,
    unregisterDefaultEngine,
    resolveEngines,
    type EngineFactory,
    type LegendActionDescriptor,
    type LegendIndicatorInfo,
    type WidgetActionDescriptor,
    type WidgetActionTarget,
    type WidgetAttachment,
    type WidgetContext,
    type SidePanelDescriptor,
    type SidePanelHandle,
    type SidePanelHeader,
    type SidePanelButton,
} from './widget/contributions';
// A plugin panel gets the shell's own column; these bounds are what `resizable` clamps to.
export { clampPanelWidth, DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_MAX_WIDTH, type SidePanelOptions } from './widget/side-panel';
export { drawingTypes, getDrawingType, type DrawingTypeMeta } from './core/drawings/registry';
export type { DrawingTypeKey } from './core/drawings/Drawing';
export { registerIcon, iconMarkup } from './ui/icons';
export type { KeyBindingDescriptor, ResolvedBinding } from './ui/keymap';
export type { PriceStyle } from './core/options';
export type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from './core/ports/DataProvider';

// SCRIPTING ENGINES (`chart.registerEngine` / the widget's `engines` option): a language
// runtime implementing the `ScriptingEngine` port — prepare/execute sessions over bars
// Vela owns and passes in. Engines are per-chart instances rather than a global registry,
// but the port, the model vocabulary engine output is built from, and the series-identity
// contract all live here so an engine package builds against `vela/plugin` alone.
export type {
    ScriptingEngine,
    EngineCapabilities,
    PreparedScript,
    ExecutionRequest,
    ExecutionHandlers,
    ExecutionSession,
    ExecutionMarket,
    FetchSeries,
    EngineAlert,
    EngineWarning,
    VisibleBarRange,
    BarsChangeReason,
    EngineContextSnapshot,
    ContextSelect,
} from './core/ports/ScriptingEngine';
export type { MarketDataFeed, SymbolInfo, BarRange } from './core/ports/MarketDataFeed';
// What an engine fills so a host can read a running strategy (`EngineContextSnapshot.strategy`
// / `.trades`) and what the core reshapes it into (`script:run`, `chart.runScript()`).
export type { StrategyState, StrategyTrade, StrategyFill } from './core/model/strategy';
export type { ScriptRun, ScriptRunCause, ScriptRunResult } from './core/script-run';
// The full model vocabulary (`OHLCV`, `IndicatorModel`, series/scene/drawing specs) — what
// engine `onModel` payloads and native-indicator outputs are made of.
export type * from './core/model';
// Series ids must come from `stableSeriesId` so renderer reconciliation and persisted
// per-series settings survive re-runs identically whichever engine produced the series.
export { stableSeriesId } from './core/model';
// The semantic palette (fixed brand/meaning colors, never theme-dependent) so plugin
// output — default plot colors, layer inks — matches core affordances exactly.
export * from './core/palette';
