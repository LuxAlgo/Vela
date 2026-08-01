// Menu VIEW — projects MenuItemDescriptor[] into a floating list driven by the Zag menu
// machine (keyboard nav, typeahead, dismiss handled by the machine). An item carrying
// `submenu` becomes a trigger row owning a nested machine + list, registered as this
// machine's child: Zag then drives hover intent, arrow-key traversal and the dismiss
// chain across levels instead of the view faking any of it.
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
    /** Override the root list's min-width (the stylesheet default suits full-word labels;
     *  compact lists like the timeframe dropdown pass something snug). Submenus keep the
     *  default. */
    minWidth?: string;
}

interface SurfaceOptions {
    host: HTMLElement;
    placement: MenuControllerOptions['placement'];
    onSelect: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
    trigger?: HTMLElement;
    triggerId?: string;
    id?: string;
    minWidth?: string;
}

/**
 * One menu level: a Zag machine plus the floating list it projects onto. The root menu is a
 * surface and every branch spawns another, so nesting is depth-agnostic. Private — `Menu`
 * is the public face.
 */
class Surface {
    readonly list: HTMLElement;
    readonly handle: HandleOf<typeof zagMenu.machine>;
    private readonly positioner: HTMLElement;
    private readonly ctrl: ReturnType<typeof menuController>;
    private readonly mid: string;
    private readonly doc: Document;
    private readonly host: HTMLElement;
    private readonly onSelect: (id: string) => void;
    private items: readonly MenuItemDescriptor[] = [];
    /** Branch item id → the surface it opens. */
    private readonly subs = new Map<string, Surface>();

    constructor(doc: Document, opts: SurfaceOptions) {
        this.doc = doc;
        this.host = opts.host;
        this.onSelect = opts.onSelect;

        this.positioner = doc.createElement('div');
        this.positioner.className = 'vela-ui-layer';
        this.list = doc.createElement('ul');
        this.list.className = 'vela-menu';
        if (opts.minWidth) this.list.style.minWidth = opts.minWidth;
        this.positioner.appendChild(this.list);
        this.host.appendChild(this.positioner);

        this.ctrl = menuController({
            items: [],
            id: opts.id,
            placement: opts.placement,
            onSelect: (id) => this.onSelect(id),
            onOpenChange: opts.onOpenChange,
            triggerId: opts.triggerId,
        });
        this.mid = String(this.ctrl.props.id);
        const trigger = opts.trigger;
        if (opts.triggerId && trigger) trigger.id = opts.triggerId;
        this.handle = runMachine(this.ctrl.machine, this.ctrl.props, (service) => {
            const api = this.ctrl.connect(service);
            if (trigger) spreadProps(trigger, api.getTriggerProps(), this.mid);
            spreadProps(this.positioner, api.getPositionerProps(), this.mid);
            spreadProps(this.list, api.getContentProps(), this.mid);
            this.project(api);
        });
    }

    get api(): zagMenu.Api {
        return this.ctrl.connect(this.handle.service);
    }

    setItems(items: readonly MenuItemDescriptor[]): void {
        this.items = items;
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        this.build();
        const api = this.api;
        for (const sub of this.subs.values()) {
            api.setChild(sub.handle.service);
            sub.api.setParent(this.handle.service);
        }
        this.handle.flush();
        // Those two are queued sends: a child only learns it IS a submenu on the next
        // microtask, and a branch row's props (hover intent, the trigger-item part) are
        // derived from that. Re-project once the queue has drained.
        if (this.subs.size > 0) queueMicrotask(() => this.handle.flush());
    }

    destroy(): void {
        for (const sub of this.subs.values()) sub.destroy();
        this.subs.clear();
        this.handle.stop();
        this.positioner.remove();
    }

    private byId(id: string): MenuItemDescriptor | undefined {
        return this.items.find((i) => i.id === id);
    }

    /** Push the machine's item props onto the rendered rows. A branch takes the submenu
     *  trigger props, which carry the child's ids and hover handlers; a leaf takes plain ones. */
    private project(api: zagMenu.Api): void {
        for (const li of this.list.children) {
            const id = (li as HTMLElement).dataset.veiId;
            if (!id) continue;
            const sub = this.subs.get(id);
            if (sub) {
                spreadProps(li as HTMLElement, api.getTriggerItemProps(sub.api), this.mid);
                continue;
            }
            const item = this.byId(id);
            // Switch rows keep the menu OPEN on selection — flip, see, flip again.
            spreadProps(li as HTMLElement, api.getItemProps({ value: id, disabled: item?.disabled, closeOnSelect: item?.toggle ? false : undefined }), this.mid);
        }
    }

    private build(): void {
        const doc = this.doc;
        this.list.replaceChildren();
        for (const item of this.items) {
            if (item.separatorBefore) {
                const sep = doc.createElement('li');
                sep.className = 'vela-menu-sep';
                sep.setAttribute('role', 'separator');
                this.list.appendChild(sep);
            }
            const branch = item.submenu !== undefined && item.submenu.length > 0;
            const li = doc.createElement('li');
            li.className = 'vela-menu-item';
            li.dataset.veiId = item.id;
            if (item.toggle) {
                // Switch row: the pill carries the state.
                // (Zag owns the item's ARIA props; the pill below is decorative.)
                li.dataset.toggle = '1';
            } else if (!branch && item.checked) {
                // Selection reads from the row itself (brighter surface + bright ink) —
                // no checkmark glyph.
                li.dataset.checked = '1';
            }
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
            if (item.toggle) {
                const sw = doc.createElement('span');
                sw.className = 'vela-menu-switch' + (item.checked ? ' on' : '');
                sw.setAttribute('aria-hidden', 'true');
                li.appendChild(sw);
            }
            if (branch) {
                li.dataset.branch = '1';
                const arrow = iconEl('chevron-right', doc);
                arrow.classList.add('vela-menu-arrow');
                li.appendChild(arrow);
                const sub = new Surface(doc, {
                    host: this.host,
                    placement: 'right-start',
                    onSelect: this.onSelect,
                    id: `${this.mid}--${item.id}`,
                });
                sub.setItems(item.submenu ?? []);
                this.subs.set(item.id, sub);
            }
            this.list.appendChild(li);
        }
    }
}

export class Menu {
    private readonly root: Surface;

    constructor(opts: MenuOptions) {
        const anchor = opts.trigger ?? opts.host ?? document.body;
        const doc = anchor.ownerDocument;
        injectStyles(MENU_STYLE_ID, MENU_CSS, doc);
        const host = opts.host ?? (anchor.closest?.('.vela-ui') as HTMLElement | null) ?? doc.body;
        this.root = new Surface(doc, {
            host,
            placement: opts.placement,
            onSelect: (id) => opts.onSelect?.(id),
            onOpenChange: opts.onOpenChange,
            trigger: opts.trigger,
            triggerId: opts.triggerId,
            id: opts.id,
            minWidth: opts.minWidth,
        });
        this.root.setItems(opts.items);
    }

    get api(): zagMenu.Api {
        return this.root.api;
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
        this.root.setItems(items);
    }

    destroy(): void {
        this.root.destroy();
    }
}
