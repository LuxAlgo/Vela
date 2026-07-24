import { type SerializedDrawing } from '../Drawing';
import type { SettingsSchema } from '../schema';
import { LINE_FIELDS, FILL_FIELDS, TEXT_FIELDS } from '../schema';
import { defaultText } from '../style';
import { PinnedLabel } from './PinnedLabel';

/** A note: free text on a small rounded plate, pinned to a price/bar (a labelled sticky). */
export class Note extends PinnedLabel {
    readonly type = 'note' as const;

    constructor(init: Partial<SerializedDrawing> & { paneId: string }) {
        super(init);
        if (!this.text) this.text = { ...defaultText('Note'), color: '#ffffff' };
    }

    protected override defaultLabel(): string {
        return 'Note';
    }

    schema(): SettingsSchema {
        return { fields: [...LINE_FIELDS, ...FILL_FIELDS, ...TEXT_FIELDS] };
    }
}
