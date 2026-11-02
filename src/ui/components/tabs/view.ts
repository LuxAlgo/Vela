// Tabs VIEW — a tab list of buttons over Zag's tabs machine. Clicks and the arrow keys
// select; the caller shows whatever the selected tab stands for (panels it attaches, or a
// filter of one view).
import type * as tabs from '@zag-js/tabs';
import { injectStyles } from '../../styles';
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { tabAvailable, tabsController, type TabItem, type TabsController, type TabsControllerOptions } from './controller';
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
    private readonly handle: HandleOf<typeof tabs.machine>;
    private readonly mid: string;
    private readonly variant: TabsVariant;
    private readonly tabClassName: string | undefined;
    private readonly panels: boolean;
    private items: TabItem[];
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly panelEls = new Map<string, HTMLElement>();
    /** The selection as of the last write or report — the machine applies events on a
     *  microtask, so its own value lags a write. */
    private current: string | null;
    /** A host write the machine has yet to report: that report is not the user's change. */
    private silentNext: string | undefined;

    constructor(opts: TabsOptions) {
        injectStyles(TABS_STYLE_ID, TABS_CSS, document);
        this.variant = opts.variant ?? 'default';
        this.tabClassName = opts.tabClassName;
        this.panels = opts.panels ?? false;
        this.items = [...opts.items];
        this.ctrl = tabsController({
            ...opts,
            onChange: (id) => {
                if (id == null) return;
                this.current = id;
                if (this.silentNext === id) {
                    this.silentNext = undefined;
                    return;
                }
                opts.onChange?.(id);
            },
        });
        this.current = (this.ctrl.props.defaultValue as string | null | undefined) ?? null;
        this.mid = String(this.ctrl.props.id);
        this.el = document.createElement('div');
        this.el.className = opts.className ? `vela-tabs ${opts.className}` : 'vela-tabs';
        this.el.dataset.variant = this.variant;
        this.el.dataset.slot = 'tabs-list';
        this.build();
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => this.render(service));
    }

    get value(): string | null {
        return this.current;
    }

    /** Show a tab as selected without notifying. */
    setValue(id: string | null): void {
        if (id === this.current) return;
        this.current = id;
        if (id === null) {
            this.api().clearValue();
            return;
        }
        this.silentNext = id;
        this.api().setValue(id);
    }

    setItems(items: readonly TabItem[]): void {
        this.items = [...items];
        this.build();
        if (this.current === null || !this.items.some((i) => i.id === this.current)) this.setValue(this.items.find(tabAvailable)?.id ?? null);
        this.handle.flush();
    }

    /** Hide or show a tab. Hiding the selected tab selects the first available one (notified). */
    setHidden(id: string, hidden: boolean): void {
        this.items = this.items.map((i) => (i.id === id ? { ...i, hidden } : i));
        if (hidden && this.current === id) {
            const next = this.items.find(tabAvailable)?.id;
            if (next !== undefined) {
                this.current = next;
                this.api().setValue(next);
            }
        }
        this.handle.flush();
    }

    /** The button of a tab (null: unknown id). */
    tab(id: string): HTMLButtonElement | null {
        return this.buttons.get(id) ?? null;
    }

    /** Make `el` the panel of tab `id` (`panels: true`): it gets the tabpanel role, its
     *  link to the tab, and `hidden` while another tab is selected. */
    attachPanel(id: string, el: HTMLElement): void {
        el.dataset.slot = 'tabs-content';
        this.panelEls.set(id, el);
        this.handle.flush();
    }

    destroy(): void {
        this.handle.stop();
    }

    private api(): tabs.Api {
        return this.ctrl.connect(this.handle.service);
    }

    private build(): void {
        this.buttons.clear();
        const doc = this.el.ownerDocument;
        this.el.replaceChildren(
            ...this.items.map((item) => {
                const b = doc.createElement('button');
                b.className = this.tabClassName ? `vela-tab ${this.tabClassName}` : 'vela-tab';
                b.dataset.variant = this.variant;
                b.dataset.slot = 'tabs-trigger';
                b.textContent = item.label;
                this.buttons.set(item.id, b);
                return b;
            }),
        );
    }

    private render(service: tabs.Service): void {
        const api = this.ctrl.connect(service);
        spreadProps(this.el, api.getListProps(), this.mid);
        for (const item of this.items) {
            const b = this.buttons.get(item.id);
            if (!b) continue;
            // A hidden tab is a disabled trigger to the machine, so the arrow keys skip it.
            const props = api.getTriggerProps({ value: item.id, disabled: !tabAvailable(item) }) as Record<string, unknown>;
            if (!this.panels) delete props['aria-controls'];
            spreadProps(b, props, this.mid);
            b.hidden = item.hidden === true;
        }
        for (const [id, el] of this.panelEls) spreadProps(el, api.getContentProps({ value: id }), this.mid);
    }
}
