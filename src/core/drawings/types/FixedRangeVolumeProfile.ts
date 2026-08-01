import { Drawing, type AnchorSlot, type SerializedDrawing } from '../Drawing';
import type { LineStyle } from '../../model/series';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_STYLE_OPTIONS } from '../schema';
import { pointInPolygon, handleAt, distToSegment } from '../hittest';
import { ACCENT, BEARISH, BULLISH, NEUTRAL } from '../../palette';

/** One OHLCV bar the fixed-range profile buckets (estimation uses O/H/L/C + volume). */
export interface FrvpBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** One profile row: `[price, price + rowH)` with the up/down volume that landed in it. */
export interface FrvpRow {
    /** The row's LOWER price bound. */
    price: number;
    up: number;
    down: number;
}

/** The bucketed fixed-range volume-by-price profile. */
export interface FrvpProfile {
    rows: FrvpRow[];
    rowH: number;
    min: number;
    maxTotal: number;
    poc: number;
    vaFrom: number;
    vaTo: number;
}

/** One sample of a developing level (POC / VA edge) at a bar's time. */
export interface FrvpDevelopingPoint {
    time: number;
    price: number;
}

/** Cosmetics + behavior for the fixed-range volume profile (round-trips through `props`). */
export interface FrvpStyle {
    /** Number of equal-height price rows. */
    rows: number;
    /** Value-area coverage as a percent of total volume (0–100). */
    valueAreaPct: number;
    /** Profile width as a percent of the anchor time-span (0–100). */
    widthPct: number;
    /** Which side of the range the histogram grows from. */
    anchor: 'left' | 'right';
    /** Buy / up volume outside the value area (typically translucent). */
    upColor: string;
    /** Sell / down volume outside the value area (typically translucent). */
    downColor: string;
    /** Buy / up volume inside the value area. */
    vaUpColor: string;
    /** Sell / down volume inside the value area. */
    vaDownColor: string;
    showVah: boolean;
    vahColor: string;
    vahStyle: LineStyle;
    showVal: boolean;
    valColor: string;
    valStyle: LineStyle;
    showPoc: boolean;
    pocColor: string;
    pocStyle: LineStyle;
    showDevelopingPoc: boolean;
    developingPocColor: string;
    developingPocStyle: LineStyle;
    showDevelopingVa: boolean;
    developingVaColor: string;
    developingVaStyle: LineStyle;
}

/** Outside-VA fills at 25% transparency; value-area fills at 60% transparency. */
const OUTSIDE_UP = `${BULLISH}BF`;
const OUTSIDE_DOWN = `${BEARISH}BF`;
const VA_UP = `${BULLISH}66`;
const VA_DOWN = `${BEARISH}66`;

function defaultFrvpStyle(): FrvpStyle {
    return {
        rows: 24,
        valueAreaPct: 70,
        widthPct: 35,
        anchor: 'left',
        upColor: OUTSIDE_UP,
        downColor: OUTSIDE_DOWN,
        vaUpColor: VA_UP,
        vaDownColor: VA_DOWN,
        showVah: true,
        vahColor: NEUTRAL,
        vahStyle: 'solid',
        showVal: true,
        valColor: NEUTRAL,
        valStyle: 'solid',
        showPoc: true,
        pocColor: ACCENT,
        pocStyle: 'solid',
        showDevelopingPoc: false,
        developingPocColor: ACCENT,
        developingPocStyle: 'dotted',
        showDevelopingVa: false,
        developingVaColor: ACCENT,
        developingVaStyle: 'dotted',
    };
}

function clampIndex(k: number, n: number): number {
    return k < 0 ? 0 : k >= n ? n - 1 : k;
}

/**
 * Grow the value area from the POC by repeatedly absorbing the larger adjacent row until
 * accumulated volume covers `valueAreaFrac` of the total.
 */
function growValueArea(rows: readonly FrvpRow[], poc: number, valueAreaFrac: number): { vaFrom: number; vaTo: number } {
    const n = rows.length;
    let total = 0;
    let maxTotal = 0;
    for (let k = 0; k < n; k += 1) {
        const t = rows[k]!.up + rows[k]!.down;
        total += t;
        if (t > maxTotal) maxTotal = t;
    }
    const target = total * Math.min(1, Math.max(0, valueAreaFrac));
    let vaFrom = poc;
    let vaTo = poc;
    let acc = maxTotal;
    while (acc < target && (vaFrom > 0 || vaTo < n - 1)) {
        const below = vaFrom > 0 ? rows[vaFrom - 1]!.up + rows[vaFrom - 1]!.down : -1;
        const above = vaTo < n - 1 ? rows[vaTo + 1]!.up + rows[vaTo + 1]!.down : -1;
        if (above > below) {
            vaTo += 1;
            acc += above;
        } else {
            vaFrom -= 1;
            acc += below;
        }
    }
    return { vaFrom, vaTo };
}

/** Add one bar's volume into `rows` using the estimation rule (any OHLC in a row → full volume). */
function accumulateBar(rows: FrvpRow[], min: number, rowH: number, bar: FrvpBar): void {
    const v = bar.volume;
    if (!(v > 0)) return;
    const n = rows.length;
    const side = bar.close >= bar.open ? 'up' : 'down';
    const hit = new Set<number>();
    for (const p of [bar.open, bar.high, bar.low, bar.close]) {
        hit.add(clampIndex(Math.floor((p - min) / rowH), n));
    }
    for (const k of hit) rows[k]![side] += v;
}

/** POC index + max row total, or null when every row is empty. */
function findPoc(rows: readonly FrvpRow[]): { poc: number; maxTotal: number } | null {
    let maxTotal = 0;
    let poc = 0;
    for (let k = 0; k < rows.length; k += 1) {
        const t = rows[k]!.up + rows[k]!.down;
        if (t > maxTotal) {
            maxTotal = t;
            poc = k;
        }
    }
    return maxTotal > 0 ? { poc, maxTotal } : null;
}

/**
 * Estimation-based volume profile: for each bar, the full bar volume is added to every
 * price row that contains **any** of its OHLC prices (open / high / low / close). Volume
 * is split up/down by bar direction (`close >= open`). Unlike a proportional H–L
 * distribution this does not conserve total volume across rows — a wide bar can contribute
 * to several rows. Returns null when the window holds no volume.
 */
export function buildEstimatedProfile(
    bars: readonly FrvpBar[],
    rowCount: number,
    valueAreaFrac: number,
): FrvpProfile | null {
    let min = Infinity;
    let max = -Infinity;
    for (const b of bars) {
        if (!(b.volume > 0)) continue;
        if (b.low < min) min = b.low;
        if (b.high > max) max = b.high;
    }
    if (!Number.isFinite(min)) return null;

    const n = max > min ? Math.max(1, Math.round(rowCount)) : 1;
    const rowH = max > min ? (max - min) / n : 1;
    const rows: FrvpRow[] = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));

    for (const b of bars) accumulateBar(rows, min, rowH, b);

    const pocInfo = findPoc(rows);
    if (!pocInfo) return null;
    const { poc, maxTotal } = pocInfo;
    const { vaFrom, vaTo } = growValueArea(rows, poc, valueAreaFrac);
    return { rows, rowH, min, maxTotal, poc, vaFrom, vaTo };
}

/** Full compute for paint: the final profile plus optional developing POC / VA polylines. */
export interface FrvpCompute {
    profile: FrvpProfile;
    /** Mid-price of the POC row after each successive bar. */
    developingPoc: FrvpDevelopingPoint[];
    /** Top of the value area after each successive bar. */
    developingVaHigh: FrvpDevelopingPoint[];
    /** Bottom of the value area after each successive bar. */
    developingVaLow: FrvpDevelopingPoint[];
}

/**
 * Build the fixed-range profile over `bars` and (when requested) the developing POC / VA
 * series. Developing levels accumulate into the **final** price grid bar-by-bar (same
 * min / rowH / row count as the finished profile) — so the lines track how POC and the
 * value area evolve as the range fills, rather than re-bucketing a changing price span.
 */
export function computeFixedRangeProfile(
    bars: readonly FrvpBar[],
    rowCount: number,
    valueAreaFrac: number,
    wantDeveloping: boolean,
): FrvpCompute | null {
    const profile = buildEstimatedProfile(bars, rowCount, valueAreaFrac);
    if (!profile) return null;
    if (!wantDeveloping || bars.length < 1) {
        return { profile, developingPoc: [], developingVaHigh: [], developingVaLow: [] };
    }

    const { min, rowH } = profile;
    const n = profile.rows.length;
    const rows: FrvpRow[] = Array.from({ length: n }, (_, k) => ({ price: min + k * rowH, up: 0, down: 0 }));
    const developingPoc: FrvpDevelopingPoint[] = [];
    const developingVaHigh: FrvpDevelopingPoint[] = [];
    const developingVaLow: FrvpDevelopingPoint[] = [];

    for (const bar of bars) {
        accumulateBar(rows, min, rowH, bar);
        const pocInfo = findPoc(rows);
        if (!pocInfo) continue;
        const { poc } = pocInfo;
        const { vaFrom, vaTo } = growValueArea(rows, poc, valueAreaFrac);
        developingPoc.push({ time: bar.time, price: rows[poc]!.price + rowH / 2 });
        developingVaHigh.push({ time: bar.time, price: rows[vaTo]!.price + rowH });
        developingVaLow.push({ time: bar.time, price: rows[vaFrom]!.price });
    }

    return { profile, developingPoc, developingVaHigh, developingVaLow };
}

/** Pixel geometry the painter / hit-test consume. */
export interface FrvpLayout {
    /** Left / right pixel edges of the time span. */
    x0: number;
    x1: number;
    /** Pixel edge the histogram is anchored to (left or right of the span). */
    anchorX: number;
    /** Pixel width of the largest row. */
    maxW: number;
    /** Sign: +1 grows right from `anchorX`, −1 grows left. */
    grow: 1 | -1;
    profile: FrvpProfile;
    /** Resolved y for each row's lower bound (length = rows + 1 for the top edge). */
    yEdges: number[];
    vahY: number | null;
    valY: number | null;
    pocY: number | null;
    developingPoc: Array<[number, number]>;
    developingVaHigh: Array<[number, number]>;
    developingVaLow: Array<[number, number]>;
}

/**
 * A **fixed-range volume profile**: two time anchors bound a range, and the tool buckets
 * bar volume into equal-height price rows by an estimation rule (a bar contributes its
 * full volume to every row that contains any of its OHLC prices). Histogram width, value
 * area, POC / VAH / VAL lines, and optional developing levels are data-driven — they
 * recompute live as an endpoint is dragged or new bars arrive, via {@link Projector.barsInRange}.
 */
export class FixedRangeVolumeProfile extends Drawing {
    readonly type = 'fixedrangevp' as const;

    /** Cosmetics + behavior (seeded from defaults, persisted via props). */
    frvp!: FrvpStyle;

    private cachedRange: { min: number; max: number } | null = null;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.frvp) this.frvp = defaultFrvpStyle();
    }

    anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // Two points bound the time range; the profile ignores their price (data-driven),
        // so handles are constrained to horizontal moves — same UX as the regression channel.
        return { min: 2, max: 2, slots: [{ role: 'start', free: 'x' }, { role: 'end', free: 'x' }] };
    }

    /** Bars in the anchor time-range (inclusive), or null when either anchor / feed is missing. */
    private barsInSpan(proj: Projector): FrvpBar[] | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const from = Math.min(a.time, b.time);
        const to = Math.max(a.time, b.time);
        const raw = proj.barsInRange?.(from, to) ?? null;
        if (!raw || raw.length < 1) return null;
        return raw.map((bar) => ({
            time: bar.time,
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume ?? 0,
        }));
    }

    /** Compute the profile (+ developing series when enabled), caching the price span for autoscale. */
    compute(proj: Projector): FrvpCompute | null {
        const bars = this.barsInSpan(proj);
        if (!bars) return null;
        const s = this.frvp;
        const wantDev = s.showDevelopingPoc || s.showDevelopingVa;
        const result = computeFixedRangeProfile(bars, s.rows, s.valueAreaPct / 100, wantDev);
        if (result) {
            const { profile } = result;
            this.cachedRange = {
                min: profile.min,
                max: profile.min + profile.rowH * profile.rows.length,
            };
        }
        return result;
    }

    /** Resolve the compute to pixel geometry for the painter + hit-test. */
    layout(proj: Projector): FrvpLayout | null {
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        const computed = this.compute(proj);
        if (!computed) return null;
        const { profile } = computed;
        const t0 = Math.min(a.time, b.time);
        const t1 = Math.max(a.time, b.time);
        const x0 = proj.xOf(t0);
        const x1 = proj.xOf(t1);
        const spanW = Math.abs(x1 - x0);
        const maxW = Math.max(1, (Math.min(100, Math.max(0, this.frvp.widthPct)) / 100) * spanW);
        const growRight = this.frvp.anchor === 'left';
        const anchorX = growRight ? Math.min(x0, x1) : Math.max(x0, x1);
        const grow: 1 | -1 = growRight ? 1 : -1;

        const yEdges: number[] = [];
        for (let k = 0; k <= profile.rows.length; k += 1) {
            const y = proj.yOf(profile.min + k * profile.rowH, this.paneId);
            if (y == null) return null;
            yEdges.push(y);
        }

        const yAt = (price: number): number | null => proj.yOf(price, this.paneId);
        const vahPrice = profile.rows[profile.vaTo]!.price + profile.rowH;
        const valPrice = profile.rows[profile.vaFrom]!.price;
        const pocPrice = profile.rows[profile.poc]!.price + profile.rowH / 2;

        const toPoly = (pts: readonly FrvpDevelopingPoint[]): Array<[number, number]> => {
            const out: Array<[number, number]> = [];
            for (const p of pts) {
                const y = yAt(p.price);
                if (y == null) continue;
                out.push([proj.xOf(p.time), y]);
            }
            return out;
        };

        return {
            x0: Math.min(x0, x1),
            x1: Math.max(x0, x1),
            anchorX,
            maxW,
            grow,
            profile,
            yEdges,
            vahY: yAt(vahPrice),
            valY: yAt(valPrice),
            pocY: yAt(pocPrice),
            developingPoc: toPoly(computed.developingPoc),
            developingVaHigh: toPoly(computed.developingVaHigh),
            developingVaLow: toPoly(computed.developingVaLow),
        };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const L = this.layout(proj);
        if (!L) return false;
        // Hit the histogram's bounding box (anchored strip covering the full price span).
        const left = L.grow === 1 ? L.anchorX : L.anchorX - L.maxW;
        const right = L.grow === 1 ? L.anchorX + L.maxW : L.anchorX;
        const yLo = Math.min(L.yEdges[0]!, L.yEdges[L.yEdges.length - 1]!);
        const yHi = Math.max(L.yEdges[0]!, L.yEdges[L.yEdges.length - 1]!);
        if (pointInPolygon(px, py, [
            [left, yLo],
            [right, yLo],
            [right, yHi],
            [left, yHi],
        ])) return true;
        // Also hit the horizontal levels and developing polylines.
        const hLines: Array<[number, number | null]> = [
            [L.x0, L.vahY],
            [L.x0, L.valY],
            [L.x0, L.pocY],
        ];
        for (const [, y] of hLines) {
            if (y != null && distToSegment(px, py, L.x0, y, L.x1, y) <= tol) return true;
        }
        for (const poly of [L.developingPoc, L.developingVaHigh, L.developingVaLow]) {
            for (let i = 1; i < poly.length; i += 1) {
                if (distToSegment(px, py, poly[i - 1]![0], poly[i - 1]![1], poly[i]![0], poly[i]![1]) <= tol) return true;
            }
        }
        return false;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const L = this.layout(proj);
        if (L && L.pocY != null) return [[L.x0, L.pocY], [L.x1, L.pocY]];
        const pts: Array<[number, number]> = [];
        for (const a of this.anchors) {
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
        const L = this.layout(proj);
        if (!L) return null;
        const left = Math.min(L.x0, L.grow === 1 ? L.anchorX : L.anchorX - L.maxW);
        const right = Math.max(L.x1, L.grow === 1 ? L.anchorX + L.maxW : L.anchorX);
        const yLo = Math.min(L.yEdges[0]!, L.yEdges[L.yEdges.length - 1]!);
        const yHi = Math.max(L.yEdges[0]!, L.yEdges[L.yEdges.length - 1]!);
        return { x: left, y: yLo, w: right - left, h: yHi - yLo };
    }

    priceRange(): { min: number; max: number } | null {
        if (this.cachedRange) return this.cachedRange;
        const a = this.anchors[0];
        const b = this.anchors[1];
        if (!a || !b) return null;
        return { min: Math.min(a.price, b.price), max: Math.max(a.price, b.price) };
    }

    schema(): SettingsSchema {
        // All FRVP controls live in the gear panel — the schema paths gate that UI branch.
        return {
            fields: [
                { path: 'frvp.rows', label: 'Rows', kind: 'number', min: 1, max: 500, step: 1, group: 'behavior' },
                { path: 'frvp.valueAreaPct', label: 'Value Area', kind: 'number', min: 0, max: 100, step: 1, group: 'behavior' },
                { path: 'frvp.widthPct', label: 'Width %', kind: 'number', min: 0, max: 100, step: 1, group: 'behavior' },
                {
                    path: 'frvp.anchor',
                    label: 'Anchor',
                    kind: 'select',
                    options: [
                        { value: 'right', label: 'Right' },
                        { value: 'left', label: 'Left' },
                    ],
                    group: 'behavior',
                },
                { path: 'frvp.upColor', label: 'Up Volume', kind: 'color', group: 'fill' },
                { path: 'frvp.downColor', label: 'Down Volume', kind: 'color', group: 'fill' },
                { path: 'frvp.vaUpColor', label: 'Value Area Up', kind: 'color', group: 'fill' },
                { path: 'frvp.vaDownColor', label: 'Value Area Down', kind: 'color', group: 'fill' },
                { path: 'frvp.showVah', label: 'VAH', kind: 'boolean', group: 'line' },
                { path: 'frvp.vahColor', label: 'VAH color', kind: 'color', group: 'line' },
                { path: 'frvp.vahStyle', label: 'VAH style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
                { path: 'frvp.showVal', label: 'VAL', kind: 'boolean', group: 'line' },
                { path: 'frvp.valColor', label: 'VAL color', kind: 'color', group: 'line' },
                { path: 'frvp.valStyle', label: 'VAL style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
                { path: 'frvp.showPoc', label: 'POC', kind: 'boolean', group: 'line' },
                { path: 'frvp.pocColor', label: 'POC color', kind: 'color', group: 'line' },
                { path: 'frvp.pocStyle', label: 'POC style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
                { path: 'frvp.showDevelopingPoc', label: 'Developing POC', kind: 'boolean', group: 'line' },
                { path: 'frvp.developingPocColor', label: 'Developing POC color', kind: 'color', group: 'line' },
                { path: 'frvp.developingPocStyle', label: 'Developing POC style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
                { path: 'frvp.showDevelopingVa', label: 'Developing VA', kind: 'boolean', group: 'line' },
                { path: 'frvp.developingVaColor', label: 'Developing VA color', kind: 'color', group: 'line' },
                { path: 'frvp.developingVaStyle', label: 'Developing VA style', kind: 'lineStyle', options: LINE_STYLE_OPTIONS, group: 'line' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.frvp };
    }

    protected override readProps(props: Record<string, unknown>): void {
        this.frvp = { ...defaultFrvpStyle(), ...(props as Partial<FrvpStyle>) };
    }
}
