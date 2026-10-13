import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { blockState, type PriceActionBar } from '../priceAction';
import { BEARISH, BULLISH } from '../../palette';
import { PriceActionZone, type ZoneFormation, type ZoneSettings } from './PriceActionZone';

/** An order block's settings (round-trip through `props`). */
export interface BlockSettings extends ZoneSettings {
    /** The candle's body, or its whole range from high to low. */
    range: 'body' | 'wick';
    extend: 'tested' | 'half' | 'broken' | 'always';
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

    protected settings(): BlockSettings {
        return this.block;
    }

    protected formation(bars: readonly PriceActionBar[], at: number): ZoneFormation | null {
        const s = blockState(bars, at, this.block.range);
        if (!s) return null;
        const { extend, breaker } = this.block;
        const flip = breaker && extend === 'broken' && s.broken !== null ? { from: s.broken, to: s.retest } : null;
        return { ...s, start: s.index, end: extend === 'always' ? null : s[extend], flip };
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
                { path: 'block.fade', label: 'Fade at end', kind: 'boolean', group: 'behavior', when: { path: 'block.extend', in: ['tested', 'half', 'broken'] } },
                { path: 'block.breaker', label: 'Breaker', kind: 'boolean', group: 'behavior', when: { path: 'block.extend', in: ['broken'] } },
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
