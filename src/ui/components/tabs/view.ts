// Tabs VIEW — a tab list of buttons. Clicks and the arrow keys select; the caller shows
// whatever the selected tab stands for (panels, or a filter of one view).
import { injectStyles } from '../../styles';
import { applyProps } from '../../headless';
import { tabsController, type TabItem, type TabsController, type TabsControllerOptions } from './controller';
import { TABS_CSS, TABS_STYLE_ID } from './styles';

export type TabsVariant = 'default' | 'line' | 'filled' | 'soft' | 'nav';

export interface TabsOptions extends TabsControllerOptions {
    /** Default `default` (`nav` reads best vertical). */
    variant?: TabsVariant;
    /** Extra class names on the list (the host's layout of the strip). */
    className?: string;
    /** Extra class names on every tab. */
    tabClassName?: string;
}

export class Tabs {
    readonly el: HTMLElement;
    private readonly ctrl: TabsController;
    private readonly variant: TabsVariant;
    private readonly tabClassName: string | undefined;
    private readonly buttons = new Map<string, HTMLButtonElement>();

    constructor(opts: TabsOptions) {
        injectStyles(TABS_STYLE_ID, TABS_CSS, document);
        this.variant = opts.variant ?? 'default';
        this.tabClassName = opts.tabClassName;
        this.ctrl = tabsController({
            ...opts,
            onChange: (id) => {
                this.paint();
                opts.onChange?.(id);
            },
        });
        this.el = document.createElement('div');
        this.el.className = opts.className ? `vela-tabs ${opts.className}` : 'vela-tabs';
        this.el.dataset.variant = this.variant;
        this.el.addEventListener('keydown', (e) => this.onKey(e));
        this.build();
    }

    get value(): string | null {
        return this.ctrl.value;
    }

    /** Show a tab as selected without notifying. */
    setValue(id: string | null): void {
        this.ctrl.setValue(id);
        this.paint();
    }

    setItems(items: readonly TabItem[]): void {
        this.ctrl.setItems(items);
        this.build();
    }

    /** Hide or show a tab. Hiding the selected tab selects the first available one (notified). */
    setHidden(id: string, hidden: boolean): void {
        this.ctrl.setHidden(id, hidden);
        this.paint();
    }

    /** The button of a tab (null: unknown id). */
    tab(id: string): HTMLButtonElement | null {
        return this.buttons.get(id) ?? null;
    }

    /** The attributes for a panel the caller renders (`panels: true`). */
    panelProps(id: string): ReturnType<TabsController['panelProps']> {
        return this.ctrl.panelProps(id);
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.ctrl.items.map((item) => {
                const b = doc.createElement('button');
                b.className = this.tabClassName ? `vela-tab ${this.tabClassName}` : 'vela-tab';
                b.dataset.variant = this.variant;
                b.textContent = item.label;
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
        applyProps(this.el, this.ctrl.listProps());
        for (const [id, b] of this.buttons) applyProps(b, this.ctrl.tabProps(id));
    }

    private onKey(e: KeyboardEvent): void {
        const from = [...this.buttons].find(([, b]) => b === e.target)?.[0];
        if (from === undefined) return;
        if (this.ctrl.activationMode === 'manual' && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            if (this.ctrl.select(from)) this.paint();
            return;
        }
        const target = this.ctrl.focusTarget(from, e.key);
        if (target === null) return;
        e.preventDefault();
        this.buttons.get(target)?.focus();
        if (this.ctrl.activationMode === 'automatic' && this.ctrl.select(target)) this.paint();
    }
}
