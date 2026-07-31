import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, TEXT_SIZE_OPTIONS } from '../schema';
import { pointInBox, handleAt } from '../hittest';
import { VALID, INVALID } from '../../palette';

/** How the gear panel's stop/target inputs interpret their value. */
export type PositionLevelMode = 'price' | 'points';

/** Choices for the direction select (long ↔ short mirrors the levels across the entry). */
export const DIRECTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'long', label: 'Long' },
    { value: 'short', label: 'Short' },
];

/**
 * A long/short position tool. Two clicks place the entry (anchor[0]) + target (anchor[1]);
 * onPlaced derives the stop (anchor[1] after finalize) and keeps the target as anchor[2]. The
 * second click is the *profit* direction — dragging higher from the entry paints the green
 * reward zone above (a long); dragging lower paints it below (a short). The shaded reward
 * (entry↔target) and risk (entry↔stop) zones carry a computed risk:reward, target/stop
 * percentages, and — from the account balance + risk % settings — a dollar loss and position
 * size. Zone colors, the label text (visibility, size, color, level prices), and the three
 * price levels are all editable through settings.
 */
export class PositionTool extends Drawing {
    readonly type = 'position' as const;

    /** Default reward:risk used to derive the stop from the placed (or default) target. */
    protected static readonly DEFAULT_RR = 2;
    /** Below this vertical drag (media px) a placement is treated as a bare click → default box. */
    private static readonly MIN_DRAG_PX = 6;
    private static readonly DEFAULT_RISK_PX = 64;
    private static readonly DEFAULT_WIDTH_PX = 150;
    private static readonly MIN_WIDTH_PX = 48;
    private static readonly DEFAULT_RISK_PERCENT = 1;
    private static readonly DEFAULT_ACCOUNT_BALANCE = 10_000;
    private static readonly DEFAULT_PROFIT_COLOR = VALID;
    private static readonly DEFAULT_LOSS_COLOR = INVALID;

    // Declared with `!` so a field default never clobbers readProps (base constructor runs first).
    /** Percent of account balance risked on the stop (drives dollar loss + position size). */
    riskPercent!: number;
    /** Account balance in dollars (drives dollar loss + position size). */
    accountBalance!: number;
    /** Master toggle for every painted label. */
    showText!: boolean;
    /** Show the `DIR · R:R` header line above the box. */
    showHeader!: boolean;
    /** Append the level price to the target/stop labels. */
    showPrices!: boolean;
    /** Show the `Loss $ · Size` line above the box. */
    showLossSize!: boolean;
    /** Show the `Target +%` label inside the reward zone. */
    showTargetLabel!: boolean;
    /** Show the `Stop −%` label inside the risk zone. */
    showStopLabel!: boolean;
    /** Fill + line color of the reward zone. */
    profitColor!: string;
    /** Fill + line color of the risk zone. */
    lossColor!: string;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (this.riskPercent === undefined) this.riskPercent = PositionTool.DEFAULT_RISK_PERCENT;
        if (this.accountBalance === undefined) this.accountBalance = PositionTool.DEFAULT_ACCOUNT_BALANCE;
        if (this.showText === undefined) this.showText = true;
        if (this.showHeader === undefined) this.showHeader = true;
        if (this.showPrices === undefined) this.showPrices = false;
        if (this.showLossSize === undefined) this.showLossSize = true;
        if (this.showTargetLabel === undefined) this.showTargetLabel = true;
        if (this.showStopLabel === undefined) this.showStopLabel = true;
        if (this.profitColor === undefined) this.profitColor = PositionTool.DEFAULT_PROFIT_COLOR;
        if (this.lossColor === undefined) this.lossColor = PositionTool.DEFAULT_LOSS_COLOR;
    }

    /** `'LONG'` or `'SHORT'`, computed from geometry so it flips live as the drag crosses the
     *  entry (target above entry → long; below → short). */
    directionLabel(): string {
        const p = this.prices();
        return p && p.target >= p.entry ? 'LONG' : 'SHORT';
    }

    /** Direction as a settings path: reading reflects the geometry; writing the opposite value
     *  mirrors the stop AND the target across the entry, turning the trade around in place
     *  while preserving each side's distance (and therefore the R:R). */
    get direction(): 'long' | 'short' {
        return this.directionLabel() === 'LONG' ? 'long' : 'short';
    }
    set direction(v: 'long' | 'short') {
        const entry = this.anchors[0];
        const stop = this.anchors[1];
        const target = this.anchors[2];
        if (!entry || !stop || !target) return;
        if ((v === 'long' || v === 'short') && v !== this.direction) {
            stop.price = 2 * entry.price - stop.price;
            target.price = 2 * entry.price - target.price;
        }
    }

    /** Position size as a settings path: reading returns the computed size; writing back-solves
     *  the risk % so that `size × stop distance = balance × risk%` holds for the typed size. */
    get quantity(): number {
        return this.positionSize();
    }
    set quantity(v: number) {
        const p = this.prices();
        if (!p || !Number.isFinite(v) || v < 0) return;
        const dist = Math.abs(p.entry - p.stop);
        if (dist < 1e-9 || this.accountBalance <= 0) return;
        this.riskPercent = ((v * dist) / this.accountBalance) * 100;
    }

    // ── price levels as settings paths (the gear panel patches these directly) ──

    get entryPrice(): number {
        return this.anchors[0]?.price ?? 0;
    }
    set entryPrice(v: number) {
        const a = this.anchors[0];
        if (a && Number.isFinite(v)) {
            a.price = v;
            this.constrainHandleDrag(0);
        }
    }

    get stopPrice(): number {
        return this.anchors[1]?.price ?? 0;
    }
    set stopPrice(v: number) {
        const a = this.anchors[1];
        if (a && Number.isFinite(v)) {
            a.price = v;
            this.constrainHandleDrag(1);
        }
    }

    get targetPrice(): number {
        return this.anchors[2]?.price ?? 0;
    }
    set targetPrice(v: number) {
        const a = this.anchors[2];
        if (a && Number.isFinite(v)) {
            a.price = v;
            this.constrainHandleDrag(2);
        }
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // Click-move-click: click 1 = entry, click 2 = target (max 2 clicks finalize). onPlaced then
        // derives the stop and rewrites anchors as [entry, stop, target]. The 3 slots give all three
        // handles their free axes after placement.
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
     * Resolve the two placed anchors (entry + target) into the final entry/stop/target box,
     * computing the stop/width in PIXEL space so the box has a consistent visual size at any
     * scale. The second click is the profit direction — a target above the entry yields a long
     * (stop below); below yields a short. A degenerate second click (≈ the entry) falls back to
     * a default-sized long-facing box.
     */
    override onPlaced(proj: Projector): void {
        const e = this.anchors[0];
        if (!e) return;
        const ex = proj.xOf(e.time);
        const ey = proj.yOf(e.price, this.paneId);
        if (ey == null) return;

        const t = this.anchors[1];
        const ty = t ? proj.yOf(t.price, this.paneId) : null;
        let targetPx: number;
        let endPx: number;
        if (t && ty != null && Math.abs(ty - ey) >= PositionTool.MIN_DRAG_PX) {
            targetPx = ty; // a real drag: the target (profit) is where the user released
            endPx = ex + Math.max(Math.abs(proj.xOf(t.time) - ex), PositionTool.MIN_WIDTH_PX);
        } else {
            // a degenerate second click (≈ the entry): a default long-facing box (target above)
            targetPx = ey - PositionTool.DEFAULT_RISK_PX * PositionTool.DEFAULT_RR;
            endPx = ex + PositionTool.DEFAULT_WIDTH_PX;
        }
        // stop on the opposite side of the entry at 1/R:R of the reward distance
        const stopPx = ey - (targetPx - ey) / PositionTool.DEFAULT_RR;
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

    /** The three levels — entry, stop, target — deriving the stop while only two anchors exist
     *  (the live drag preview, before onPlaced sets the precise box). During preview the second
     *  anchor is the target (profit); after placement anchors are [entry, stop, target]. */
    private resolved(): Array<{ time: number; price: number }> | null {
        const e = this.anchors[0];
        const a1 = this.anchors[1];
        if (!e || !a1) return null;
        if (this.anchors[2]) return [e, a1, this.anchors[2]];
        // live preview: a1 is the target; stop sits opposite at 1/R:R of the reward
        const stop = {
            time: a1.time,
            price: e.price - (a1.price - e.price) / PositionTool.DEFAULT_RR,
        };
        return [e, stop, a1];
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

    /** Risk % of price = |entry − stop| / entry · 100 (distinct from the account riskPercent). */
    riskPct(): number {
        const p = this.prices();
        return p && p.entry !== 0 ? (Math.abs(p.entry - p.stop) / p.entry) * 100 : 0;
    }

    /** Dollar amount risked at the stop = accountBalance × riskPercent / 100. */
    dollarLoss(): number {
        return Math.max(0, this.accountBalance) * (Math.max(0, this.riskPercent) / 100);
    }

    /** Position size in units = dollarLoss / |entry − stop| (0 when risk is degenerate). */
    positionSize(): number {
        const p = this.prices();
        if (!p) return 0;
        const risk = Math.abs(p.entry - p.stop);
        return risk < 1e-9 ? 0 : this.dollarLoss() / risk;
    }

    // ── painted label lines (each respects its own toggle; the painter checks showText) ──

    /** `DIR · R:R x.xx` — the always-on header when text is shown. */
    headerLabel(): string {
        return `${this.directionLabel()}  ·  R:R ${this.rr().toFixed(2)}`;
    }

    /** `Loss $… · Size …` — the painter hides it when showLossSize is off. */
    lossSizeLabel(): string {
        return `Loss $${formatMoney(this.dollarLoss())}  ·  Size ${formatQty(this.positionSize())}`;
    }

    /** `Target +x.xx%`, with the level price appended when showPrices is on. */
    targetLabel(): string {
        const p = this.prices();
        const at = this.showPrices && p ? `  @ ${formatPrice(p.target)}` : '';
        return `Target +${this.rewardPct().toFixed(2)}%${at}`;
    }

    /** `Stop −x.xx%`, with the level price appended when showPrices is on. */
    stopLabel(): string {
        const p = this.prices();
        const at = this.showPrices && p ? `  @ ${formatPrice(p.stop)}` : '';
        return `Stop −${this.riskPct().toFixed(2)}%${at}`;
    }

    // ── stop/target input units (the gear panel's Price / Points dropdowns) ──

    /** The stop or target expressed in the given unit: the absolute price, or the distance from
     *  the entry in price points. */
    levelDisplayValue(level: 'stop' | 'target', mode: PositionLevelMode): number {
        const p = this.prices();
        if (!p) return 0;
        const price = level === 'stop' ? p.stop : p.target;
        if (mode === 'price') return roundFloat(price);
        return roundFloat(Math.abs(price - p.entry));
    }

    /** The absolute price a typed value in the given unit resolves to. Points measure the
     *  distance from the entry; the level keeps its current side (target defaults to the profit
     *  side, stop to the loss side, when it sits exactly on the entry). */
    levelPriceFromDisplay(level: 'stop' | 'target', mode: PositionLevelMode, value: number): number {
        const p = this.prices();
        if (!p || mode === 'price') return value;
        const current = level === 'stop' ? p.stop : p.target;
        let side = Math.sign(current - p.entry);
        if (side === 0) side = (level === 'target' ? 1 : -1) * (this.direction === 'long' ? 1 : -1);
        return p.entry + side * Math.abs(value);
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
        return {
            fields: [
                { path: 'riskPercent', label: 'Risk %', kind: 'number', min: 0, max: 100, step: 0.1, group: 'behavior' },
                { path: 'accountBalance', label: 'Account balance', kind: 'number', min: 0, max: 1e12, step: 1, group: 'behavior' },
                { path: 'quantity', label: 'Position size', kind: 'number', group: 'behavior' },
                { path: 'direction', label: 'Direction', kind: 'select', options: DIRECTION_OPTIONS, group: 'behavior' },
                { path: 'entryPrice', label: 'Entry price', kind: 'number', group: 'behavior' },
                { path: 'stopPrice', label: 'Stop price', kind: 'number', group: 'behavior' },
                { path: 'targetPrice', label: 'Target price', kind: 'number', group: 'behavior' },
                { path: 'showText', label: 'Show text', kind: 'boolean', group: 'behavior' },
                { path: 'showHeader', label: 'Show direction & ratio', kind: 'boolean', group: 'behavior' },
                { path: 'showLossSize', label: 'Show loss & size', kind: 'boolean', group: 'behavior' },
                { path: 'showTargetLabel', label: 'Show target label', kind: 'boolean', group: 'behavior' },
                { path: 'showStopLabel', label: 'Show stop label', kind: 'boolean', group: 'behavior' },
                { path: 'showPrices', label: 'Show level prices', kind: 'boolean', group: 'behavior' },
                { path: 'profitColor', label: 'Profit zone', kind: 'color', group: 'fill' },
                { path: 'lossColor', label: 'Loss zone', kind: 'color', group: 'fill' },
                ...LINE_FIELDS.filter((f) => f.path !== 'style.lineColor'),
                { path: 'text.color', label: 'Text color', kind: 'color', group: 'text' },
                { path: 'text.size', label: 'Text size', kind: 'select', options: TEXT_SIZE_OPTIONS, group: 'text' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return {
            riskPercent: this.riskPercent,
            accountBalance: this.accountBalance,
            showText: this.showText,
            showHeader: this.showHeader,
            showPrices: this.showPrices,
            showLossSize: this.showLossSize,
            showTargetLabel: this.showTargetLabel,
            showStopLabel: this.showStopLabel,
            profitColor: this.profitColor,
            lossColor: this.lossColor,
        };
    }

    protected override readProps(props: Record<string, unknown>): void {
        if (typeof props.riskPercent === 'number' && Number.isFinite(props.riskPercent)) {
            this.riskPercent = props.riskPercent;
        }
        if (typeof props.accountBalance === 'number' && Number.isFinite(props.accountBalance)) {
            this.accountBalance = props.accountBalance;
        }
        if (typeof props.showText === 'boolean') this.showText = props.showText;
        if (typeof props.showHeader === 'boolean') this.showHeader = props.showHeader;
        if (typeof props.showPrices === 'boolean') this.showPrices = props.showPrices;
        if (typeof props.showLossSize === 'boolean') this.showLossSize = props.showLossSize;
        if (typeof props.showTargetLabel === 'boolean') this.showTargetLabel = props.showTargetLabel;
        if (typeof props.showStopLabel === 'boolean') this.showStopLabel = props.showStopLabel;
        if (typeof props.profitColor === 'string') this.profitColor = props.profitColor;
        if (typeof props.lossColor === 'string') this.lossColor = props.lossColor;
    }
}

/** Compact money string (drops trailing .00; keeps two decimals otherwise). */
function formatMoney(n: number): string {
    if (!Number.isFinite(n)) return '0';
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/** Compact quantity string for the position size readout. */
function formatQty(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '0';
    if (n >= 100) return n.toFixed(2);
    if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, '');
    return n.toPrecision(4).replace(/\.?0+$/, '');
}

/** Compact price string for the level readouts (two decimals ≥1, four significant below). */
function formatPrice(n: number): string {
    if (!Number.isFinite(n)) return '0';
    if (Math.abs(n) >= 1) return n.toFixed(2);
    return n.toPrecision(4).replace(/\.?0+$/, '');
}

/** Trim binary float noise from a converted value (points arithmetic). */
function roundFloat(n: number): number {
    return Math.round(n * 1e8) / 1e8;
}
