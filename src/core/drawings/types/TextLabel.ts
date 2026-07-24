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
        if (!this.text) this.text = defaultText('Text');
    }

    schema(): SettingsSchema {
        return { fields: [...TEXT_FIELDS] };
    }
}
