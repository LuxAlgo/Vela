import { Drawing, type AnchorSlot } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { pointInBox, handleAt } from '../hittest';

/**
 * A long/short position tool. Two clicks place the entry (anchor[0]) + stop (anchor[1]); onPlaced
 * derives the target (anchor[2]). Drives a shaded reward zone (entry↔target, green) and risk zone
 * (entry↔stop, red) with a computed risk:reward + target/stop percentages. The direction (LONG vs
 * SHORT) follows the geometry — a stop below the entry is long, above is short — so one tool covers both.
 */
export class PositionTool extends Drawing {
    readonly type = 'position' as const;

    /** Default reward:risk used to derive the target from the placed (or default) risk. */
    protected static readonly DEFAULT_RR = 2;
    /** Below this vertical drag (media px) a placement is treated as a bare click → default box. */
    private static readonly MIN_DRAG_PX = 6;
    private static readonly DEFAULT_RISK_PX = 64;
    private static readonly DEFAULT_WIDTH_PX = 150;
    private static readonly MIN_WIDTH_PX = 48;

    /** `'LONG'` or `'SHORT'`, computed from geometry so it flips live as the drag crosses the
     *  entry (target above entry → long; below → short). */
    directionLabel(): string {
        const p = this.prices();
        return p && p.target >= p.entry ? 'LONG' : 'SHORT';
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // Click-move-click: click 1 = entry, click 2 = stop (max 2 clicks finalize). onPlaced then
        // derives the target as a 3rd anchor. The 3 slots give all three handles their free axes.
        return {
            min: 2,
            max: 2,
            slots: [
                { role: 'entry', free: 'both' },
                { role: 'stop', free: 'both' },
                { role: 'target', free: 'both' },
            ],
        };
    }

    // Placed click-move-click (the inherited 'click' mode), consistent with the box/Gann/range tools.

    /**
     * Resolve the two placed anchors (entry + stop) into the final entry/stop/target box, computing
     * the target/width in PIXEL space so the box has a consistent visual size at any scale. The
     * direction follows the second click — a stop below the entry yields a long, above yields a short.
     * A degenerate second click (≈ the entry) falls back to a default-sized box.
     */
    override onPlaced(proj: Projector): void {
        const e = this.anchors[0];
        if (!e) return;
        const ex = proj.xOf(e.time);
        const ey = proj.yOf(e.price, this.paneId);
        if (ey == null) return;

        const s = this.anchors[1];
        const sy = s ? proj.yOf(s.price, this.paneId) : null;
        let stopPx: number;
        let endPx: number;
        if (s && sy != null && Math.abs(sy - ey) >= PositionTool.MIN_DRAG_PX) {
            stopPx = sy; // a real drag: the stop is where the user released
            endPx = ex + Math.max(Math.abs(proj.xOf(s.time) - ex), PositionTool.MIN_WIDTH_PX);
        } else {
            // a degenerate second click (≈ the entry): a default long-facing box (stop below the entry)
            stopPx = ey + PositionTool.DEFAULT_RISK_PX;
            endPx = ex + PositionTool.DEFAULT_WIDTH_PX;
        }
        const targetPx = ey - (stopPx - ey) * PositionTool.DEFAULT_RR; // reward at R:R on the far side
        const endTime = proj.pxToPoint(endPx, ey, this.paneId).time;
        this.anchors = [
            { time: e.time, price: e.price },
            { time: endTime, price: proj.pxToPoint(ex, stopPx, this.paneId).price },
            { time: endTime, price: proj.pxToPoint(ex, targetPx, this.paneId).price },
        ];
    }

    /**
     * Keep the stop (loss) and target (reward) on OPPOSITE sides of the entry. When a handle
     * drag would put them on the same side — e.g. dragging the stop of a long up past the entry
     * (flipping it to a short) — reflect the *other* side across the entry so the two never
     * collapse onto one direction. R:R (each side's distance from entry) is preserved.
     */
    override constrainHandleDrag(index: number): void {
        const entry = this.anchors[0];
        const stop = this.anchors[1];
        const target = this.anchors[2];
        if (!entry || !stop || !target) return;
        const stopSide = Math.sign(stop.price - entry.price);
        const targetSide = Math.sign(target.price - entry.price);
        if (stopSide === 0 || targetSide === 0 || stopSide !== targetSide) return; // already opposed (or on the line)
        // same side → flip whichever side was NOT the one being dragged across the entry
        if (index === 2) stop.price = 2 * entry.price - stop.price; // dragged target → flip the stop
        else target.price = 2 * entry.price - target.price; // dragged stop (or entry) → flip the target
    }

    /** The three levels — entry, stop, target — deriving the target while only two anchors exist
     *  (the live drag preview, before onPlaced sets the precise box). */
    private resolved(): Array<{ time: number; price: number }> | null {
        const e = this.anchors[0];
        const s = this.anchors[1];
        if (!e || !s) return null;
        const t = this.anchors[2] ?? { time: s.time, price: e.price + PositionTool.DEFAULT_RR * (e.price - s.price) };
        return [e, s, t];
    }

    private prices(): { entry: number; stop: number; target: number } | null {
        const r = this.resolved();
        return r ? { entry: r[0]!.price, stop: r[1]!.price, target: r[2]!.price } : null;
    }

    /** Risk:reward ratio = |target − entry| / |entry − stop| (0 when risk is degenerate). */
    rr(): number {
        const p = this.prices();
        if (!p) return 0;
        const risk = Math.abs(p.entry - p.stop);
        return risk < 1e-9 ? 0 : Math.abs(p.target - p.entry) / risk;
    }

    /** Reward % = |target − entry| / entry · 100. */
    rewardPct(): number {
        const p = this.prices();
        return p && p.entry !== 0 ? (Math.abs(p.target - p.entry) / p.entry) * 100 : 0;
    }

    /** Risk % = |entry − stop| / entry · 100. */
    riskPct(): number {
        const p = this.prices();
        return p && p.entry !== 0 ? (Math.abs(p.entry - p.stop) / p.entry) * 100 : 0;
    }

    private box(proj: Projector): { x1: number; x2: number; ey: number; sy: number; ty: number } | null {
        const pts = this.handlePoints(proj);
        if (pts.length < 3) return null;
        const xs = pts.map((p) => p[0]);
        return { x1: Math.min(...xs), x2: Math.max(...xs), ey: pts[0]![1], sy: pts[1]![1], ty: pts[2]![1] };
    }

    /** Pixel layout for the painter: the box x-range + each level's y. */
    layout(proj: Projector): { x1: number; x2: number; ey: number; sy: number; ty: number } | null {
        return this.box(proj);
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const b = this.box(proj);
        if (!b) return false;
        const top = Math.min(b.ey, b.sy, b.ty);
        const bot = Math.max(b.ey, b.sy, b.ty);
        return pointInBox(px, py, b.x1, top, b.x2, bot, tol);
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const r = this.resolved();
        if (!r) return [];
        const pts: Array<[number, number]> = [];
        for (const a of r) {
            const y = proj.yOf(a.price, this.paneId);
            if (y == null) return [];
            pts.push([proj.xOf(a.time), y]);
        }
        return pts;
    }

    hitHandle(px: number, py: number, proj: Projector, tol: number): number {
        return handleAt(px, py, this.handlePoints(proj), tol + 3);
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const b = this.box(proj);
        if (!b) return null;
        const y = Math.min(b.ey, b.sy, b.ty);
        return { x: b.x1, y, w: b.x2 - b.x1, h: Math.max(b.ey, b.sy, b.ty) - y };
    }

    priceRange(): { min: number; max: number } | null {
        const r = this.resolved();
        if (!r) return null;
        const ps = r.map((a) => a.price);
        return { min: Math.min(...ps), max: Math.max(...ps) };
    }

    schema(): SettingsSchema {
        return { fields: LINE_FIELDS.filter((f) => f.path !== 'style.lineColor') };
    }
}
