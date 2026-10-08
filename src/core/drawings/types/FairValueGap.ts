import type { SerializedDrawing } from '../Drawing';
import type { Projector } from '../geometry';
import type { SettingsSchema } from '../schema';
import { gapState, type GapExtend, type GapState } from '../priceAction';
import { BEARISH, BULLISH } from '../../palette';
import { PriceActionZone, strokeOf, type PriceZoneGeometry } from './PriceActionZone';

/** A fair value gap's settings (round-trip through `props`). */
export interface GapSettings {
    /** How far right the gap runs. */
    extend: GapExtend;
    /** Fill of a bullish / bearish gap; its alpha is the opacity. */
    upColor: string;
    downColor: string;
    /** The dashed line at the gap's halfway price. */
    midline: boolean;
    border: boolean;
    /** Quieter once the gap has run its course. */
    fade: boolean;
    /** Once filled, a close through the far side carries the gap on the other way. */
    inverse: boolean;
}

const EXTEND_OPTIONS = [
    { value: 'tested', label: 'Until tested' },
    { value: 'half', label: 'Until 50%' },
    { value: 'filled', label: 'Until filled' },
    { value: 'always', label: 'Always' },
];

function defaults(): GapSettings {
    return { extend: 'filled', upColor: `${BULLISH}33`, downColor: `${BEARISH}33`, midline: true, border: false, fade: true, inverse: false };
}

/**
 * A fair value gap: three candles where the third leaves a gap with the first, an imbalance
 * price often returns to. Placed with one click on the middle candle (or near it — the nearest
 * gap is used), it runs right until price tests it, reaches its halfway line or fills it, then
 * marks where. Found and followed on the candles, so it updates as new ones arrive.
 */
export class FairValueGap extends PriceActionZone {
    readonly type = 'fairvaluegap' as const;
    declare gap: GapSettings;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.gap) this.gap = defaults();
    }

    /** The gap under the anchor and what price has done to it since, or null when there is none. */
    state(proj: Projector): GapState | null {
        const c = this.candles(proj);
        return c ? gapState(c.bars, c.at, this.gap.extend) : null;
    }

    zone(proj: Projector): PriceZoneGeometry | null {
        const c = this.candles(proj);
        if (!c) return null;
        const s = gapState(c.bars, c.at, this.gap.extend);
        if (!s) return null;
        const box = this.box(proj, s.top, s.bottom);
        if (!box) return null;
        const { bars } = c;
        const fill = s.bull ? this.gap.upColor : this.gap.downColor;
        const x1 = proj.xOf(bars[s.index - 1]!.time) - this.halfBar(proj, bars, s.index - 1);
        const x2 = this.rightEdge(proj, bars, s.end);
        const midY = proj.yOf(s.mid, this.paneId);
        // The dot sits on the edge price reached: the near side, the halfway line or the far side.
        const edge = this.gap.extend === 'tested' ? (s.bull ? s.top : s.bottom) : this.gap.extend === 'half' ? s.mid : s.bull ? s.bottom : s.top;
        const edgeY = proj.yOf(edge, this.paneId);
        let flip: PriceZoneGeometry['flip'] = null;
        if (this.gap.inverse && this.gap.extend === 'filled' && s.inverted !== null) {
            const other = s.bull ? this.gap.downColor : this.gap.upColor;
            flip = { x1: proj.xOf(bars[s.inverted]!.time) - this.halfBar(proj, bars, s.inverted), x2: this.rightEdge(proj, bars, null), fill: other, stroke: strokeOf(other) };
        }
        this.cachedRange = { min: s.bottom, max: s.top };
        this.cachedExtent = { min: bars[s.index - 1]!.time, max: bars[s.end ?? bars.length - 1]!.time };
        return {
            x1,
            x2,
            ...box,
            fill,
            stroke: strokeOf(fill),
            border: this.gap.border,
            midY: this.gap.midline ? midY : null,
            faded: s.end !== null && this.gap.fade && !flip,
            marker: s.end !== null && edgeY != null ? { x: proj.xOf(bars[s.end]!.time), y: edgeY } : null,
            flip,
            handle: [proj.xOf(bars[s.index]!.time), midY ?? (box.yTop + box.yBottom) / 2],
        };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                { path: 'gap.extend', label: 'Extend right', kind: 'select', options: EXTEND_OPTIONS, group: 'behavior' },
                { path: 'gap.upColor', label: 'Bullish', kind: 'color', group: 'fill' },
                { path: 'gap.downColor', label: 'Bearish', kind: 'color', group: 'fill' },
                { path: 'gap.midline', label: 'Midline', kind: 'boolean', group: 'line' },
                { path: 'gap.border', label: 'Border', kind: 'boolean', group: 'line' },
                { path: 'gap.fade', label: 'Fade when done', kind: 'boolean', group: 'behavior', when: { path: 'gap.extend', in: ['tested', 'half', 'filled'] } },
                { path: 'gap.inverse', label: 'Flip when closed through', kind: 'boolean', group: 'behavior', when: { path: 'gap.extend', in: ['filled'] } },
            ],
        };
    }

    protected override writeProps(): Record<string, unknown> {
        return { ...this.gap };
    }

    protected override readProps(props: Record<string, unknown>): void {
        const d = defaults();
        const p = props as Partial<GapSettings>;
        this.gap = {
            extend: EXTEND_OPTIONS.some((o) => o.value === p.extend) ? p.extend! : d.extend,
            upColor: typeof p.upColor === 'string' ? p.upColor : d.upColor,
            downColor: typeof p.downColor === 'string' ? p.downColor : d.downColor,
            midline: typeof p.midline === 'boolean' ? p.midline : d.midline,
            border: typeof p.border === 'boolean' ? p.border : d.border,
            fade: typeof p.fade === 'boolean' ? p.fade : d.fade,
            inverse: typeof p.inverse === 'boolean' ? p.inverse : d.inverse,
        };
    }
}
