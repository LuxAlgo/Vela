// Menu VIEW — projects MenuItemDescriptor[] into a floating list driven by the Zag menu
// machine (keyboard nav, typeahead, dismiss handled by the machine).
import { runMachine, spreadProps, type HandleOf } from '../../zag';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { menuController, type MenuControllerOptions, type MenuItemDescriptor } from './controller';
import { MENU_CSS, MENU_STYLE_ID } from './styles';
import * as zagMenu from '@zag-js/menu';

export interface MenuOptions extends MenuControllerOptions {
    /** Element that opens the menu on click (gets the machine's trigger props). */
    trigger?: HTMLElement;
    host?: HTMLElement;
}

export class Menu {
    private readonly positioner: HTMLElement;
    private readonly list: HTMLElement;
    private readonly handle: HandleOf<typeof zagMenu.machine>;
    private readonly ctrl: ReturnType<typeof menuController>;
    private items: readonly MenuItemDescriptor[];

    constructor(opts: MenuOptions) {
        const anchor = opts.trigger ?? opts.host ?? document.body;
        const doc = anchor.ownerDocument;
        injectStyles(MENU_STYLE_ID, MENU_CSS, doc);
        this.items = opts.items;

        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-ui-layer';
        this.list = doc.createElement('ul');
        this.list.className = 'vela-menu';
        this.positioner.appendChild(this.list);
        const host = opts.host ?? (anchor.closest?.('.vela-ui') as HTMLElement | null) ?? doc.body;
        host.appendChild(this.positioner);

        this.ctrl = menuController(opts);
        this.buildItems(doc);
        const mid = String(this.ctrl.props.id);
        if (opts.triggerId && opts.trigger) opts.trigger.id = opts.triggerId;
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            if (opts.trigger) spreadProps(opts.trigger, api.getTriggerProps(), mid);
            spreadProps(this.positioner, api.getPositionerProps(), mid);
            spreadProps(this.list, api.getContentProps(), mid);
            for (const li of this.list.children) {
                const id = (li as HTMLElement).dataset.veiId;
                if (id) spreadProps(li as HTMLElement, api.getItemProps({ value: id, disabled: this.byId(id)?.disabled }), mid);
            }
        });
    }

    get api(): zagMenu.Api {
        return this.ctrl.connect(this.handle.service);
    }

    open(): void {
        this.api.setOpen(true);
    }

    /** Open anchored to a viewport point (context menus). */
    openAt(clientX: number, clientY: number): void {
        const api = this.api;
        api.setOpen(true);
        api.reposition({ getAnchorRect: () => ({ x: clientX, y: clientY, width: 0, height: 0 }) });
    }

    close(): void {
        this.api.setOpen(false);
    }

    /** Swap the item descriptors (e.g. checked states) and re-project. */
    setItems(items: readonly MenuItemDescriptor[]): void {
        this.items = items;
        this.buildItems(this.list.ownerDocument);
        this.handle.flush();
    }

    destroy(): void {
        this.handle.stop();
        this.positioner.remove();
    }

    private byId(id: string): MenuItemDescriptor | undefined {
        return this.items.find((i) => i.id === id);
    }

    private buildItems(doc: Document): void {
        this.list.replaceChildren();
        for (const item of this.items) {
            if (item.separatorBefore) {
                const sep = doc.createElement('li');
                sep.className = 'vela-menu-sep';
                sep.setAttribute('role', 'separator');
                this.list.appendChild(sep);
            }
            const li = doc.createElement('li');
            li.className = 'vela-menu-item';
            li.dataset.veiId = item.id;
            if (item.checked) li.dataset.checked = '1';
            const check = doc.createElement('span');
            check.className = 'vela-menu-check';
            check.textContent = item.checked ? '✓' : '';
            li.appendChild(check);
            if (item.icon) li.appendChild(iconEl(item.icon, doc));
            const label = doc.createElement('span');
            label.className = 'vela-menu-label';
            label.textContent = item.label;
            li.appendChild(label);
            if (item.hint) {
                const hint = doc.createElement('span');
                hint.className = 'vela-menu-hint';
                hint.textContent = item.hint;
                li.appendChild(hint);
            }
            this.list.appendChild(li);
        }
    }
}
