// Native-indicator inputs declared with translatable text: the schema keeps the English
// source as its identity (`title`, `tooltip`, `group`, option values) and carries the
// translatable side in `display`, which the settings dialog and the legend read.
import { sourceText } from '../i18n/text';
import type { MessageLike } from '../i18n/types';
import type { InputDisplay, InputSchema } from '../model/inputs';

/** An input whose title and tooltip may be messages. */
export type LocalizableInput = Omit<InputSchema, 'title' | 'tooltip'> & { title: MessageLike; tooltip?: MessageLike };

/** Display labels shared by many inputs, keyed by the identity they label. */
export interface InputLabels {
    /** Section heading per `group` name. */
    groups?: Readonly<Record<string, MessageLike>>;
    /** Shown label per option value. */
    options?: Readonly<Record<string, MessageLike>>;
}

/** The translatable form of display text: a descriptor, or nothing for plain text. */
export function messageOnly(m: MessageLike | undefined): MessageLike | undefined {
    return m != null && typeof m !== 'string' ? m : undefined;
}

/** Resolve a localizable input into the schema the chart reads. */
export function localizeInput(input: LocalizableInput, labels: InputLabels = {}): InputSchema {
    const { title, tooltip, display: given, ...rest } = input;
    const display: { -readonly [K in keyof InputDisplay]: InputDisplay[K] } = { ...given };
    const titleMsg = messageOnly(title);
    if (titleMsg && !display.title) display.title = titleMsg;
    const tipMsg = messageOnly(tooltip);
    if (tipMsg && !display.tooltip) display.tooltip = tipMsg;
    const group = rest.group != null ? labels.groups?.[rest.group] : undefined;
    if (group && !display.group) display.group = group;
    if (rest.options && labels.options && !display.options) {
        const options: Record<string, MessageLike> = {};
        let any = false;
        for (const value of rest.options) {
            const label = labels.options[value];
            if (label) {
                options[value] = label;
                any = true;
            }
        }
        if (any) display.options = options;
    }
    const out: InputSchema = { ...rest, title: sourceText(title) };
    if (tooltip != null) out.tooltip = sourceText(tooltip);
    if (Object.keys(display).length > 0) out.display = display;
    return out;
}
