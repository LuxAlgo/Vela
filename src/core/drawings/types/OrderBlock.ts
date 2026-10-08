import type { SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { blockState, type BlockExtend, type BlockState } from '../priceAction';
import { BEARISH, BULLISH } from '../../palette';
import { PriceActionZone, strokeOf, type PriceZoneGeometry } from './PriceActionZone';

/** An order block's settings (round-trip through `props`). */
export interface BlockSettings {
    /** The candle's body, or its whole range from high to low. */
    range: 'body' | 'wick';
    extend: BlockExtend;
    /** Fill of a bullish (demand) / bearish (supply) block; its alpha is the opacity. */
    upColor: string;
    downColor: string;
    midline: boolean;
    border: boolean;
    fade: boolean;
    /** Once broken, the block carries on the other way until price returns to it. */
    breaker: boolean;
}

const RANGE_OPTIONS = [
    { value: 'body', label: 'Body' },
    { value: 'wick', label: 'Full range' },
];
const EXTEND_OPTIONS = [
    { value: 'tested', label: 'Until tested' },
    { value: 'half', label: 'Until 50%' },
    { value: 'broken', label: 'Until broken' },
    { value: 'always', label: 'Always' },
];

function defaults(): BlockSettings {
    return { range: 'body', extend: 'broken', upColor: `${BULLISH}29`, downColor: `${BEARISH}29`, midline: true, border: true, fade: true, breaker: true };
}

/**
 * An order block: the last opposite candle before a move, a zone price often comes back to.
 * Placed with one click on the candle — a down-close candle marks demand, an up-close one
 * supply — it runs right until price tests it, reaches its halfway line or closes through it.
 * A broken block can carry on as a breaker, the other way, until price returns to it.
 */
export class OrderBlock extends PriceActionZone {
    readonly type = 'orderblock' as const;
    declare block: BlockSettings;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.block) this.block = defaults();
    }

    state(proj: Projector): BlockState | null {
        const c = this.candles(proj);
        return c ? blockState(c.bars, c.at, this.block.range, this.block.extend) : null;
    }

    zone(proj: Projector): PriceZoneGeometry | null {
        const c = this.candles(proj);
        if (!c) return null;
        const s = blockState(c.bars, c.at, this.block.range, this.block.extend);
        if (!s) return null;
        const box = this.box(proj, s.top, s.bottom);
        if (!box) return null;
        const { bars } = c;
        const fill = s.bull ? this.block.upColor : this.block.downColor;
        const x1 = proj.xOf(bars[s.index]!.time) - this.halfBar(proj, bars, s.index);
        const x2 = this.rightEdge(proj, bars, s.end);
        const midY = proj.yOf(s.mid, this.paneId);
        const edge = this.block.extend === 'tested' ? (s.bull ? s.top : s.bottom) : this.block.extend === 'half' ? s.mid : s.bull ? s.bottom : s.top;
        const edgeY = proj.yOf(edge, this.paneId);
        let flip: PriceZoneGeometry['flip'] = null;
        if (this.block.breaker && this.block.extend === 'broken' && s.broken !== null) {
            const other = s.bull ? this.block.downColor : this.block.upColor;
            flip = {
                x1: proj.xOf(bars[s.broken]!.time) - this.halfBar(proj, bars, s.broken),
                x2: this.rightEdge(proj, bars, s.retest),
                fill: other,
                stroke: strokeOf(other),
            };
        }
        this.cachedRange = { min: s.bottom, max: s.top };
        this.cachedExtent = { min: bars[s.index]!.time, max: bars[s.retest ?? s.end ?? bars.length - 1]!.time };
        return {
            x1,
            x2,
            ...box,
            fill,
            stroke: strokeOf(fill),
            border: this.block.border,
            midY: this.block.midline ? midY : null,
            faded: s.end !== null && this.block.fade && !flip,
            marker: s.end !== null && !flip && edgeY != null ? { x: proj.xOf(bars[s.end]!.time), y: edgeY } : null,
            flip,
            handle: [proj.xOf(bars[s.index]!.time), midY ?? (box.yTop + box.yBottom) / 2],
        };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                { path: 'block.range', label: 'Zone', kind: 'select', options: RANGE_OPTIONS, group: 'behavior' },
                { path: 'block.extend', label: 'Extend right', kind: 'select', options: EXTEND_OPTIONS, group: 'behavior' },
                { path: 'block.upColor', label: 'Bullish', kind: 'color', group: 'fill' },
                { path: 'block.downColor', label: 'Bearish', kind: 'color', group: 'fill' },
                { path: 'block.midline', label: 'Midline', kind: 'boolean', group: 'line' },
                { path: 'block.border', label: 'Border', kind: 'boolean', group: 'line' },
                { path: 'block.fade', label: 'Fade when done', kind: 'boolean', group: 'behavior', when: { path: 'block.extend', in: ['tested', 'half', 'broken'] } },
                { path: 'block.breaker', label: 'Breaker once broken', kind: 'boolean', group: 'behavior', when: { path: 'block.extend', in: ['broken'] } },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.block };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const d = defaults();
        const p = props as Partial<BlockSettings>;
        this.block = {
            range: p.range === 'body' || p.range === 'wick' ? p.range : d.range,
            extend: EXTEND_OPTIONS.some((o) => o.value === p.extend) ? p.extend! : d.extend,
            upColor: typeof p.upColor === 'string' ? p.upColor : d.upColor,
            downColor: typeof p.downColor === 'string' ? p.downColor : d.downColor,
            midline: typeof p.midline === 'boolean' ? p.midline : d.midline,
            border: typeof p.border === 'boolean' ? p.border : d.border,
            fade: typeof p.fade === 'boolean' ? p.fade : d.fade,
            breaker: typeof p.breaker === 'boolean' ? p.breaker : d.breaker,
        };
    }
}
