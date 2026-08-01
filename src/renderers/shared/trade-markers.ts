// Strategy trade markers — the on-chart record of a strategy's order executions.
// Per fill, one marker UNIT: a direction arrow hugging the bar (buys point up from
// below the low, sells down from above the high; exit fills carry a cap between the
// arrow tip and the bar), a text stack reading OUTWARD from the bar (order id, then
// signed quantity — the quantity is always the outermost line), and a small tick at
// the exact fill price on the bar's trade-side edge. Multiple fills on one bar stack
// outward in execution order; at high density units overlap rather than thin out.
//
// Pure canvas2d painting + measurement, shared across backends (the chrome canvas is
// always 2d) and node-testable: callers supply coordinate closures, no renderer types
// cross this boundary. Glyphs and text keep a FIXED pixel size at every zoom, like the
// axis chrome.
import type { TradeExecution } from '../../core/model/trades';
import { TRADE_LONG, TRADE_SHORT, TRADE_EXIT } from '../../core/palette';

/** Display state of the `tradeMarkers` renderer feature (everything on by default). */
export interface TradeMarkersState {
    /** Master visibility of the marker units. */
    visible: boolean;
    /** The order-id/comment text line. */
    labels: boolean;
    /** The signed-quantity text line. */
    qty: boolean;
    /** Entry colors per position side, plus the exits' shared color (both directions). */
    colors: { long: string; short: string; exit: string };
}

export const TRADE_LONG_COLOR = TRADE_LONG;
export const TRADE_SHORT_COLOR = TRADE_SHORT;
export const TRADE_EXIT_COLOR = TRADE_EXIT;

export function defaultTradeMarkersState(): TradeMarkersState {
    return {
        visible: true,
        labels: true,
        qty: true,
        colors: { long: TRADE_LONG_COLOR, short: TRADE_SHORT_COLOR, exit: TRADE_EXIT_COLOR },
    };
}

/**
 * Validated merge of an untrusted partial onto a state — malformed/unknown fields are
 * dropped, so `renderer.set('tradeMarkers', { qty: false })` changes exactly one thing.
 */
export function mergeTradeMarkersState(base: TradeMarkersState, patch: unknown): TradeMarkersState {
    const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
    const c = (p.colors && typeof p.colors === 'object' ? p.colors : {}) as Record<string, unknown>;
    const bool = (v: unknown, fb: boolean): boolean => (typeof v === 'boolean' ? v : fb);
    const color = (v: unknown, fb: string): string => (typeof v === 'string' && v.trim().length > 0 ? v : fb);
    return {
        visible: bool(p.visible, base.visible),
        labels: bool(p.labels, base.labels),
        qty: bool(p.qty, base.qty),
        colors: {
            long: color(c.long, base.colors.long),
            short: color(c.short, base.colors.short),
            exit: color(c.exit, base.colors.exit),
        },
    };
}

/** Chart-side resolvers the painter needs (mirrors the drawings' `LayerDeps`). */
export interface TradeMarkerDeps {
    /** Fill time (ms) → fractional logical bar index. */
    timeToLogical(ms: number): number;
    /** PRICE bar high/low at a rounded logical index (null off the series). */
    barAt(logical: number): { high: number; low: number } | null;
}

/** Autoscale contribution: anchor-bar extremes + the pixel headroom the stacks need. */
export interface TradeMarkerHints {
    min: number;
    max: number;
    abovePx: number;
    belowPx: number;
}

export interface TradeMarkerTextStyle {
    fontSize: number;
    fontFamily: string;
    color: string;
}

// Fixed-pixel geometry, zoom-independent.
const BAR_GAP = 10; // bar extreme → arrow tip
const ARROW_W = 9; // head width
const HEAD_H = 6;
const ARROW_H = 14; // head + stem
const STEM_W = 3;
const CAP_H = 2; // exit cap between the tip and the bar
const CAP_GAP = 2;
const TEXT_GAP = 3; // arrow tail → first text line
const UNIT_GAP = 6; // between stacked units on one bar
const TICK_W = 6; // fill-price tick (points into the bar)
const TICK_H = 8;

interface Unit {
    exec: TradeExecution;
    /** Text lines outward from the bar: [label?, qty?]. */
    lines: string[];
    height: number;
}

interface BarStack {
    logical: number;
    buys: Unit[];
    sells: Unit[];
}

function lineHeightOf(fontSize: number): number {
    return fontSize + 4;
}

/** `+2` / `-0.5` — sign from the side; magnitude trimmed of float noise. */
function qtyText(exec: TradeExecution): string | null {
    if (exec.qty == null || !Number.isFinite(exec.qty)) return null;
    const magnitude = Number(Math.abs(exec.qty).toFixed(8));
    return `${exec.side === 'buy' ? '+' : '-'}${magnitude}`;
}

function unitOf(exec: TradeExecution, state: TradeMarkersState, lineH: number): Unit {
    const lines: string[] = [];
    if (state.labels && exec.label) lines.push(exec.label);
    if (state.qty) {
        const q = qtyText(exec);
        if (q) lines.push(q);
    }
    return { exec, lines, height: ARROW_H + (lines.length ? TEXT_GAP + lines.length * lineH : 0) };
}

/** Group executions by fill bar, split buys/sells, keeping execution order within a stack. */
function stacksFor(
    trades: readonly TradeExecution[],
    state: TradeMarkersState,
    deps: TradeMarkerDeps,
    from: number,
    to: number,
    lineH: number,
): BarStack[] {
    const byBar = new Map<number, BarStack>();
    for (const exec of trades) {
        const logical = Math.round(deps.timeToLogical(exec.time));
        if (logical < from || logical > to) continue;
        let stack = byBar.get(logical);
        if (!stack) {
            stack = { logical, buys: [], sells: [] };
            byBar.set(logical, stack);
        }
        (exec.side === 'buy' ? stack.buys : stack.sells).push(unitOf(exec, state, lineH));
    }
    return [...byBar.values()];
}

/** Total pixel run of one side's stack, from the bar extreme to the last unit's far edge. */
function stackExtent(units: Unit[]): number {
    if (units.length === 0) return 0;
    let px = BAR_GAP;
    for (const u of units) px += u.height;
    return px + (units.length - 1) * UNIT_GAP;
}

/**
 * Price min/max + above/below pixel margins the visible trade markers need — folded
 * into the price pane's autoscale so a marker stack never clips at the pane edge.
 * Returns null when no execution lands in `[from, to]`.
 */
export function tradesPriceHints(
    trades: readonly TradeExecution[],
    state: TradeMarkersState,
    deps: TradeMarkerDeps,
    from: number,
    to: number,
    fontSize: number,
): TradeMarkerHints | null {
    if (trades.length === 0) return null;
    const lineH = lineHeightOf(fontSize);
    let min = Infinity;
    let max = -Infinity;
    let abovePx = 0;
    let belowPx = 0;
    for (const stack of stacksFor(trades, state, deps, Math.floor(from), Math.ceil(to), lineH)) {
        const bar = deps.barAt(stack.logical);
        if (!bar) continue;
        if (bar.low < min) min = bar.low;
        if (bar.high > max) max = bar.high;
        belowPx = Math.max(belowPx, stackExtent(stack.buys));
        abovePx = Math.max(abovePx, stackExtent(stack.sells));
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max, abovePx, belowPx };
}

/**
 * Paint one indicator's executions. Coordinates are pane-relative: `yOf` must already
 * subtract the pane top (the chrome layer translates + clips per pane). `barHalfPx` is
 * half the bar BODY width — the fill-price ticks hug the bar's edges with it.
 */
export function renderTradeMarkers(
    ctx: CanvasRenderingContext2D,
    trades: readonly TradeExecution[],
    state: TradeMarkersState,
    deps: TradeMarkerDeps,
    xOf: (logical: number) => number,
    yOf: (price: number) => number,
    text: TradeMarkerTextStyle,
    width: number,
    barHalfPx: number,
): void {
    if (trades.length === 0) return;
    const lineH = lineHeightOf(text.fontSize);
    const stacks = stacksFor(trades, state, deps, -Infinity, Infinity, lineH);
    if (stacks.length === 0) return;
    ctx.save();
    ctx.font = `${text.fontSize}px ${text.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const stack of stacks) {
        const x = xOf(stack.logical);
        // Cull generously — a unit is ~an order id wide, never hundreds of px.
        if (x < -150 || x > width + 150) continue;
        const bar = deps.barAt(stack.logical);
        if (!bar) continue;
        // Anchor to the bar's VISUAL edges, so an inverted scale keeps units hugging the bar.
        const yBottom = Math.max(yOf(bar.low), yOf(bar.high));
        const yTop = Math.min(yOf(bar.low), yOf(bar.high));

        let y = yBottom + BAR_GAP;
        for (const unit of stack.buys) {
            ctx.fillStyle = colorOf(unit.exec, state.colors);
            drawArrowUp(ctx, x, y, unit.exec.kind === 'exit');
            drawFillTick(ctx, unit.exec.side, x, yOf(unit.exec.price), barHalfPx);
            drawTextLines(ctx, unit.lines, x, y + ARROW_H + TEXT_GAP + lineH / 2, lineH, text.color);
            y += unit.height + UNIT_GAP;
        }
        y = yTop - BAR_GAP;
        for (const unit of stack.sells) {
            ctx.fillStyle = colorOf(unit.exec, state.colors);
            drawArrowDown(ctx, x, y, unit.exec.kind === 'exit');
            drawFillTick(ctx, unit.exec.side, x, yOf(unit.exec.price), barHalfPx);
            drawTextLines(ctx, unit.lines, x, y - ARROW_H - TEXT_GAP - lineH / 2, -lineH, text.color);
            y -= unit.height + UNIT_GAP;
        }
    }
    ctx.restore();
}

function colorOf(exec: TradeExecution, colors: TradeMarkersState['colors']): string {
    if (exec.kind === 'exit') return colors.exit;
    return exec.side === 'buy' ? colors.long : colors.short;
}

/** Solid up arrow with its tip at `yTip` — a buy, sitting under the bar, pointing at it. */
function drawArrowUp(ctx: CanvasRenderingContext2D, x: number, yTip: number, capped: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x, yTip);
    ctx.lineTo(x - ARROW_W / 2, yTip + HEAD_H);
    ctx.lineTo(x + ARROW_W / 2, yTip + HEAD_H);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - STEM_W / 2, yTip + HEAD_H, STEM_W, ARROW_H - HEAD_H);
    if (capped) ctx.fillRect(x - ARROW_W / 2, yTip - CAP_GAP - CAP_H, ARROW_W, CAP_H);
}

/** Solid down arrow with its tip at `yTip` — a sell, sitting over the bar, pointing at it. */
function drawArrowDown(ctx: CanvasRenderingContext2D, x: number, yTip: number, capped: boolean): void {
    ctx.beginPath();
    ctx.moveTo(x, yTip);
    ctx.lineTo(x - ARROW_W / 2, yTip - HEAD_H);
    ctx.lineTo(x + ARROW_W / 2, yTip - HEAD_H);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - STEM_W / 2, yTip - ARROW_H, STEM_W, ARROW_H - HEAD_H);
    if (capped) ctx.fillRect(x - ARROW_W / 2, yTip + CAP_GAP, ARROW_W, CAP_H);
}

/** The fill-price tick: a small triangle at the exact fill price, pointing INTO the bar
 *  from the trade's side — buys on the left edge, sells on the right. */
function drawFillTick(ctx: CanvasRenderingContext2D, side: TradeExecution['side'], x: number, yFill: number, barHalfPx: number): void {
    const edge = side === 'buy' ? x - barHalfPx : x + barHalfPx;
    const back = side === 'buy' ? edge - TICK_W : edge + TICK_W;
    ctx.beginPath();
    ctx.moveTo(edge, yFill);
    ctx.lineTo(back, yFill - TICK_H / 2);
    ctx.lineTo(back, yFill + TICK_H / 2);
    ctx.closePath();
    ctx.fill();
}

/** Text stack in the theme's neutral color (never the arrow color), stepping outward. */
function drawTextLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, firstY: number, step: number, color: string): void {
    if (lines.length === 0) return;
    ctx.fillStyle = color;
    for (let i = 0; i < lines.length; i += 1) ctx.fillText(lines[i]!, x, firstY + i * step);
}
