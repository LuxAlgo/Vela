import type { VelaTheme } from '../../../core/options';
import type { DrawingTable } from '../../../core/model/drawings';
import type { CoordinateSystem } from '../core/CoordinateSystem';
import type { SceneGraph, PaneNode, DrawingSlice } from '../core/SceneGraph';
import {
    DrawingSceneRenderer,
    modelDrawingSet,
    drawingSetEmpty,
    type DrawingSet,
    type LabelTipRegion,
} from '../../shared/DrawingSceneRenderer';
import { paintTable } from '../../shared/TableCanvasRenderer';

/**
 * The slice key for an indicator's drawings: the first series boundary STRICTLY above
 * the model's z — the drawings composite above the model's own series (a tie in
 * `sliceKeyFor` terms would put them under it) but below the next slot — or Infinity
 * when the model tops its pane's stack (composited above the force_overlay series).
 */
export function indicatorSliceKey(z: number, boundaries: readonly number[]): number {
    return boundaries.find((b) => b > z) ?? Infinity;
}

/** One model's contribution to a slice canvas: its drawing set + tables painted against
 *  a pane (whose `scale` is already the model's effective one) at its index offset. */
interface SliceEntry {
    set: DrawingSet;
    tables: DrawingTable[];
    pane: PaneNode;
    indexOffset: number;
}

/**
 * Prepaints each indicator's Pine drawings (line/box/label/polyline/linefill) AND its
 * tables into interleave-layer canvases the geometry backend composites into the
 * pane's series stack — the same {@link DrawingSlice} contract user drawings ride.
 * Keyed at the first series boundary STRICTLY ABOVE the owning model's z, they paint
 * over the model's own series but under everything stacked higher (candles included),
 * so the whole model moves as one unit when its object-tree row is reordered.
 * force_overlay content paints on the price pane above its whole stack (`Infinity`),
 * mirroring where force_overlay series paint.
 *
 * Also collects the label + table-cell tooltip hit-rects (plot space) each frame —
 * painting moved off the chrome canvas / DOM, so the tooltip lookup lives here now.
 */
export class IndicatorDrawingSlices {
    private readonly drawScene = new DrawingSceneRenderer({ timeToLogical: () => 0, barAt: () => null, theme: {} as VelaTheme });
    /** Slice canvas cache, keyed `paneId|beforeZ` — same lifecycle as the user-drawing cache. */
    private readonly sliceCache = new Map<string, HTMLCanvasElement>();
    /** Tooltip hit-rects of every label drawn this frame, in plot coords (rebuilt per prepare). */
    private tips: LabelTipRegion[] = [];

    /**
     * Rebuild the per-indicator drawing slices for this data frame. `ref` is the data
     * canvas the slices must match pixel-for-pixel (the backend composites them 1:1).
     * Runs from the renderer's data paint, just before the backend composites the scene.
     */
    prepare(scene: SceneGraph, coords: CoordinateSystem, theme: VelaTheme, ref: HTMLCanvasElement): Map<string, DrawingSlice[]> {
        this.tips = [];
        const out = new Map<string, DrawingSlice[]>();
        if (ref.width === 0 || ref.height === 0) {
            this.sliceCache.clear();
            return out;
        }
        this.drawScene.setDeps({
            timeToLogical: (ms) => coords.timeToLogical(ms),
            barAt: (logical) => {
                const b = scene.bars[Math.round(logical)];
                return b ? { high: b.high, low: b.low } : null;
            },
            theme,
        });
        const dpr = coords.dpr;
        const dataW = coords.width;

        // Bucket the models' drawing sets by `paneId|beforeZ`. Own models iterate in
        // ascending z (their relative stacking inside a shared canvas), force_overlay
        // sets append last — they paint over the price pane's whole pile, as before.
        const buckets = new Map<string, { paneId: string; beforeZ: number; entries: SliceEntry[] }>();
        const add = (paneId: string, beforeZ: number, entry: SliceEntry): void => {
            const key = `${paneId}|${beforeZ}`;
            const bucket = buckets.get(key);
            if (bucket) bucket.entries.push(entry);
            else buckets.set(key, { paneId, beforeZ, entries: [entry] });
        };
        for (const pane of scene.orderedPanes()) {
            if (pane.collapsed) continue; // collapsed strip: legend only, no drawings
            const boundaries = scene.seriesBoundaries(pane.id);
            for (const m of scene.orderedIndicatorsForPane(pane.id)) {
                const set = modelDrawingSet(m, false);
                const tables = (m.tables ?? []).filter((t) => !t.overlay);
                if (drawingSetEmpty(set) && tables.length === 0) continue;
                // A merged (own-scale) indicator's drawings follow its own scale column.
                const sc = scene.scaleFor(m, pane);
                const mp = sc === pane.scale ? pane : { ...pane, scale: sc };
                const beforeZ = indicatorSliceKey(scene.zOf(m.id), boundaries);
                add(pane.id, beforeZ, { set, tables, pane: mp, indexOffset: scene.offsetOf(m.id) });
            }
            if (pane.kind === 'price') {
                for (const m of scene.indicators.values()) {
                    const set = modelDrawingSet(m, true);
                    const tables = (m.tables ?? []).filter((t) => t.overlay === true);
                    if (drawingSetEmpty(set) && tables.length === 0) continue;
                    add(pane.id, Infinity, { set, tables, pane, indexOffset: scene.offsetOf(m.id) });
                }
            }
        }

        for (const [key, { paneId, beforeZ, entries }] of buckets) {
            let canvas = this.sliceCache.get(key);
            if (!canvas) {
                canvas = document.createElement('canvas');
                this.sliceCache.set(key, canvas);
            }
            if (canvas.width !== ref.width || canvas.height !== ref.height) {
                canvas.width = ref.width;
                canvas.height = ref.height;
            }
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            for (const e of entries) this.paintEntry(ctx, e, coords, dataW, theme);
            const slices = out.get(paneId) ?? [];
            slices.push({ beforeZ, canvas });
            out.set(paneId, slices);
        }
        for (const key of [...this.sliceCache.keys()]) if (!buckets.has(key)) this.sliceCache.delete(key); // drop stale layers
        for (const slices of out.values()) slices.sort((a, b) => a.beforeZ - b.beforeZ);
        return out;
    }

    private paintEntry(ctx: CanvasRenderingContext2D, e: SliceEntry, coords: CoordinateSystem, dataW: number, theme: VelaTheme): void {
        const { pane } = e;
        const paneTips: LabelTipRegion[] = [];
        ctx.save();
        ctx.translate(0, pane.bounds.top); // pane-relative space (drawings use [0, H])
        ctx.beginPath();
        ctx.rect(0, 0, dataW, pane.bounds.height);
        ctx.clip();
        this.drawScene.setSet(e.set, e.indexOffset);
        this.drawScene.render(
            ctx,
            dataW,
            pane.bounds.height,
            (l) => coords.logicalToX(l),
            (price) => coords.priceToY(price, pane.scale, pane.bounds) - pane.bounds.top,
        );
        paneTips.push(...this.drawScene.labelTipRegions());
        // Tables paint over the model's other drawings — the pane-corner dashboard reads
        // above its own lines/labels, as the DOM overlay used to.
        for (const t of e.tables) paintTable(ctx, t, { paneHeight: pane.bounds.height, plotWidth: dataW, theme }, paneTips);
        ctx.restore();
        // Collect this entry's tooltip rects, shifted from pane space into plot space.
        for (const r of paneTips) {
            this.tips.push({ ...r, top: r.top + pane.bounds.top, bottom: r.bottom + pane.bounds.top });
        }
    }

    /** Tooltip of the topmost label or table cell under a plot-space point, or null. Fed by the last prepare. */
    labelTooltipAt(x: number, y: number): string | null {
        for (let i = this.tips.length - 1; i >= 0; i -= 1) {
            const r = this.tips[i]!;
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return r.text;
        }
        return null;
    }
}

/**
 * Merge the indicator slices with the user-drawing slices into one per-pane, z-sorted
 * list for the backend. On a shared `beforeZ` the indicator content composites first
 * (user drawings stay on top of engine output at the same slot).
 */
export function mergeSlices(
    indicator: ReadonlyMap<string, DrawingSlice[]>,
    user: ReadonlyMap<string, ReadonlyArray<DrawingSlice>>,
): ReadonlyMap<string, DrawingSlice[]> {
    const out = new Map<string, DrawingSlice[]>();
    for (const [paneId, slices] of indicator) out.set(paneId, [...slices]);
    for (const [paneId, slices] of user) out.set(paneId, [...(out.get(paneId) ?? []), ...slices]);
    for (const slices of out.values()) slices.sort((a, b) => a.beforeZ - b.beforeZ); // stable: ties keep indicator-first
    return out;
}
