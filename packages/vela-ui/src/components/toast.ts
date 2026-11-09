// Toast: short notices that stack in a corner and leave on their own, shaped after shadcn's
// toast (Sonner). `toast()` raises one from anywhere on the page, with `toast.success`,
// `.info`, `.warning`, `.error` and `.loading` for its kinds, `toast.promise` for a task's
// three states and `toast.dismiss` to take one or all away; calling it again with the same
// `id` updates the toast in place. A toaster shows them: `createToaster` mounts one where the
// notices belong, over the viewport or contained in a host. The newest toast is in front and
// the older ones fold behind it; hovering the stack (or Alt+T) spreads it out and pauses the
// timers, and a toast swipes away towards its edge. Positions name the corner on the
// writing direction's terms: `bottom-right` sits at the end side, mirrored right to left.
// The queue is page-wide, so a toast raised by another copy of the kit reaches this toaster.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { msg, textOf, type Translator } from '../lib/i18n';
import { iconEl } from '../lib/icons';
import { kitTranslator } from '../lib/kit-text';
import { pageState } from '../lib/page';
import { t } from '../lib/t';
import { ensureUIHost } from '../lib/theme';

export const toastDef = defineComponent({
    name: 'toast',
    parts: ['root', 'list', 'item', 'close', 'icon', 'content', 'title', 'description', 'cancel', 'action'],
    settings: {
        width: '356px',
        radius: t.radius.lg,
        background: t.surface.elev,
        border: t.border,
        foreground: t.fg.bright,
        'description-color': t.fg.muted,
        shadow: t.shadow,
        success: t.profit,
        info: t.accent,
        warning: t.highlight,
        error: t.danger,
    },
});

export type ToastType = 'default' | 'success' | 'info' | 'warning' | 'error' | 'loading';
export type ToasterPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type SwipeDirection = 'top' | 'right' | 'bottom' | 'left';
export type ToastId = string | number;
/** Text, an element, or a function returning either (read when the toast renders). */
export type ToastContent = string | Node | (() => string | Node);

export interface ToastAction {
    label: string;
    /** Runs on a press. The toast then closes, unless the handler calls `preventDefault()`. */
    onClick: (event: MouseEvent) => void;
}

/** A toast's options: the second argument of `toast()`. */
export interface ExternalToast {
    /** Reuse an id to update that toast in place (a loading toast turned into its result). */
    id?: ToastId;
    /** The muted line under the title. */
    description?: ToastContent;
    /** An icon id from the registry or an element; null hides the kind's icon. */
    icon?: string | Node | null;
    /** How long it stays, in milliseconds (default the toaster's). `Infinity` keeps it until dismissed. */
    duration?: number;
    /** A button at the end: a label and a handler, or an element. */
    action?: ToastAction | Node;
    /** A muted button before the action; a press runs its handler and closes the toast. */
    cancel?: ToastAction | Node;
    /** A close button on the toast's corner (default the toaster's). */
    closeButton?: boolean;
    /** False: no close button, no swipe, and `toast.dismiss` is the only way out (default true). */
    dismissible?: boolean;
    /** Tint the toast with its kind's color (default the toaster's). */
    richColors?: boolean;
    /** Swap the toast's background and text colors (default the toaster's). */
    invert?: boolean;
    /** Show it on a toaster's other corner. */
    position?: ToasterPosition;
    /** Show it only on the toaster created with this `id`. */
    toasterId?: string;
    /** Extra class names (layout hooks). */
    className?: string;
    /** Called when the toast is closed: the close button, a swipe, an action or `toast.dismiss`. */
    onDismiss?: (toast: ToastT) => void;
    /** Called when the toast's time runs out. */
    onAutoClose?: (toast: ToastT) => void;
}

/** A toast as the queue holds it. */
export interface ToastT extends ExternalToast {
    id: ToastId;
    type: ToastType;
    title?: ToastContent;
}

export type PromiseSource<T> = Promise<T> | (() => Promise<T>);

export interface PromiseData<T> extends Omit<ExternalToast, 'description'> {
    /** Shown while the promise runs; without it the toast appears once the promise settles. */
    loading?: ToastContent;
    success?: ToastContent | ((data: T) => ToastContent);
    error?: ToastContent | ((error: unknown) => ToastContent);
    description?: ToastContent | ((result: T | unknown) => ToastContent);
    /** Runs once the promise settles, either way. */
    finally?: () => void;
}

export interface ToastPromise<T> {
    /** The toast's id, or undefined while no `loading` toast shows. */
    readonly id: ToastId | undefined;
    /** The promise itself, to await its value after the toast. */
    unwrap(): Promise<T>;
}

type ToastFn = (message: ToastContent, data?: ExternalToast) => ToastId;

export interface ToastFunction extends ToastFn {
    /** A plain toast (the same as calling `toast()`). */
    message: ToastFn;
    success: ToastFn;
    info: ToastFn;
    warning: ToastFn;
    error: ToastFn;
    /** A toast with a spinner that stays until it is updated or dismissed. */
    loading: ToastFn;
    /** A loading toast that turns into the promise's success or error. */
    promise<T>(promise: PromiseSource<T>, data?: PromiseData<T>): ToastPromise<T>;
    /** Close one toast, or every toast without an id. */
    dismiss(id?: ToastId): ToastId | undefined;
    /** The toasts on the page now. */
    getToasts(): ToastT[];
}

type QueueEvent = { kind: 'show'; toast: ToastT } | { kind: 'dismiss'; id: ToastId | undefined };

interface Queue {
    toasts: ToastT[];
    listeners: Set<(e: QueueEvent) => void>;
    n: number;
}

/** A page with no toaster mounted keeps only this many toasts. */
const QUEUE_CAP = 50;

const queue = pageState('toasts@1', (): Queue => ({ toasts: [], listeners: new Set(), n: 0 }));

function emit(e: QueueEvent): void {
    for (const fn of [...queue.listeners]) fn(e);
}

function raise(title: ToastContent | undefined, type: ToastType, data: ExternalToast = {}): ToastId {
    const id = data.id ?? ++queue.n;
    const at = queue.toasts.findIndex((x) => x.id === id);
    const next: ToastT = { ...(at >= 0 ? queue.toasts[at] : {}), ...data, id, type, title };
    if (at >= 0) queue.toasts[at] = next;
    else {
        queue.toasts.push(next);
        if (queue.toasts.length > QUEUE_CAP) queue.toasts.shift();
    }
    emit({ kind: 'show', toast: next });
    return id;
}

/** Take a toast off the queue and tell it why, once: every toaster showing it lets it go. */
function settle(id: ToastId, reason: 'dismiss' | 'auto'): void {
    const at = queue.toasts.findIndex((x) => x.id === id);
    if (at >= 0) {
        const [gone] = queue.toasts.splice(at, 1);
        if (reason === 'auto') gone!.onAutoClose?.(gone!);
        else gone!.onDismiss?.(gone!);
    }
    emit({ kind: 'dismiss', id });
}

const resolve = <A>(v: ToastContent | ((a: A) => ToastContent) | undefined, arg: A): ToastContent | undefined => (typeof v === 'function' && v.length > 0 ? (v as (a: A) => ToastContent)(arg) : (v as ToastContent | undefined));

function promiseToast<T>(source: PromiseSource<T>, data: PromiseData<T> = {}): ToastPromise<T> {
    const { loading, success, error, description, finally: done, ...rest } = data;
    let id: ToastId | undefined = rest.id;
    if (loading !== undefined) id = raise(loading, 'loading', { ...rest, description: resolve(description, undefined) });
    const p = typeof source === 'function' ? source() : source;
    p.then(
        (value) => {
            const title = resolve(success, value);
            if (title !== undefined) raise(title, 'success', { ...rest, id, description: resolve(description, value) });
            else if (id !== undefined) settle(id, 'dismiss');
        },
        (err: unknown) => {
            const title = resolve(error, err);
            if (title !== undefined) raise(title, 'error', { ...rest, id, description: resolve(description, err) });
            else if (id !== undefined) settle(id, 'dismiss');
        },
    ).finally(() => done?.());
    return { id, unwrap: () => p };
}

const kind =
    (type: ToastType): ToastFn =>
    (message, data) =>
        raise(message, type, data);

/** Raise a toast. Every toaster on the page shows it (or the one named by `toasterId`). */
export const toast: ToastFunction = Object.assign(kind('default'), {
    message: kind('default'),
    success: kind('success'),
    info: kind('info'),
    warning: kind('warning'),
    error: kind('error'),
    loading: kind('loading'),
    promise: promiseToast,
    dismiss(id?: ToastId): ToastId | undefined {
        if (id === undefined) for (const x of [...queue.toasts]) settle(x.id, 'dismiss');
        else settle(id, 'dismiss');
        return id;
    },
    getToasts: (): ToastT[] => queue.toasts.slice(),
});

export type ToastOffset = number | string | { top?: number | string; right?: number | string; bottom?: number | string; left?: number | string };

export interface ToasterProps {
    /** Where the toaster mounts (default the document's body). */
    host?: HTMLElement;
    /** Stack in the host's corners instead of the viewport's; the host must be positioned. */
    contained?: boolean;
    /** The corner the toasts stack in (default `bottom-right`). */
    position?: ToasterPosition;
    /** Keep the stack spread out instead of folding the older toasts behind the newest. */
    expand?: boolean;
    /** Tint each toast with its kind's color. */
    richColors?: boolean;
    /** A close button on every toast. */
    closeButton?: boolean;
    /** Swap the toasts' background and text colors. */
    invert?: boolean;
    /** How long a toast stays, in milliseconds (default 4000). */
    duration?: number;
    /** Space between spread toasts, in pixels (default 14). */
    gap?: number;
    /** How many toasts show at once (default 3). */
    visibleToasts?: number;
    /** Distance from the edges: one value, or one per side (default 24px, 16px contained). */
    offset?: ToastOffset;
    /** The keys that spread the stack and focus it: event flags and codes (default `['altKey', 'KeyT']`). */
    hotkey?: string[];
    /** The writing direction of the toasts (default the page's). */
    dir?: 'ltr' | 'rtl' | 'auto';
    /** Swipe directions that close a toast (default its corner's edges). */
    swipeDirections?: SwipeDirection[];
    /** Icons in place of the kinds' own: registry ids or elements. */
    icons?: Partial<Record<Exclude<ToastType, 'default'> | 'close', string | Node>>;
    /** Defaults for every toast of this toaster. */
    toastOptions?: Pick<ExternalToast, 'className' | 'duration' | 'closeButton' | 'richColors' | 'invert' | 'dismissible'>;
    /** The region's accessible name (default "Notifications"). */
    containerAriaLabel?: string;
    /** Name the toaster, to show only the toasts raised with this `toasterId`. */
    id?: string;
    /** A kit theme, for a toaster mounted outside a themed host. */
    theme?: Parameters<typeof ensureUIHost>[1];
    /** Translates the close button's and the region's names (default the kit's). */
    i18n?: Translator | null;
    /** Extra class names on the region (layout hooks). */
    className?: string;
}

export interface ToasterHandle {
    readonly el: HTMLElement;
    /** Re-read the region's and the close buttons' names from the translator, after its language changed. */
    relabel(): void;
    destroy(): void;
}

const TEXT = {
    region: msg('ui.toast.region', 'Notifications'),
    close: msg('ui.toast.close', 'Close toast'),
};

const DEFAULT_ICONS: Record<Exclude<ToastType, 'default'> | 'close', string> = {
    success: 'circle-check',
    info: 'circle-info',
    warning: 'triangle-alert',
    error: 'circle-x',
    loading: 'loader',
    close: 'close',
};

/** `aria-keyshortcuts` names of the hotkey's modifier flags. */
const KEY_NAMES: Record<string, string> = { altKey: 'Alt', ctrlKey: 'Control', metaKey: 'Meta', shiftKey: 'Shift' };

const SWIPE_THRESHOLD = 45;
const VELOCITY_THRESHOLD = 0.11;
/** How long a closing toast stays in the document while it animates out. */
const EXIT_MS = 400;

const injectStyles = defineStyles(
    'vela-ui-toast',
    css`
        @layer vela.ui {
            [data-slot='toast'] {
                display: contents;
            }
            [data-slot='toast-list'] {
                --_offset-top: 24px;
                --_offset-bottom: 24px;
                --_offset-start: 24px;
                --_offset-end: 24px;
                --_gap: 14px;

                position: fixed;
                z-index: ${t.z.popover};
                box-sizing: border-box;
                width: min(${toastDef.vars.width}, calc(100% - var(--_offset-start) - var(--_offset-end)));
                margin: 0;
                padding: 0;
                list-style: none;
                font-family: ${t.font};
                transition: height calc(${t.dur.med} * 2.5) ${t.ease};

                &[data-contained] {
                    position: absolute;
                }
                &[data-y='top'] {
                    top: var(--_offset-top);
                }
                &[data-y='bottom'] {
                    bottom: var(--_offset-bottom);
                }
                &[data-x='left'] {
                    inset-inline-start: var(--_offset-start);
                }
                &[data-x='right'] {
                    inset-inline-end: var(--_offset-end);
                }
                &[data-x='center'] {
                    inset-inline: 0;
                    margin-inline: auto;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 4px;
                    border-radius: ${toastDef.vars.radius};
                }
            }
            [data-slot='toast-item'] {
                --_y: 0px;
                --_scale: 1;
                --_swipe-x: 0px;
                --_swipe-y: 0px;
                --_tint: ${toastDef.vars.foreground};

                position: absolute;
                inset-inline: 0;
                box-sizing: border-box;
                gap: 6px;
                padding: 16px;
                border: 1px solid ${toastDef.vars.border};
                border-radius: ${toastDef.vars.radius};
                background: ${toastDef.vars.background};
                box-shadow: ${toastDef.vars.shadow};
                color: ${toastDef.vars.foreground};
                font-size: 13px;
                line-height: 1.4;
                opacity: 0;
                overflow-wrap: anywhere;
                touch-action: none;
                user-select: none;
                transition:
                    transform calc(${t.dur.med} * 2.5) ${t.ease},
                    opacity calc(${t.dur.med} * 2.5) ${t.ease},
                    height calc(${t.dur.med} * 2.5) ${t.ease};

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                }
                &[data-y='bottom'] {
                    bottom: 0;
                    transform: translateY(100%);
                    transform-origin: bottom center;
                }
                &[data-y='top'] {
                    top: 0;
                    transform: translateY(-100%);
                    transform-origin: top center;
                }
                &[data-mounted] {
                    opacity: 1;
                    transform: translate(var(--_swipe-x), calc(var(--_y) + var(--_swipe-y))) scale(var(--_scale));
                }
                &[data-mounted][data-visible='false'] {
                    opacity: 0;
                    pointer-events: none;
                }
                &[data-expanded='false'][data-front='false'] {
                    overflow: hidden;
                }
                &[data-expanded='false'][data-front='false'] > * {
                    opacity: 0;
                }
                &[data-removed] {
                    opacity: 0;
                    pointer-events: none;
                }
                &[data-removed='front'][data-y='bottom'] {
                    transform: translateY(100%);
                }
                &[data-removed='front'][data-y='top'] {
                    transform: translateY(-100%);
                }
                &[data-swiping] {
                    transition: none;
                }
                &::after {
                    position: absolute;
                    inset-inline: 0;
                    height: var(--_gap);
                    content: '';
                }
                &[data-y='bottom']::after {
                    top: 100%;
                }
                &[data-y='top']::after {
                    bottom: 100%;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 2px;
                }
                &[data-invert] {
                    --_tint: ${toastDef.vars.background};

                    border-color: ${toastDef.vars.foreground};
                    background: ${toastDef.vars.foreground};
                    color: ${toastDef.vars.background};
                }
                &[data-rich-colors][data-type='success'] {
                    --_tint: ${toastDef.vars.success};
                }
                &[data-rich-colors][data-type='info'] {
                    --_tint: ${toastDef.vars.info};
                }
                &[data-rich-colors][data-type='warning'] {
                    --_tint: ${toastDef.vars.warning};
                }
                &[data-rich-colors][data-type='error'] {
                    --_tint: ${toastDef.vars.error};
                }
                &[data-rich-colors]:is([data-type='success'], [data-type='info'], [data-type='warning'], [data-type='error']) {
                    border-color: color-mix(in srgb, var(--_tint) 40%, ${toastDef.vars.background});
                    background: color-mix(in srgb, var(--_tint) 14%, ${toastDef.vars.background});
                    color: color-mix(in srgb, var(--_tint) 80%, ${toastDef.vars.foreground});
                }
            }
            [data-slot='toast-icon'] {
                flex: none;
                width: 16px;
                height: 16px;
                margin-inline: -3px 4px;
                font-size: 16px;
                line-height: 0;

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                &:is([data-type='loading'] *) {
                    animation: vela-toast-spin calc(${t.dur.med} * 5) linear infinite;
                }
            }
            [data-slot='toast-content'] {
                flex: 1 1 auto;
                min-width: 0;
                gap: 2px;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                }
            }
            [data-slot='toast-title'] {
                font-weight: 500;
                line-height: 1.5;
            }
            [data-slot='toast-description'] {
                color: ${toastDef.vars['description-color']};
                font-weight: 400;
                line-height: 1.4;

                &:is([data-rich-colors] *),
                &:is([data-invert] *) {
                    color: inherit;
                    opacity: 0.85;
                }
            }
            [data-slot='toast-action'],
            [data-slot='toast-cancel'] {
                flex: none;
                height: 24px;
                padding: 0 8px;
                border: 0;
                border-radius: ${t.radius.sm};
                font: inherit;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
                transition: opacity ${t.dur.fast} ease;

                &:hover {
                    opacity: 0.88;
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 2px;
                }
            }
            [data-slot='toast-action'] {
                background: var(--_tint);
                color: ${toastDef.vars.background};
            }
            [data-slot='toast-cancel'] {
                background: color-mix(in srgb, currentcolor 12%, transparent);
                color: inherit;
            }
            [data-slot='toast-close'] {
                position: absolute;
                top: 0;
                inset-inline-start: 0;
                width: 20px;
                height: 20px;
                padding: 0;
                border: 1px solid ${toastDef.vars.border};
                border-radius: 50%;
                background: ${toastDef.vars.background};
                color: ${toastDef.vars.foreground};
                font-size: 12px;
                line-height: 0;
                cursor: pointer;
                translate: -35% -35%;
                transition:
                    opacity ${t.dur.fast} ease,
                    background ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                &:is([dir='rtl'] *) {
                    translate: 35% -35%;
                }
                &:hover {
                    background: ${t.surface.overlay};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 1px;
                }
            }

            @keyframes vela-toast-spin {
                to {
                    transform: rotate(360deg);
                }
            }
        }
    `,
);

interface View {
    toast: ToastT;
    li: HTMLLIElement;
    position: ToasterPosition;
    height: number;
    removed: boolean;
    duration: number;
    remaining: number;
    started: number;
    timer: ReturnType<typeof setTimeout> | null;
}

interface Stack {
    ol: HTMLOListElement;
    y: 'top' | 'bottom';
    x: 'left' | 'center' | 'right';
    hovered: boolean;
    interacting: boolean;
}

const px = (v: number | string): string => (typeof v === 'number' ? `${v}px` : v);

class ToasterImpl implements ToasterHandle {
    readonly el: HTMLElement;
    private readonly stacks = new Map<ToasterPosition, Stack>();
    private readonly views = new Map<ToastId, View>();
    private readonly byLi = new WeakMap<Element, View>();
    private readonly i18n: Translator | null;
    private readonly position: ToasterPosition;
    private readonly gap: number;
    private readonly visible: number;
    private paused = false;
    private hotkeyOpen = false;

    private readonly onQueue = (e: QueueEvent): void => {
        if (e.kind === 'show') {
            if ((e.toast.toasterId ?? null) !== (this.props.id ?? null)) return;
            this.show(e.toast);
        } else if (e.id === undefined) for (const v of [...this.views.values()]) this.remove(v);
        else {
            const v = this.views.get(e.id);
            if (v) this.remove(v);
        }
    };

    private readonly onKey = (e: KeyboardEvent): void => {
        const keys = this.props.hotkey ?? ['altKey', 'KeyT'];
        const pressed = keys.length > 0 && keys.every((k) => (e as unknown as Record<string, unknown>)[k] === true || e.code === k);
        if (pressed) {
            const first = [...this.stacks.values()].find((s) => s.ol.childElementCount > 0);
            if (!first) return;
            this.hotkeyOpen = true;
            first.ol.focus();
            this.relayoutAll();
            return;
        }
        if (e.key === 'Escape' && this.hotkeyOpen && this.el.contains(document.activeElement)) {
            this.hotkeyOpen = false;
            (document.activeElement as HTMLElement | null)?.blur();
            this.relayoutAll();
        }
    };

    private readonly onVisibility = (): void => this.syncTimers();

    constructor(private readonly props: ToasterProps) {
        const host = props.host ?? document.body;
        const root = host.getRootNode();
        injectStyles(root instanceof ShadowRoot ? root : host.ownerDocument);
        this.i18n = props.i18n ?? kitTranslator();
        this.position = props.position ?? 'bottom-right';
        this.gap = props.gap ?? 14;
        this.visible = props.visibleToasts ?? 3;
        const keys = (props.hotkey ?? ['altKey', 'KeyT']).map((k) => KEY_NAMES[k] ?? k.replace(/^(Key|Digit)/, '')).join('+');
        this.el = h('section', {
            className: props.className,
            slot: toastDef.slot('root'),
            attrs: {
                'aria-keyshortcuts': keys || null,
                tabindex: -1,
                'aria-live': 'polite',
                'aria-relevant': 'additions text',
                'aria-atomic': 'false',
                dir: props.dir && props.dir !== 'auto' ? props.dir : null,
            },
        });
        this.relabel();
        host.append(this.el);
        if (props.theme || !this.el.parentElement?.closest('.vela-ui')) ensureUIHost(this.el, props.theme);
        queue.listeners.add(this.onQueue);
        document.addEventListener('keydown', this.onKey);
        document.addEventListener('visibilitychange', this.onVisibility);
    }

    relabel(): void {
        this.el.setAttribute('aria-label', this.props.containerAriaLabel ?? textOf(this.i18n, TEXT.region));
        const close = textOf(this.i18n, TEXT.close);
        for (const b of this.el.querySelectorAll(`[data-slot='${toastDef.slot('close')}']`)) b.setAttribute('aria-label', close);
    }

    destroy(): void {
        queue.listeners.delete(this.onQueue);
        document.removeEventListener('keydown', this.onKey);
        document.removeEventListener('visibilitychange', this.onVisibility);
        for (const v of this.views.values()) if (v.timer) clearTimeout(v.timer);
        this.views.clear();
        this.stacks.clear();
        this.el.remove();
    }

    private stack(position: ToasterPosition): Stack {
        let s = this.stacks.get(position);
        if (s) return s;
        const [y, x] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
        const ol = h('ol', { slot: toastDef.slot('list'), data: { y, x, contained: this.props.contained ?? false }, attrs: { tabindex: -1 } });
        this.applyOffset(ol);
        const stack: Stack = { ol, y, x, hovered: false, interacting: false };
        ol.addEventListener('mouseenter', () => this.setHover(stack, true));
        ol.addEventListener('mousemove', () => this.setHover(stack, true));
        ol.addEventListener('mouseleave', () => {
            if (!stack.interacting) this.setHover(stack, false);
        });
        ol.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            stack.interacting = true;
            this.relayout(position);
        });
        ol.addEventListener('pointerup', () => {
            stack.interacting = false;
            this.relayout(position);
        });
        ol.addEventListener('focusout', (e) => {
            if (e.relatedTarget instanceof Node && ol.contains(e.relatedTarget)) return;
            this.hotkeyOpen = false;
            this.relayout(position);
        });
        // A new corner keeps the corners' order stable in the reading order of the region.
        this.el.append(ol);
        this.stacks.set(position, stack);
        return stack;
    }

    private applyOffset(ol: HTMLElement): void {
        const fallback = this.props.contained ? '16px' : '24px';
        const offset = this.props.offset ?? fallback;
        const sides = typeof offset === 'object' ? offset : { top: offset, right: offset, bottom: offset, left: offset };
        const rtl = this.props.dir === 'rtl';
        ol.style.setProperty('--_offset-top', px(sides.top ?? fallback));
        ol.style.setProperty('--_offset-bottom', px(sides.bottom ?? fallback));
        ol.style.setProperty('--_offset-start', px((rtl ? sides.right : sides.left) ?? fallback));
        ol.style.setProperty('--_offset-end', px((rtl ? sides.left : sides.right) ?? fallback));
        ol.style.setProperty('--_gap', `${this.gap}px`);
    }

    private setHover(stack: Stack, hovered: boolean): void {
        if (stack.hovered === hovered) return;
        stack.hovered = hovered;
        this.relayoutAll();
    }

    private show(toast: ToastT): void {
        const existing = this.views.get(toast.id);
        if (existing && !existing.removed) {
            existing.toast = toast;
            this.render(existing);
            existing.height = this.measure(existing.li);
            this.restartTimer(existing);
            this.relayout(existing.position);
            return;
        }
        const position = toast.position ?? this.position;
        const stack = this.stack(position);
        const li = h('li', { slot: toastDef.slot('item'), data: { y: stack.y, x: stack.x }, attrs: { tabindex: 0 } });
        const view: View = { toast, li, position, height: 0, removed: false, duration: 0, remaining: 0, started: 0, timer: null };
        this.views.set(toast.id, view);
        this.byLi.set(li, view);
        this.render(view);
        stack.ol.prepend(li);
        view.height = this.measure(li);
        this.bindSwipe(view, stack);
        this.restartTimer(view);
        this.relayout(position);
        requestAnimationFrame(() => li.setAttribute('data-mounted', ''));
    }

    private render(view: View): void {
        const { toast: x, li } = view;
        const opts = this.props.toastOptions ?? {};
        const dismissible = x.dismissible ?? opts.dismissible ?? true;
        li.className = [opts.className, x.className].filter(Boolean).join(' ');
        li.setAttribute('data-type', x.type);
        li.setAttribute('data-dismissible', String(dismissible));
        li.toggleAttribute('data-rich-colors', x.richColors ?? opts.richColors ?? this.props.richColors ?? false);
        li.toggleAttribute('data-invert', x.invert ?? opts.invert ?? this.props.invert ?? false);
        li.replaceChildren();
        if (dismissible && x.type !== 'loading' && (x.closeButton ?? opts.closeButton ?? this.props.closeButton ?? false)) {
            const close = h('button', {
                slot: toastDef.slot('close'),
                attrs: { type: 'button', 'aria-label': textOf(this.i18n, TEXT.close) },
                on: { click: () => settle(x.id, 'dismiss') },
            });
            close.append(this.icon(this.props.icons?.close ?? DEFAULT_ICONS.close));
            li.append(close);
        }
        const icon = x.icon === null ? null : (x.icon ?? (x.type === 'default' ? null : (this.props.icons?.[x.type] ?? DEFAULT_ICONS[x.type])));
        if (icon !== null) li.append(h('div', { slot: toastDef.slot('icon'), data: { type: x.type } }, this.icon(icon)));
        const content = h('div', { slot: toastDef.slot('content') });
        const title = read(x.title);
        if (title !== undefined) content.append(h('div', { slot: toastDef.slot('title') }, title));
        const description = read(x.description);
        if (description !== undefined) content.append(h('div', { slot: toastDef.slot('description') }, description));
        li.append(content);
        if (x.cancel) li.append(this.button(x, x.cancel, 'cancel'));
        if (x.action) li.append(this.button(x, x.action, 'action'));
    }

    private icon(icon: string | Node): Node {
        return typeof icon === 'string' ? iconEl(icon, this.el.ownerDocument) : icon.cloneNode(true);
    }

    private button(x: ToastT, action: ToastAction | Node, part: 'action' | 'cancel'): Node {
        if (action instanceof Node) return action;
        return h('button', {
            slot: toastDef.slot(part),
            attrs: { type: 'button' },
            text: action.label,
            on: {
                click: (e) => {
                    action.onClick(e);
                    if (part === 'cancel' || !e.defaultPrevented) settle(x.id, 'dismiss');
                },
            },
        });
    }

    /** The toast's natural height, whatever height the stack gives it. */
    private measure(li: HTMLElement): number {
        const height = li.style.height;
        li.style.height = 'auto';
        const natural = li.offsetHeight;
        li.style.height = height;
        return natural;
    }

    private remove(view: View): void {
        if (view.removed) return;
        view.removed = true;
        if (view.timer) clearTimeout(view.timer);
        view.timer = null;
        const front = view.li.getAttribute('data-front') === 'true' && !view.li.hasAttribute('data-swiped');
        view.li.setAttribute('data-removed', front ? 'front' : '');
        this.views.delete(view.toast.id);
        this.relayout(view.position);
        setTimeout(() => view.li.remove(), EXIT_MS);
    }

    private expanded(stack: Stack): boolean {
        return (this.props.expand ?? false) || stack.hovered || stack.interacting || this.hotkeyOpen;
    }

    private relayoutAll(): void {
        for (const position of this.stacks.keys()) this.relayout(position);
    }

    private relayout(position: ToasterPosition): void {
        const stack = this.stacks.get(position);
        if (!stack) return;
        // Newest first: a toast is prepended to its list.
        const items = [...stack.ol.children].flatMap((li) => {
            const v = this.byLi.get(li);
            return v && !v.removed ? [v] : [];
        });
        const expanded = this.expanded(stack);
        const lift = stack.y === 'bottom' ? -1 : 1;
        const front = items[0]?.height ?? 0;
        let offset = 0;
        let extent = 0;
        items.forEach((v, i) => {
            const visible = i < this.visible;
            const y = expanded ? lift * offset : lift * this.gap * i;
            const scale = expanded ? 1 : 1 - i * 0.05;
            const li = v.li;
            li.style.setProperty('--_y', `${y}px`);
            li.style.setProperty('--_scale', String(scale));
            li.style.height = `${expanded || i === 0 ? v.height : front}px`;
            li.style.zIndex = String(items.length - i);
            li.setAttribute('data-index', String(i));
            li.setAttribute('data-front', String(i === 0));
            li.setAttribute('data-expanded', String(expanded));
            li.setAttribute('data-visible', String(visible));
            if (visible) extent = expanded ? offset + v.height : front + this.gap * i;
            offset += v.height + this.gap;
        });
        stack.ol.style.height = `${extent}px`;
        stack.ol.toggleAttribute('data-expanded', expanded);
        this.syncTimers();
    }

    private restartTimer(view: View): void {
        if (view.timer) clearTimeout(view.timer);
        view.timer = null;
        const opts = this.props.toastOptions ?? {};
        view.duration = view.toast.type === 'loading' ? Infinity : (view.toast.duration ?? opts.duration ?? this.props.duration ?? 4000);
        view.remaining = view.duration;
        view.started = 0;
        if (!this.paused) this.runTimer(view);
    }

    private runTimer(view: View): void {
        if (view.timer || view.removed || !Number.isFinite(view.remaining)) return;
        view.started = Date.now();
        view.timer = setTimeout(() => {
            view.timer = null;
            settle(view.toast.id, 'auto');
        }, view.remaining);
    }

    /** Timers stand still while a stack is spread out or held, and while the page is hidden. */
    private syncTimers(): void {
        const paused = document.hidden || [...this.stacks.values()].some((s) => s.hovered || s.interacting) || this.hotkeyOpen;
        if (paused === this.paused) return;
        this.paused = paused;
        for (const v of this.views.values()) {
            if (paused) {
                if (!v.timer) continue;
                clearTimeout(v.timer);
                v.timer = null;
                v.remaining = Math.max(0, v.remaining - (Date.now() - v.started));
            } else this.runTimer(v);
        }
    }

    private bindSwipe(view: View, stack: Stack): void {
        const li = view.li;
        const allowed = new Set<SwipeDirection>(this.props.swipeDirections ?? [stack.y, ...(stack.x === 'center' ? [] : [this.physicalX(stack.x)])]);
        let start: { x: number; y: number; time: number } | null = null;
        let axis: 'x' | 'y' | null = null;
        let amount = 0;
        const reset = (): void => {
            start = null;
            axis = null;
            amount = 0;
            li.removeAttribute('data-swiping');
            li.style.setProperty('--_swipe-x', '0px');
            li.style.setProperty('--_swipe-y', '0px');
        };
        li.addEventListener('pointerdown', (e) => {
            if (view.removed || li.getAttribute('data-dismissible') === 'false' || view.toast.type === 'loading') return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea')) return;
            start = { x: e.clientX, y: e.clientY, time: Date.now() };
            li.setPointerCapture(e.pointerId);
        });
        li.addEventListener('pointermove', (e) => {
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (!axis) {
                if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
                axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                li.setAttribute('data-swiping', '');
            }
            const delta = axis === 'x' ? dx : dy;
            const dir: SwipeDirection = axis === 'x' ? (delta > 0 ? 'right' : 'left') : delta > 0 ? 'bottom' : 'top';
            amount = allowed.has(dir) ? delta : delta / (1.5 + Math.abs(delta) / 20);
            li.style.setProperty(axis === 'x' ? '--_swipe-x' : '--_swipe-y', `${amount}px`);
        });
        const end = (): void => {
            if (!start) return;
            const elapsed = Math.max(1, Date.now() - start.time);
            const dir: SwipeDirection | null = axis === 'x' ? (amount > 0 ? 'right' : 'left') : axis === 'y' ? (amount > 0 ? 'bottom' : 'top') : null;
            if (dir && allowed.has(dir) && (Math.abs(amount) >= SWIPE_THRESHOLD || Math.abs(amount) / elapsed > VELOCITY_THRESHOLD)) {
                const out = (axis === 'x' ? li.offsetWidth : li.offsetHeight) * Math.sign(amount);
                li.removeAttribute('data-swiping');
                li.setAttribute('data-swiped', '');
                li.style.setProperty(axis === 'x' ? '--_swipe-x' : '--_swipe-y', `${out}px`);
                start = null;
                settle(view.toast.id, 'dismiss');
                return;
            }
            reset();
        };
        li.addEventListener('pointerup', end);
        li.addEventListener('pointercancel', reset);
    }

    private physicalX(x: 'left' | 'right'): SwipeDirection {
        const rtl = (this.props.dir === 'rtl' || getComputedStyle(this.el.parentElement ?? document.documentElement).direction === 'rtl') && this.props.dir !== 'ltr';
        return rtl ? (x === 'left' ? 'right' : 'left') : x;
    }
}

function read(content: ToastContent | undefined): string | Node | undefined {
    return typeof content === 'function' ? content() : content;
}

export function createToaster(props: ToasterProps = {}): ToasterHandle {
    return new ToasterImpl(props);
}
