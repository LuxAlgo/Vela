import { CalloutBase } from './CalloutBase';

/**
 * A callout: a text box (centered on anchor[1]) with a leader line pointing at a target
 * (anchor[0]) — e.g. labelling a specific price/bar. Drag from the target to where the box
 * should sit; the text is edited through the settings popup like the plain text tool.
 */
export class Callout extends CalloutBase {
    readonly type = 'callout' as const;
}
