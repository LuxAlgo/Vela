import type { Unsubscribe } from '../util/types';
import type { DrawingTypeKey, SerializedDrawing } from './Drawing';
import type { SnapMode } from './geometry';
import type { ToolbarDefinition } from './toolbar';

/**
 * The renderer-local drawing MODES beyond an armed tool: the transient measure ruler,
 * the eraser, or none. Mutually exclusive with each other and with any armed tool —
 * the renderer owns that exclusion; the core mirrors the outcome (see the `mode`
 * intent) so external UIs (a shared workspace toolbar) can reflect and drive it.
 */
export type DrawingMode = 'measure' | 'eraser' | null;

/**
 * Renderer→core INTENT. The renderer proposes a change from a user gesture; the
 * core {@link DrawingController} decides, mutates the store (the source of truth),
 * re-syncs, and emits a `drawing:*` event. A single discriminated union (vs one
 * callback per kind) because every arm routes to the same destination.
 */
export type DrawingIntent =
    | { kind: 'arm'; type: DrawingTypeKey | null }
    | { kind: 'create'; doc: SerializedDrawing }
    | { kind: 'edit'; doc: SerializedDrawing }
    | { kind: 'edit-many'; docs: SerializedDrawing[] } // atomic multi-drag / multi-nudge (one undo entry)
    | { kind: 'select'; ids: string[]; additive?: boolean } // additive = shift-toggle vs replace
    | { kind: 'delete'; ids: string[] }
    | { kind: 'reorder'; id: string; to: 'front' | 'back' }
    | { kind: 'settings'; id: string }
    | { kind: 'tool-finished'; type: DrawingTypeKey }
    | { kind: 'favorite'; type: DrawingTypeKey; on: boolean } // flyout star toggled
    // The renderer-local magnet / mode state changed (in-chart toolbar click, or a
    // mutual-exclusion side effect — arming a tool exits measure/eraser). The core
    // mirrors the value and re-emits it as a chart event; an equal value is a no-op,
    // which is what keeps the command↔intent loop convergent.
    | { kind: 'snap-mode'; mode: SnapMode }
    | { kind: 'mode'; mode: DrawingMode }
    | { kind: 'undo' }
    | { kind: 'redo' }
    | { kind: 'duplicate'; ids: string[] } // clone in place + select the clones
    | { kind: 'copy'; ids: string[] }
    | { kind: 'paste' };

/**
 * The interactive user-drawings surface a renderer optionally implements. Present
 * iff `capabilities.userDrawings`. Commands flow down; one intent channel flows up.
 * Only plain {@link SerializedDrawing}/{@link ToolbarDefinition} data crosses — no
 * backend types, mirroring the rest of {@link IChartRenderer}.
 */
export interface IDrawingsRendererPort {
    /** Hand the renderer the inert toolbar definition to RENDER (groups/tools/icons). */
    setToolbar(def: ToolbarDefinition): void;
    /** Show or hide the on-chart drawing toolbar. */
    showToolbar(visible: boolean): void;
    /** Push the authoritative snapshot down; the renderer re-projects + repaints. */
    syncDrawings(docs: readonly SerializedDrawing[]): void;
    /** Arm/disarm a tool (`null` = selection/idle, pan resumes). `lastStyle` is the
     *  tool's last-used style (if any) so the placement preview matches what will be
     *  committed, rather than falling back to the type default. */
    setActiveTool(type: DrawingTypeKey | null, lastStyle?: SerializedDrawing['style']): void;
    /** Reflect which drawings are selected (drives handle painting); `[]` = none. */
    setSelection(ids: readonly string[]): void;
    /** Push the FAVORITE tool set (flyout stars + any favorites-driven UI). Optional —
     *  favorites still work headless without a renderer reflection. */
    setFavorites?(types: readonly DrawingTypeKey[]): void;
    /** Set the sticky magnet snap mode (off/weak/strong). Optional — a renderer without
     *  a magnet omits it; the in-chart toolbar reflects the pushed value. */
    setSnapMode?(mode: SnapMode): void;
    /** Enter/exit a renderer-local mode (measure ruler / eraser; `null` exits). The
     *  renderer keeps owning the mutual exclusion (with armed tools too) and reports
     *  every actual change back through the `mode` intent. Optional. */
    setMode?(mode: DrawingMode): void;
    /** Open a drawing's settings popup (selecting it too) — the programmatic twin of a click on it. */
    openSettings(id: string): void;
    /** The one channel up — create/edit/select/delete/settings/tool-finished. */
    onDrawingIntent(cb: (intent: DrawingIntent) => void): Unsubscribe;
}
