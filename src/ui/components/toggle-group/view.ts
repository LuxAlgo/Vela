// ToggleGroup VIEW — a row of option buttons on one track. Clicks press; the arrow keys move
// (and, for `single`, choose).
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { applyProps } from '../../headless';
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
    private readonly iconOnly: boolean;
    private readonly buttons = new Map<string, HTMLButtonElement>();

    constructor(opts: ToggleGroupOptions) {
        injectStyles(TOGGLE_GROUP_STYLE_ID, TOGGLE_GROUP_CSS, document);
        this.iconOnly = opts.iconOnly ?? false;
        this.ctrl = toggleGroupController(opts);
        this.el = document.createElement('div');
        this.el.className = opts.className ? `vela-toggle-group ${opts.className}` : 'vela-toggle-group';
        this.el.dataset.size = opts.size ?? 'default';
        if (opts.fill) this.el.dataset.fill = '';
        this.el.addEventListener('keydown', (e) => this.onKey(e));
        this.build();
    }

    /** The options turned on. */
    get values(): readonly string[] {
        return this.ctrl.values;
    }

    /** Show options as on without notifying. */
    setValue(value: string | readonly string[] | null): void {
        this.ctrl.setValue(value);
        this.paint();
    }

    setItems(items: readonly ToggleGroupItem[]): void {
        this.ctrl.setItems(items);
        this.build();
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.ctrl.items.map((item) => {
                const b = doc.createElement('button');
                b.className = 'vela-toggle-group-item';
                if (item.icon) b.appendChild(iconEl(item.icon, doc));
                if (this.iconOnly && item.icon) b.dataset.iconOnly = '';
                else b.appendChild(doc.createTextNode(item.label));
                b.addEventListener('click', () => {
                    if (this.ctrl.toggle(item.id)) this.paint();
                });
                this.buttons.set(item.id, b);
                return b;
            }),
        );
        this.paint();
    }

    private paint(): void {
        applyProps(this.el, this.ctrl.rootProps());
        for (const [id, b] of this.buttons) applyProps(b, this.ctrl.itemProps(id));
    }

    private onKey(e: KeyboardEvent): void {
        const from = [...this.buttons].find(([, b]) => b === e.target)?.[0];
        if (from === undefined) return;
        const target = this.ctrl.focusTarget(from, e.key);
        if (target === null) return;
        e.preventDefault();
        this.buttons.get(target)?.focus();
        if (this.ctrl.type === 'single' && this.ctrl.toggle(target)) this.paint();
    }
}
