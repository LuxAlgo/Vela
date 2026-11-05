// ContextMenu: the dropdown menu's list, opened where the user asks for it instead of from a
// button: a right-click on the target, a long press on a touch screen, or the keyboard's
// context-menu key on a focused target. The rows can depend on the spot: `items` may be a
// function of the event that opened the menu, asked at every opening. Its look is the dropdown
// menu's (a theme styles both through `dropdown-menu`), and the list is built on first open.
import type { Translator } from '../lib/i18n';
import { kitTranslator } from '../lib/kit-text';
import { ownTeardown } from '../lib/dispose';
import type { CollisionBoundary } from '../lib/placement';
import { DropdownMenu, type DropdownMenuApi, type MenuItemDescriptor } from './dropdown-menu';

/** The rows, or a function of the opening event that returns them (null: no menu here). */
export type ContextMenuItems = readonly MenuItemDescriptor[] | ((event: MouseEvent | PointerEvent) => readonly MenuItemDescriptor[] | null);

export interface ContextMenuProps {
    /** What a right-click, a long press or the context-menu key opens the menu on. */
    target: HTMLElement;
    /** The rows, or a function asked with the event at every opening (rows that depend on the
     *  spot: a list's row, a chart's zone). A function returning null or no rows opens nothing
     *  and leaves the event to the page. */
    items: ContextMenuItems;
    onSelect?: (id: string) => void;
    onOpenChange?: (open: boolean) => void;
    /** Where the list mounts (default: the target's kit host, found when the menu first opens). */
    host?: HTMLElement;
    /** Open on a long press on touch screens (default true). Turn it off where a long press
     *  already means something, like a chart's touch crosshair. */
    longPress?: boolean;
    /** Checked rows show a leading ✓ (default true), see the dropdown menu's `checkmarks`. */
    checkmarks?: boolean;
    /** See the dropdown menu's `iconBadges`. */
    iconBadges?: boolean;
    /** Override the list's min-width. */
    minWidth?: string;
    /** Star-toggle reports from rows carrying `favorite`. */
    onFavorite?: (id: string, on: boolean) => void;
    /** Room kept from the collision area's edges, in px. */
    collisionPadding?: number;
    /** The area the list stays inside (default: the viewport and the target's clipping containers). */
    collisionBoundary?: CollisionBoundary;
    /** The translator of the menu's own words (a star's name). Default: the kit build's, else English. */
    i18n?: Translator | null;
}

const LONG_PRESS_MS = 500;
/** A touch that travels further than this is a scroll or a drag, not a press. */
const PRESS_SLOP_PX = 10;

export class ContextMenu {
    readonly target: HTMLElement;
    private readonly props: ContextMenuProps;
    private readonly i18n: Translator | null;
    private readonly longPress: boolean;
    private items: ContextMenuItems;
    private menu: DropdownMenu | null = null;
    private press: { x: number; y: number; pointer: number; event: PointerEvent; timer: ReturnType<typeof setTimeout> } | null = null;
    /** A long press opened the menu: the click its release makes, and the native context menu
     *  some touch browsers send, are its own. */
    private pressOpened = false;
    private readonly release: () => void;

    constructor(props: ContextMenuProps) {
        this.props = props;
        this.target = props.target;
        this.items = props.items;
        this.i18n = props.i18n ?? kitTranslator();
        this.longPress = props.longPress !== false;
        const target = this.target;
        target.addEventListener('contextmenu', this.onContextMenu);
        if (this.longPress) {
            target.addEventListener('pointerdown', this.onPointerDown);
            target.addEventListener('pointermove', this.onPointerMove);
            target.addEventListener('pointerup', this.cancelPress);
            target.addEventListener('pointercancel', this.cancelPress);
            target.addEventListener('click', this.onClick, true);
            target.style.setProperty('-webkit-touch-callout', 'none');
        }
        this.release = ownTeardown(target, () => this.teardown());
    }

    /** Zag's menu api (the list is built if it was not yet). */
    get api(): DropdownMenuApi {
        return this.ensureMenu().api;
    }

    get open(): boolean {
        return this.menu?.api.open ?? false;
    }

    /** Open at a viewport point. A function `items` is asked with `event`, else with a
     *  synthetic `contextmenu` at that point. Returns whether a menu opened. */
    openAt(x: number, y: number, event?: MouseEvent | PointerEvent): boolean {
        const items = typeof this.items === 'function' ? this.items(event ?? new MouseEvent('contextmenu', { clientX: x, clientY: y })) : this.items;
        if (!items || items.length === 0) return false;
        const menu = this.ensureMenu();
        menu.setItems(items);
        menu.openAt(x, y);
        return true;
    }

    close(): void {
        this.menu?.close();
    }

    /** Replace the rows (or the function that gives them). An open menu shows rows at once. */
    setItems(items: ContextMenuItems): void {
        this.items = items;
        if (this.menu && this.open && typeof items !== 'function') this.menu.setItems(items);
    }

    destroy(): void {
        this.release();
    }

    private ensureMenu(): DropdownMenu {
        if (this.menu) return this.menu;
        const p = this.props;
        this.menu = new DropdownMenu({
            host: p.host ?? this.target,
            items: [],
            side: 'bottom',
            align: 'start',
            checkmarks: p.checkmarks ?? true,
            i18n: this.i18n,
            onSelect: (id) => p.onSelect?.(id),
            ...(p.onOpenChange ? { onOpenChange: p.onOpenChange } : {}),
            ...(p.iconBadges !== undefined ? { iconBadges: p.iconBadges } : {}),
            ...(p.minWidth !== undefined ? { minWidth: p.minWidth } : {}),
            ...(p.onFavorite ? { onFavorite: p.onFavorite } : {}),
            ...(p.collisionPadding !== undefined ? { collisionPadding: p.collisionPadding } : {}),
            ...(p.collisionBoundary !== undefined ? { collisionBoundary: p.collisionBoundary } : {}),
        });
        return this.menu;
    }

    private readonly onContextMenu = (e: MouseEvent): void => {
        // An inner menu (or a guard) already answered this right-click.
        if (e.defaultPrevented) return;
        if (this.pressOpened) {
            e.preventDefault();
            return;
        }
        // A touch browser's own long-press event, sent before our timer: it opens the menu instead.
        const pressing = this.press !== null;
        this.cancelPress();
        // The context-menu key reports no pointer: open under the focused element.
        let x = e.clientX;
        let y = e.clientY;
        const focused = e.target as Element | null;
        if (x === 0 && y === 0 && focused && typeof focused.getBoundingClientRect === 'function') {
            const r = focused.getBoundingClientRect();
            x = r.left;
            y = r.bottom;
        }
        if (!this.openAt(x, y, e)) return;
        e.preventDefault();
        if (pressing) this.pressOpened = true;
    };

    private readonly onPointerDown = (e: PointerEvent): void => {
        this.pressOpened = false;
        if (e.pointerType === 'mouse' || !e.isPrimary) return;
        this.cancelPress();
        const timer = setTimeout(() => {
            const press = this.press;
            this.press = null;
            if (press && this.openAt(press.x, press.y, press.event)) this.pressOpened = true;
        }, LONG_PRESS_MS);
        this.press = { x: e.clientX, y: e.clientY, pointer: e.pointerId, event: e, timer };
    };

    private readonly onPointerMove = (e: PointerEvent): void => {
        const press = this.press;
        if (press && e.pointerId === press.pointer && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX) this.cancelPress();
    };

    private readonly cancelPress = (): void => {
        if (this.press) clearTimeout(this.press.timer);
        this.press = null;
    };

    private readonly onClick = (e: MouseEvent): void => {
        if (!this.pressOpened) return;
        this.pressOpened = false;
        e.preventDefault();
        e.stopPropagation();
    };

    private teardown(): void {
        this.cancelPress();
        const target = this.target;
        target.removeEventListener('contextmenu', this.onContextMenu);
        if (this.longPress) {
            target.removeEventListener('pointerdown', this.onPointerDown);
            target.removeEventListener('pointermove', this.onPointerMove);
            target.removeEventListener('pointerup', this.cancelPress);
            target.removeEventListener('pointercancel', this.cancelPress);
            target.removeEventListener('click', this.onClick, true);
            target.style.removeProperty('-webkit-touch-callout');
        }
        this.menu?.destroy();
        this.menu = null;
    }
}

export function createContextMenu(props: ContextMenuProps): ContextMenu {
    return new ContextMenu(props);
}
