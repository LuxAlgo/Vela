// vela/widget — the batteries-included chart app built on the vela/ui kit.
export { VelaWidget, type VelaWidgetOptions } from './VelaWidget';
export type { VelaShellOptions } from './shell-options';
export { Topbar, priceStyleLabel, type TopbarOptions } from './topbar';
export {
    resolveTopbarComposition,
    topbarHas,
    pinnedTopbarActionIds,
    TOPBAR_BUILTIN_IDS,
    TOPBAR_DEFAULT_LEFT,
    TOPBAR_DEFAULT_RIGHT,
    type TopbarComposition,
    type ResolvedTopbarComposition,
} from './topbar-composition';
export { Statusline } from './statusline';
export { Watermark } from './watermark';
export { Bottombar, RANGE_PRESETS, type BottombarOptions, type RangePreset } from './bottombar';
export { SymbolPicker, filterSymbols, type SymbolPickerOptions } from './symbol-picker';
export { IndicatorPicker, type IndicatorPickerOptions, type IndicatorRow } from './indicator-picker';
export { TimeframeQuick, type TimeframeQuickOptions } from './timeframe-quick';
export { localStorageAdapter, type VelaStorage, type WidgetStorage } from './persist';
// The unified shell-state document — the SAME format `vela/workspace` exposes; the
// widget's `getState()`/`applyState()` speak it with a single `c1` cell.
export { encodeState, decodeState, sanitizeState } from '../state/document';
export type { WorkspaceState, CellState, ChartState, PanelsState } from '../state/document';
export { SidePanel, clampPanelWidth, DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_MIN_WIDTH, DEFAULT_PANEL_MAX_WIDTH, type SidePanelOptions } from './side-panel';
export { PanelDock, type PanelChrome, type PanelDockDeps, type BuiltInPanel } from './panel-dock';
export { ObjectTree } from './object-tree';
export { DataWindow, dataWindowSections, type DataWindowSection, type DataWindowLine } from './data-window';
export { ShortcutsHelp } from './shortcuts-help';
export { ChartContextMenu, type ContextMenuCallbacks } from './context-menu';
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
    DEFAULT_PANEL_ORDER,
    registerStatePersistence,
    unregisterStatePersistence,
    statePersistenceHandlers,
    topbarActionOverride,
    OVERRIDABLE_TOPBAR_IDS,
    type StatePersistenceHandler,
    type CellStateContext,
    type ExternalIndicatorEntry,
    type WidgetAttachment,
    type WidgetActionDescriptor,
    type WidgetActionTarget,
    type WidgetContext,
    type SidePanelDescriptor,
    type SidePanelHandle,
    type SidePanelButton,
} from './contributions';
export { parseTimeframe, timeframeMs, timeframeLabel, type ParsedTimeframe } from './timeframe';
export { TIMEZONES, normalizeTimezone, tzOffset, tzMenuLabel, tzButtonLabel, type TimezoneEntry } from './timezones';
export { decimalsFor, fmtPrice, fmtChange } from './format';
export {
    resolveIndicators,
    type IndicatorManifest,
    type IndicatorLoader,
    type IndicatorManifestEntry,
    type ResolvedIndicator,
} from './indicators';
