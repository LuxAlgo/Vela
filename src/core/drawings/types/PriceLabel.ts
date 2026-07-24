import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { PinnedLabel } from './PinnedLabel';

/**
 * A price tag pinned to a bar/price: the painter auto-renders the anchor's price value (the text is
 * computed, not typed — so it tracks the level), with a left-pointing tag at the exact pixel.
 */
export class PriceLabel extends PinnedLabel {
    readonly type = 'pricelabel' as const;

    /** Sized from the (approximate) price string — the painter formats it precisely. */
    protected override labelText(): string {
        const p = this.anchors[0]?.price;
        return p == null ? '0.00' : p.toFixed(2);
    }

    /** The label value is auto (the price), so expose only styling — not a `text.value` field. */
    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS.filter((f) => f.path !== 'text.value')] };
    }
}
