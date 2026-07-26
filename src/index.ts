// Public composition root + default backends
export { Vela } from './Vela';
export type { VelaDeps, RunIndicatorResult } from './Vela';
export { RendererControl } from './core/RendererControl';
export { NativeRenderer } from './renderers/native/NativeRenderer';
// The drawing-toolbar VIEW as a standalone component — a workspace shell mounts ONE
// shared bar (dock:'static') and routes it to the active chart's `chart.drawings`.
export { DrawingToolbar, type DrawingToolbarOptions } from './renderers/native/drawings/DrawingToolbar';
export type { ChartConfig, ChartStyle } from './renderers/native/core/chartConfig';
export { PineEngine } from './engines/pinets/PineEngine';
export { PineWorkerEngine } from './engines/pinets-worker/PineWorkerEngine';
export type { PineWorkerOptions } from './engines/pinets-worker/PineWorkerEngine';
export { MultiProviderFeed } from './data/MultiProviderFeed';
export { CachingDataFeed } from './data/CachingDataFeed';
export { BarStore, sharedBarStore } from './data/BarStore';
export { timeframeToMs } from './data/timeframe';
export { DataControl } from './core/DataControl';
export { DrawingsControl } from './core/DrawingsControl';

// Native indicators (core-computed, no scripting engine) — register a type, then chart.addNativeIndicator(type)
export { registerNativeIndicator, unregisterNativeIndicator, getNativeIndicator, nativeIndicatorTypes, nativeIndicatorDescriptors } from './core/native-indicators';
export type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor, NativeIndicatorInfo, NativeIndicatorOutput } from './core/native-indicators';
export { DARK_THEME, LIGHT_THEME, resolveTheme } from './core/theme';
export { TypedEventBus } from './core/events/EventBus';

// User drawings (model + registry + persistence; renderer-agnostic)
export {
    Drawing,
    DrawingStore,
    registerDrawingType,
    createDrawing,
    deserializeDrawing,
    defaultToolbar,
    buildToolbar,
} from './core/drawings';
export type {
    DrawingTypeKey,
    SerializedDrawing,
    DrawingPoint,
    DrawingStyle,
    DrawingText,
    DrawingsDocument,
    DrawingsOption,
    DrawingTypeMeta,
    ToolbarDefinition,
    ToolbarGroupConfig,
    SettingsSchema,
    SettingsField,
    Projector,
    SnapMode,
    DrawingIntent,
    DrawingMode,
    IDrawingsRendererPort,
} from './core/drawings';

// Public types
export type * from './core/model';
export type {
    VelaOptions,
    MarketConfig,
    MarketSwitch,
    MarketSnapshot,
    VelaTheme,
    ThemeName,
    ProviderName,
    RendererConstructor,
    RendererDisplayOptions,
    AddIndicatorOptions,
} from './core/options';
export type { IndicatorHandle, IndicatorEventMap } from './core/IndicatorHandle';
export type { VelaEventMap } from './core/events/types';
export type {
    IChartRenderer,
    RendererCapabilities,
    IndicatorRenderHandle,
    CrosshairEvent,
    ClickEvent,
    InputChangeEvent,
    VisibleRange,
} from './core/ports/IChartRenderer';
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
} from './core/ports/ScriptingEngine';
export type { MarketDataFeed, SymbolInfo, BarRange } from './core/ports/MarketDataFeed';
export type { DataProvider, ProviderInfo, ProviderCapabilities, SymbolDescriptor } from './core/ports/DataProvider';
export type { Resolved, ParsedSymbol } from './data/ProviderRegistry';
export type { SceneInspection, IndicatorSummary } from './core/engine/inspect';
export type { VisibleRangePreset } from './core/visible-range';

// The plugin SDK surface (also available as the `vela/plugin` subpath).
export * from './plugin';
