// ToggleGroup VIEW — a row of option buttons on one track, over Zag's toggle-group machine.
import type * as toggleGroup from '@zag-js/toggle-group';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { toggleGroupController, type ToggleGroupController, type ToggleGroupControllerOptions, type ToggleGroupItem } from './controller';
import { TOGGLE_GROUP_CSS, TOGGLE_GROUP_STYLE_ID } from './styles';

export type ToggleGroupOptions = ToggleGroupControllerOptions & {
    /** `default` = 32px; `sm` = 28px. */
    size?: 'default' | 'sm';
    /** Stretch across the parent, options sharing the width. */
    fill?: boolean;
    className?: string;
};

export class ToggleGroup {
    readonly el: HTMLElement;
    private readonly ctrl: ToggleGroupController;
    private readonly handle: HandleOf<typeof toggleGroup.machine>;
    private readonly mid: string;
    private readonly iconOnly: boolean;
    private readonly label: string | undefined;
    private items: ToggleGroupItem[];
    private readonly buttons = new Map<string, HTMLButtonElement>();
    /** The options on as of the last write or report — the machine applies events on a
     *  microtask, so its own value lags a write. */
    private current: string[];
    /** A host write the machine has yet to report: that report is not the user's change. */
    private silentNext: string | undefined;

    constructor(opts: ToggleGroupOptions) {
        injectStyles(TOGGLE_GROUP_STYLE_ID, TOGGLE_GROUP_CSS, document);
        this.iconOnly = opts.iconOnly ?? false;
        this.label = opts.label;
        this.items = [...opts.items];
        const onChange = opts.onChange as ((v: string | string[]) => void) | undefined;
        const multiple = opts.type === 'multiple';
        this.ctrl = toggleGroupController({
            ...opts,
            onChange: (v: string | string[]) => {
                const next = typeof v === 'string' ? [v] : [...v];
                const key = next.join('\u0000');
                // The machine compares arrays by identity: a press that changes nothing reports too.
                if (key === this.current.join('\u0000')) {
                    if (this.silentNext === key) this.silentNext = undefined;
                    return;
                }
                this.current = next;
                if (this.silentNext === key) {
                    this.silentNext = undefined;
                    return;
                }
                onChange?.(multiple ? [...this.current] : v);
            },
        } as ToggleGroupControllerOptions);
        this.current = [...((this.ctrl.props.defaultValue as string[] | undefined) ?? [])];
        this.mid = String(this.ctrl.props.id);
        this.el = document.createElement('div');
        this.el.className = opts.className ? `vela-toggle-group ${opts.className}` : 'vela-toggle-group';
        this.el.dataset.slot = 'toggle-group';
        this.el.dataset.size = opts.size ?? 'default';
        if (opts.fill) this.el.dataset.fill = '';
        this.build();
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => this.render(service));
    }

    /** The options turned on. */
    get values(): readonly string[] {
        return this.current;
    }

    /** Show options as on without notifying. */
    setValue(value: string | readonly string[] | null): void {
        const next = value === null ? [] : typeof value === 'string' ? [value] : [...value];
        const key = next.join('\u0000');
        if (key === this.current.join('\u0000')) return;
        this.current = next;
        this.silentNext = key;
        this.api().setValue(next);
    }

    setItems(items: readonly ToggleGroupItem[]): void {
        this.items = [...items];
        this.build();
        const kept = this.current.filter((v) => this.items.some((i) => i.id === v));
        if (kept.length !== this.current.length) this.setValue(kept);
        this.handle.flush();
    }

    destroy(): void {
        this.handle.stop();
    }

    private api(): toggleGroup.Api {
        return this.ctrl.connect(this.handle.service);
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.items.map((item) => {
                const b = doc.createElement('button');
                b.className = 'vela-toggle-group-item';
                b.dataset.slot = 'toggle-group-item';
                if (item.icon) b.appendChild(iconEl(item.icon, doc));
                if (this.iconOnly && item.icon) {
                    b.dataset.iconOnly = '';
                    b.setAttribute('aria-label', item.label);
                } else b.appendChild(doc.createTextNode(item.label));
                this.buttons.set(item.id, b);
                return b;
            }),
        );
    }

    private render(service: toggleGroup.Service): void {
        const api = this.ctrl.connect(service);
        spreadProps(this.el, api.getRootProps(), this.mid);
        if (this.label) this.el.setAttribute('aria-label', this.label);
        for (const item of this.items) {
            const b = this.buttons.get(item.id);
            if (b) spreadProps(b, api.getItemProps({ value: item.id, disabled: item.disabled }), this.mid);
        }
    }
}
