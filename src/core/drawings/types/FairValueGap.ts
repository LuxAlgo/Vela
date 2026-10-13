import type { SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { gapState, type PriceActionBar } from '../priceAction';
import { BEARISH, BULLISH } from '../../palette';
import { PriceActionZone, type ZoneFormation, type ZoneSettings } from './PriceActionZone';

/** A fair value gap's settings (round-trip through `props`). */
export interface GapSettings extends ZoneSettings {
    extend: 'tested' | 'half' | 'filled' | 'always';
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

    protected settings(): GapSettings {
        return this.gap;
    }

    protected formation(bars: readonly PriceActionBar[], at: number): ZoneFormation | null {
        const s = gapState(bars, at);
        if (!s) return null;
        const { extend, inverse } = this.gap;
        const flip = inverse && extend === 'filled' && s.inverted !== null ? { from: s.inverted, to: null } : null;
        return { ...s, start: s.index - 1, end: extend === 'always' ? null : s[extend], flip };
    }

    schema(): SettingsSchema {
        return {
            fields: [
                { path: 'gap.extend', label: 'Extend right', kind: 'select', options: EXTEND_OPTIONS, group: 'behavior' },
                { path: 'gap.upColor', label: 'Bullish', kind: 'color', group: 'fill' },
                { path: 'gap.downColor', label: 'Bearish', kind: 'color', group: 'fill' },
                { path: 'gap.midline', label: 'Midline', kind: 'boolean', group: 'line' },
                { path: 'gap.border', label: 'Border', kind: 'boolean', group: 'line' },
                { path: 'gap.fade', label: 'Fade at end', kind: 'boolean', group: 'behavior', when: { path: 'gap.extend', in: ['tested', 'half', 'filled'] } },
                { path: 'gap.inverse', label: 'Flip on close', kind: 'boolean', group: 'behavior', when: { path: 'gap.extend', in: ['filled'] } },
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
