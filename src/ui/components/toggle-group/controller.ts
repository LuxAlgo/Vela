// ToggleGroup CONTROLLER — Zag's toggle-group machine, mapped from Vela's options. `single`:
// one option is always chosen (a radio group, a segmented control). `multiple`: each option
// toggles on its own. The arrow keys move focus; Space and Enter press. No DOM.
import * as toggleGroup from '@zag-js/toggle-group';
import { nextUid, normalizeProps } from '../../zag';

export interface ToggleGroupItem {
    id: string;
    /** Visible text, or the accessible name of an icon-only option. */
    label: string;
    icon?: string;
    disabled?: boolean;
}

interface ToggleGroupCommonOptions {
    items: readonly ToggleGroupItem[];
    /** Accessible name of the group. */
    label?: string;
    /** Options show their icon only; each label becomes its option's accessible name. */
    iconOnly?: boolean;
    dir?: 'ltr' | 'rtl';
}

export interface ToggleGroupSingleOptions extends ToggleGroupCommonOptions {
    type?: 'single';
    /** The chosen option (default: the first enabled one). */
    value?: string;
    onChange?: (value: string) => void;
}

export interface ToggleGroupMultipleOptions extends ToggleGroupCommonOptions {
    type: 'multiple';
    /** The options turned on (default: none). */
    value?: readonly string[];
    onChange?: (value: string[]) => void;
}

export type ToggleGroupControllerOptions = ToggleGroupSingleOptions | ToggleGroupMultipleOptions;

export interface ToggleGroupController {
    machine: typeof toggleGroup.machine;
    props: Partial<toggleGroup.Props>;
    connect(service: toggleGroup.Service): toggleGroup.Api;
}

export function toggleGroupController(opts: ToggleGroupControllerOptions): ToggleGroupController {
    const multiple = opts.type === 'multiple';
    const defaultValue =
        opts.type === 'multiple' ? [...(opts.value ?? [])] : [opts.value ?? opts.items.find((i) => !i.disabled)?.id].filter((v): v is string => v !== undefined);
    return {
        machine: toggleGroup.machine,
        props: {
            id: nextUid('vela-toggle-group'),
            multiple,
            // A single group never empties: pressing the chosen option keeps it chosen.
            deselectable: false,
            defaultValue,
            dir: opts.dir ?? 'ltr',
            loopFocus: true,
            rovingFocus: true,
            onValueChange: ({ value }) => {
                if (opts.type === 'multiple') opts.onChange?.(value);
                else if (value[0] !== undefined) opts.onChange?.(value[0]);
            },
        },
        connect: (service) => toggleGroup.connect(service, normalizeProps),
    };
}
