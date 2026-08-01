// vela/workspace — the multi-chart shell: a grid of ChartCells with stable slot ids,
// one shared data feed, an active cell, resizable splitters, and a layout registry
// (`registerLayout`) plugins extend like every other Vela registry.
export { VelaWorkspace } from './VelaWorkspace';
export type { VelaWorkspaceOptions, WorkspaceEventMap } from './VelaWorkspace';
export { ChartCell } from './ChartCell';
export type { CellSeed, CellBoot, CellChartDefaults, PooledCellState, CellNativeInfo } from './ChartCell';
export type { WorkspaceWidgetContext } from './context';
export {
    registerLayout,
    unregisterLayout,
    layoutDefinition,
    layouts,
    registerBuiltinLayouts,
    gridStyles,
    activeAfterLayout,
} from './layouts';
export type { LayoutDefinition, TrackSizes } from './layouts';
export { evenTracks, resizeTracks, trackOffsets } from './splitters';
export { syncTargets, rangesWithin } from './sync';
export type { SyncKind, SyncSetting, SyncOptions } from './sync';
export { encodeState, decodeState, sanitizeState, memoryStorageAdapter } from './persist';
export type { WorkspaceState, CellState, ChartState, PanelsState, WorkspaceStorage } from './persist';
