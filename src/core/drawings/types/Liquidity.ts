import type { AnchorSlot, SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS } from '../schema';
import { liquidityState, type LiquidityExtend, type LiquidityState } from '../priceAction';
import { PriceActionTool } from './PriceActionZone';

/** A liquidity level's settings (round-trip through `props`). */
export interface LiquiditySettings {
    extend: LiquidityExtend;
    /** Mark the candle that swept the level. */
    markSweep: boolean;
}

const EXTEND_OPTIONS = [
    { value: 'swept', label: 'Until swept' },
    { value: 'broken', label: 'Until broken' },
    { value: 'always', label: 'Always' },
];

function defaults(): LiquiditySettings {
    return { extend: 'swept', markSweep: true };
}

/** A liquidity level in pixels, ready to paint. */
export interface LiquidityGeometry {
    x1: number;
    x2: number;
    y: number;
    /** Where the level was swept: just past the sweeping candle's wick. */
    sweep: { x: number; y: number } | null;
    handle: [number, number];
}

/**
 * Liquidity resting above a candle's high (buy-side) or below its low (sell-side) — the
 * stops price tends to run before turning. Placed with one click on the candle, nearer its
 * high or its low; the level runs right until price sweeps it or closes beyond it, and the
 * sweep is marked.
 */
export class Liquidity extends PriceActionTool {
    readonly type = 'liquidity' as const;
    declare liq: LiquiditySettings;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.liq) this.liq = defaults();
    }

    override anchorSchema(): { min: number; max: number; slots: AnchorSlot[] } {
        // The anchor's price picks the side: nearer the candle's high or its low.
        return { min: 1, max: 1, slots: [{ role: 'candle', free: 'both' }] };
    }

    state(proj: Projector): LiquidityState | null {
        const c = this.candles(proj);
        const a = this.anchors[0];
        if (!c || !a) return null;
        const bar = c.bars[c.at]!;
        const side = a.price >= (bar.high + bar.low) / 2 ? 'high' : 'low';
        return liquidityState(c.bars, c.at, side, this.liq.extend);
    }

    line(proj: Projector): LiquidityGeometry | null {
        const c = this.candles(proj);
        const s = this.state(proj);
        if (!c || !s) return null;
        const y = proj.yOf(s.price, this.paneId);
        if (y == null) return null;
        const { bars } = c;
        const x1 = proj.xOf(bars[s.index]!.time);
        const x2 = this.rightEdge(proj, bars, s.end);
        let sweep: LiquidityGeometry['sweep'] = null;
        if (this.liq.markSweep && s.swept !== null && (s.end === null || s.swept <= s.end)) {
            const b = bars[s.swept]!;
            const wick = proj.yOf(s.high ? b.high : b.low, this.paneId);
            if (wick != null) sweep = { x: proj.xOf(b.time), y: wick + (s.high ? -9 : 9) };
        }
        this.cachedRange = { min: s.price, max: s.price };
        this.cachedExtent = { min: bars[s.index]!.time, max: bars[s.end ?? bars.length - 1]!.time };
        return { x1, x2, y, sweep, handle: [x1, y] };
    }

    hitTest(px: number, py: number, proj: Projector, tol: number): boolean {
        const l = this.line(proj);
        return l != null && px >= l.x1 - tol && px <= l.x2 + tol && Math.abs(py - l.y) <= tol;
    }

    handlePoints(proj: Projector): Array<[number, number]> {
        const l = this.line(proj);
        if (l) return [l.handle];
        const a = this.anchors[0];
        const y = a ? proj.yOf(a.price, this.paneId) : null;
        return a && y != null ? [[proj.xOf(a.time), y]] : [];
    }

    bounds(proj: Projector): { x: number; y: number; w: number; h: number } | null {
        const l = this.line(proj);
        if (!l) return null;
        return { x: l.x1, y: l.y - 4, w: Math.max(1, Math.min(proj.width, l.x2) - l.x1), h: 8 };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                ...LINE_FIELDS,
                { path: 'liq.extend', label: 'Extend right', kind: 'select', options: EXTEND_OPTIONS, group: 'behavior' },
                { path: 'liq.markSweep', label: 'Mark the sweep', kind: 'boolean', group: 'behavior' },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.liq };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const d = defaults();
        const p = props as Partial<LiquiditySettings>;
        this.liq = {
            extend: EXTEND_OPTIONS.some((o) => o.value === p.extend) ? p.extend! : d.extend,
            markSweep: typeof p.markSweep === 'boolean' ? p.markSweep : d.markSweep,
        };
    }
}
