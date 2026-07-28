// vela/widget — the batteries-included chart app built on the vela/ui kit.
export { VelaWidget, type VelaWidgetOptions } from './VelaWidget';
export { Topbar, priceStyleLabel, type TopbarOptions } from './topbar';
export { Statusline } from './statusline';
export { Watermark } from './watermark';
export { Bottombar, RANGE_PRESETS, type BottombarOptions, type RangePreset } from './bottombar';
export { SymbolPicker, filterSymbols, type SymbolPickerOptions } from './symbol-picker';
export { IndicatorPicker, type IndicatorPickerOptions, type IndicatorRow } from './indicator-picker';
export { TimeframeQuick, type TimeframeQuickOptions } from './timeframe-quick';
export { loadPersisted, savePersisted, parsePersisted, legacyWidgetState, localStorageAdapter, type WidgetStorage, type PersistedState } from './persist';
// The unified shell-state document — the SAME format `vela/workspace` exposes; the
// widget's `getState()`/`applyState()` speak it with a single `c1` cell.
export { encodeState, decodeState, sanitizeState } from '../state/document';
export type { WorkspaceState, CellState, ChartState } from '../state/document';
export { readUrlState, writeUrlState } from './url-state';
export { SidePanel } from './side-panel';
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
    type WidgetAttachment,
    type WidgetActionDescriptor,
    type WidgetActionTarget,
    type WidgetContext,
} from './contributions';
export { parseTimeframe, timeframeMs, timeframeLabel, type ParsedTimeframe } from './timeframe';
export { TIMEZONES, tzOffset, tzMenuLabel, tzButtonLabel, type TimezoneEntry } from './timezones';
export { decimalsFor, fmtPrice, fmtChange } from './format';
export {
    resolveIndicators,
    type IndicatorManifest,
    type IndicatorManifestEntry,
    type ResolvedIndicator,
} from './indicators';
