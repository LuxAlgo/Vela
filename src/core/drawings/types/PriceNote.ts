import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { CalloutBase } from './CalloutBase';

/**
 * A note pinned to a price/bar: a draggable box (anchor[1]) joined to the pinned point (anchor[0])
 * by a leader + a dot, displaying the AUTO-formatted price of the pinned point (not free text) —
 * label a level, then drag the readout clear of the candles.
 */
export class PriceNote extends CalloutBase {
    readonly type = 'pricenote' as const;

    protected override defaultLabel(): string {
        return ''; // no free text — the painter renders the pinned price
    }

    /** Sized from the (approximate) pinned price string — the painter formats it precisely. */
    protected override labelText(): string {
        const p = this.anchors[0]?.price;
        return p == null ? '0.00' : p.toFixed(2);
    }

    /** The label is the auto price, so expose only styling — not a `text.value` field. */
    override schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS.filter((f) => f.path !== 'text.value')] };
    }
}
