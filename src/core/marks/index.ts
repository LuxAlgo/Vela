/**
 * Timeline marks — host events pinned to a moment in time, shown on a lane above the
 * time axis. Renderer-agnostic: nothing here imports from `renderers/`.
 */
export type { MarkShape, MarkGlyph, MarkPanelItem, MarkContent, MarkContentSource, TimelineMark, MarkGroup, MarkClickEvent } from './types';
export { MarksController } from './MarksController';
