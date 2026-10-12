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
import { svg16 } from '../core/icons';

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

// ── dynamic layouts (the topbar's grid picker) ──────────────────────────────
//
// The picker composes UNIFORM rows×cols grids on a bounded canvas instead of choosing
// from a fixed list. Dynamic definitions are NOT registered — their ids are
// self-describing (`g3x2`) and `ensureLayout` re-synthesizes them, so persisted picks
// restore across boots without polluting the plugin registry.

/** Picker canvas bound — dynamic layouts stay within a 4×4 grid (16 cells, the
 *  workspace's dormant-state pool capacity). */
export const GRID_PICKER_MAX = 4;

/** Classic preset ids by uniform geometry, so grid picks land on the builtins. */
const GRID_BUILTIN_IDS: Record<string, string> = {
    '1x1': '1',
    '1x2': '2h',
    '2x1': '2v',
    '2x2': '4',
    '2x4': '8',
};

const clampTrack = (n: number): number => Math.max(1, Math.min(GRID_PICKER_MAX, Math.round(n)));

/**
 * The layout for a UNIFORM rows×cols grid (Grid picker mode), clamped to the
 * picker canvas. Geometry matching a registered classic preset returns that preset
 * (id `'4'`, `'2h'`, …); anything else synthesizes a `g<rows>x<cols>` definition.
 */
export function layoutForGrid(rows: number, cols: number): LayoutDefinition {
    const r = clampTrack(rows);
    const c = clampTrack(cols);
    const builtin = GRID_BUILTIN_IDS[`${r}x${c}`];
    const registered = builtin ? registry.get(builtin) : undefined;
    if (registered) return registered;
    return {
        id: `g${r}x${c}`,
        // Width-first label — matches the picker's caption ("3 × 2" = 3 wide, 2 tall).
        label: `${c} × ${r} grid`,
        cols: Array.from({ length: c }, () => 1),
        rows: Array.from({ length: r }, () => 1),
        cells: slots(r * c),
    };
}

const GRID_ID_RE = /^g([1-4])x([1-4])$/;

/**
 * Resolve a layout id to its definition, synthesizing the picker's dynamic ids
 * (`g<rows>x<cols>`) when they are not registered — the boot path for persisted
 * picks. Unknown ids stay undefined.
 */
export function ensureLayout(id: string): LayoutDefinition | undefined {
    const registered = registry.get(id);
    if (registered) return registered;
    const g = GRID_ID_RE.exec(id);
    if (g) return layoutForGrid(Number(g[1]), Number(g[2]));
    return undefined;
}

/** A layout's shape on the picker canvas. */
export type LayoutShape = { rows: number; cols: number };

/**
 * The picker-canvas shape of a layout: `{rows, cols}` for uniform grids, `null`
 * when the layout is not expressible on the canvas (bespoke plugin presets) —
 * pickers list those as labeled rows instead.
 */
export function layoutShape(def: LayoutDefinition): LayoutShape | null {
    if (
        !def.areas &&
        def.rows.length <= GRID_PICKER_MAX &&
        def.cols.length <= GRID_PICKER_MAX &&
        def.cells.length === def.rows.length * def.cols.length
    ) {
        return { rows: def.rows.length, cols: def.cols.length };
    }
    return null;
}

/**
 * Which slot occupies each `[row][col]` track — PURE. Area layouts read their
 * `grid-template-areas` rows; auto-flow layouts place `cells` row-major. The grid is
 * what the splitter layer segments its strips against: a boundary is only a real seam
 * where the two neighboring tracks hold DIFFERENT slots.
 */
export function occupancyGrid(def: LayoutDefinition): string[][] {
    if (def.areas) return def.areas.map((row) => row.trim().split(/\s+/));
    const cols = def.cols.length;
    return def.rows.map((_, r) => def.cols.map((_, c) => def.cells[r * cols + c]?.id ?? `·${r}x${c}`));
}

/** The glyph's frame: a 13px square inset 1.5px in the 16px box. */
const GLYPH_MIN = 1.5;
const GLYPH_SPAN = 13;

/** Track boundaries on the glyph frame, proportional to the declared weights. */
function glyphStops(weights: readonly number[], n: number): number[] {
    const w = Array.from({ length: n }, (_, i) => {
        const v = weights[i];
        return v !== undefined && Number.isFinite(v) && v > 0 ? v : 1;
    });
    const total = w.reduce((a, b) => a + b, 0);
    const stops = [GLYPH_MIN];
    let acc = 0;
    for (const v of w) {
        acc += v;
        stops.push(Math.round((GLYPH_MIN + (GLYPH_SPAN * acc) / total) * 100) / 100);
    }
    return stops;
}

/**
 * A 16px line glyph of a layout's cell arrangement (`<svg>` markup) — PURE. The frame
 * is the whole grid; a seam is drawn only where two neighboring tracks hold DIFFERENT
 * slots (the {@link occupancyGrid} rule the splitters follow), so a cell spanning
 * several tracks reads as one. Seams sit at the declared track weights.
 */
export function layoutGlyph(def: LayoutDefinition): string {
    const grid = occupancyGrid(def);
    const rows = grid.length;
    const cols = grid.reduce((n, row) => Math.max(n, row.length), 0);
    const xs = glyphStops(def.cols, cols);
    const ys = glyphStops(def.rows, rows);
    const at = (r: number, c: number): string | undefined => grid[r]?.[c];
    const seams: string[] = [];
    for (let c = 1; c < cols; c += 1) {
        let start = -1;
        for (let r = 0; r <= rows; r += 1) {
            const split = r < rows && at(r, c - 1) !== at(r, c);
            if (split && start < 0) start = r;
            if (!split && start >= 0) {
                seams.push(`M${xs[c]} ${ys[start]}V${ys[r]}`);
                start = -1;
            }
        }
    }
    for (let r = 1; r < rows; r += 1) {
        let start = -1;
        for (let c = 0; c <= cols; c += 1) {
            const split = c < cols && at(r - 1, c) !== at(r, c);
            if (split && start < 0) start = c;
            if (!split && start >= 0) {
                seams.push(`M${xs[start]} ${ys[r]}H${xs[c]}`);
                start = -1;
            }
        }
    }
    const frame = `<rect x="${GLYPH_MIN}" y="${GLYPH_MIN}" width="${GLYPH_SPAN}" height="${GLYPH_SPAN}" rx="1.5"/>`;
    return svg16(seams.length > 0 ? `${frame}<path d="${seams.join('')}"/>` : frame);
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

/**
 * The identity order after a layout change: shrinking the grid must never pool the
 * ACTIVE chart, so an active identity that would fall past the new slot count moves
 * into the LAST surviving slot — every other identity keeps its relative order
 * (the order reducer behind `setLayout`; pure for tests).
 */
export function orderAfterLayout(order: readonly string[], slots: number, active: string | null): string[] {
    const next = [...order];
    if (active == null || slots <= 0) return next;
    const idx = next.indexOf(active);
    if (idx < 0 || idx < slots) return next;
    next.splice(idx, 1);
    next.splice(slots - 1, 0, active);
    return next;
}
