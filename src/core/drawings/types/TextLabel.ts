import { type SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { TEXT_FIELDS } from '../schema';
import { defaultText } from '../style';
import { PinnedLabel } from './PinnedLabel';

/** A free-floating text annotation anchored to one point (top-left of the text). */
export class TextLabel extends PinnedLabel {
    readonly type = 'text' as const;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        // Starts empty on purpose: placing one opens an inline editor whose placeholder invites the
        // text, so a seeded literal would only have to be selected and deleted. Large by default —
        // a free-floating annotation is meant to be read at a glance, unlike a label hung on a shape.
        if (!this.text) this.text = { ...defaultText(), size: 'large' };
    }

    schema(): SettingsSchema {
        return { fields: [...TEXT_FIELDS], textIsContent: true };
    }
}
