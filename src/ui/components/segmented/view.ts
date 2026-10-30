// Segmented VIEW — a row of option buttons on one track. Clicks and the arrow keys choose.
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { applyProps } from '../../headless';
import { segmentedController, type SegmentedController, type SegmentedControllerOptions, type SegmentedItem } from './controller';
import { SEGMENTED_CSS, SEGMENTED_STYLE_ID } from './styles';

export interface SegmentedOptions extends SegmentedControllerOptions {
    /** `md` (default) = 32px; `sm` = 28px. */
    size?: 'sm' | 'md';
    /** Stretch across the parent, options sharing the width. */
    fill?: boolean;
    className?: string;
}

export class Segmented {
    readonly el: HTMLElement;
    private readonly ctrl: SegmentedController;
    private readonly iconOnly: boolean;
    private readonly buttons = new Map<string, HTMLButtonElement>();

    constructor(opts: SegmentedOptions) {
        injectStyles(SEGMENTED_STYLE_ID, SEGMENTED_CSS, document);
        this.iconOnly = opts.iconOnly ?? false;
        this.ctrl = segmentedController({
            ...opts,
            onChange: (id) => {
                this.paint();
                opts.onChange?.(id);
            },
        });
        this.el = document.createElement('div');
        this.el.className = opts.className ? `vela-segmented ${opts.className}` : 'vela-segmented';
        this.el.dataset.size = opts.size ?? 'md';
        if (opts.fill) this.el.dataset.fill = '';
        this.el.addEventListener('keydown', (e) => this.onKey(e));
        this.build();
    }

    get value(): string | null {
        return this.ctrl.value;
    }

    /** Show an option as chosen without notifying. */
    setValue(id: string | null): void {
        this.ctrl.setValue(id);
        this.paint();
    }

    setItems(items: readonly SegmentedItem[]): void {
        this.ctrl.setItems(items);
        this.build();
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.ctrl.items.map((item) => {
                const b = doc.createElement('button');
                b.className = 'vela-segment';
                if (item.icon) b.appendChild(iconEl(item.icon, doc));
                if (this.iconOnly && item.icon) b.dataset.iconOnly = '';
                else b.appendChild(doc.createTextNode(item.label));
                b.addEventListener('click', () => {
                    if (this.ctrl.select(item.id)) this.paint();
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
        if (this.ctrl.select(target)) this.paint();
    }
}
