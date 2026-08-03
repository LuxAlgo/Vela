// The workspace LAYOUT engine — pure data + pure functions (DOM-free, unit-testable).
//
// A layout is a registered descriptor (the same idiom as the chart-type registry): a
// grid of weighted tracks plus the SLOTS it exposes. Slot ids are canonical (`c1`…`cN`)
// and shared by every layout, which is why two layouts need no id coordination — but a
// slot id is pure geometry, NOT a cell identity: which cell lives in slot i is the
// workspace's call (its `cells` declaration order), and a cell dropped by a smaller
// layout parks its state in the pool under its own identity. Asymmetric layouts map
// slots onto named grid areas; the slot ids stay `cN` regardless.
//
// `registerLayout` is the SDK seam: plugins/hosts add denser grids or bespoke
// arrangements, and every workspace layout picker reads the registry live.

/** One registered workspace layout. */
export interface LayoutDefinition {
    /** Stable id (`'4'`, `'2h'`, a plugin's `'6-tall'`, …) — re-registering replaces. */
    id: string;
    /** Human-readable label for layout pickers. */
    label: string;
    /** Column track weights (`fr` units), left to right. */
    cols: number[];
    /** Row track weights, top to bottom. */
    rows: number[];
    /**
     * Optional `grid-template-areas` rows for ASYMMETRIC layouts — one string per row,
     * one area name per column (e.g. `['main a', 'main b']` = a tall left cell besides
     * two stacked ones). Omitted ⇒ cells auto-flow row-major in `cells` order.
     */
    areas?: string[];
    /** The layout's SLOTS, in order — pure geometry: `id` keys the slot's grid styles
     *  and `area` binds it to a named area. A slot id is NOT a cell identity: the cell
     *  living in slot i is decided by the workspace (its `cells` declaration order),
     *  so two layouts sharing slot geometry need no id coordination. Built-ins use
     *  `c1`…`cN`. */
    cells: Array<{ id: string; area?: string }>;
}

/** Grid track sizes overriding a layout's declared weights (splitter drags). */
// TrackSizes is part of the shared state document (`src/state/document.ts`).
import type { TrackSizes } from '../state/document';

export type { TrackSizes } from '../state/document';

const registry = new Map<string, LayoutDefinition>();

/** Register (or replace) a workspace layout. Pickers read the registry live. */
export function registerLayout(def: LayoutDefinition): void {
    registry.set(def.id, def);
}

export function unregisterLayout(id: string): void {
    registry.delete(id);
}

/** The definition behind a layout id (undefined for unknown ids). */
export function layoutDefinition(id: string): LayoutDefinition | undefined {
    return registry.get(id);
}

/** Every registered layout (registration order) — drives layout pickers. */
export function layouts(): LayoutDefinition[] {
    return [...registry.values()];
}

/** Canonical slot ids `c1`…`cN`. */
function slots(n: number): Array<{ id: string }> {
    return Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}` }));
}

/** Register the built-in presets (idempotent — called by the workspace entry point). */
export function registerBuiltinLayouts(): void {
    registerLayout({ id: '1', label: 'Single', cols: [1], rows: [1], cells: slots(1) });
    registerLayout({ id: '2h', label: '2 side by side', cols: [1, 1], rows: [1], cells: slots(2) });
    registerLayout({ id: '2v', label: '2 stacked', cols: [1], rows: [1, 1], cells: slots(2) });
    registerLayout({ id: '4', label: '4 grid', cols: [1, 1], rows: [1, 1], cells: slots(4) });
    registerLayout({ id: '8', label: '8 grid', cols: [1, 1, 1, 1], rows: [1, 1], cells: slots(8) });
}

/** Inline styles for the grid container + each cell — PURE (the workspace applies them). */
export function gridStyles(
    def: LayoutDefinition,
    trackSizes?: TrackSizes,
): { container: Record<string, string>; perCell: Record<string, Record<string, string>> } {
    const cols = trackSizes?.cols?.length === def.cols.length ? trackSizes.cols : def.cols;
    const rows = trackSizes?.rows?.length === def.rows.length ? trackSizes.rows : def.rows;
    const container: Record<string, string> = {
        display: 'grid',
        gridTemplateColumns: cols.map((w) => `${w}fr`).join(' '),
        gridTemplateRows: rows.map((w) => `${w}fr`).join(' '),
    };
    if (def.areas) container.gridTemplateAreas = def.areas.map((r) => `"${r}"`).join(' ');
    const perCell: Record<string, Record<string, string>> = {};
    for (const cell of def.cells) {
        perCell[cell.id] = cell.area ? { gridArea: cell.area } : {};
    }
    return { container, perCell };
}

/**
 * The active cell after a layout change: keep it when its slot survives, else fall
 * back to the first slot (the reducer behind `setLayout`; pure for tests).
 */
export function activeAfterLayout(current: string | null, cellIds: readonly string[]): string | null {
    if (current != null && cellIds.includes(current)) return current;
    return cellIds[0] ?? null;
}
