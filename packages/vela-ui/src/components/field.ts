// Field: the label-and-control grid the settings dialogs lay their inputs out on: rows (a
// label and its control, an optional master toggle that dims the control, an optional info
// mark), full-width toggles, stacked and inline rows, section headings and separators, and
// a factory that builds a row's control from a descriptor. Rows use `display: contents`, so
// their label and control sit on the grid's own tracks.
import type { ChartTheme } from '../lib/tokens';
import { injectStyles as injectSheet } from '../lib/styles';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { disposeWithin } from '../lib/dispose';
import { t } from '../lib/t';
import { ColorField, type ColorFieldOpts } from './color-picker';
import { widthField } from './glyph-select';
import { NumberInput } from './number-input';
import { Select, type SelectListPopoverOpts, type SelectOption } from './select';
import { Checkbox } from './checkbox';
import { TextArea } from './text-area';
import { Input } from './input';

export type FieldGridVariant = 'settings' | 'inputs';
export type FieldLabelSize = 'sm' | 'md';

/** Label↔control and between-row rhythm shared by the settings surfaces. */
export const FIELD_GAP_PX = 16;

/** Grid tracks for a field grid. Settings hugs both columns; inputs give leftover
 *  space to the control column. Mobile flips the label to a flexible track. */
export function fieldGridColumns(variant: FieldGridVariant, mobile: boolean): string {
    if (variant === 'inputs') return mobile ? 'minmax(0,1fr) auto' : 'max-content 1fr';
    return mobile ? 'minmax(0,1fr) max-content' : 'max-content max-content';
}

export const fieldDef = defineComponent({
    name: 'field',
    parts: ['grid', 'row', 'span', 'label', 'cell', 'bool', 'stacked', 'stacked-head', 'inline', 'inline-item', 'toggle-label', 'section', 'sep'],
});

type FieldPart = (typeof fieldDef.parts)[number];

const GAP = `${FIELD_GAP_PX}px`;

const injectFieldStyles = defineStyles(
    'vela-ui-field',
    css`
        @layer vela.ui {
            [data-slot~='field-grid'] {
                align-items: center;
                align-content: start;
                column-gap: ${GAP};
                row-gap: ${GAP};

                &:where(:not([hidden])) {
                    display: grid;
                }
                &[data-variant='inputs'] {
                    grid-template-columns: max-content 1fr;
                }
                &[data-variant='inputs'][data-mobile] {
                    grid-template-columns: minmax(0, 1fr) auto;
                }
                &[data-variant='settings'] {
                    grid-template-columns: max-content max-content;
                    column-gap: 12px;
                }
                &[data-variant='settings'][data-mobile] {
                    grid-template-columns: minmax(0, 1fr) max-content;
                }
            }
            [data-slot~='field-row']:where(:not([hidden])) {
                display: contents;
            }
            [data-slot~='field-span'] {
                grid-column: 1 / -1;
            }
            [data-slot~='field-label'] {
                opacity: 0.9;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                font-size: 14px;

                &[data-size='sm'] {
                    font-size: inherit;
                    opacity: 0.85;
                }
            }
            /* Titles are fully inert: spans, not label[for] — native labels propagate :hover
               and clicks onto their control, and both belong to the input alone. */
            [data-slot~='field-cell'] {
                display: flex;
                align-items: center;
                gap: 8px;
                justify-self: start;
            }
            [data-slot~='field-bool']:where(:not([hidden])) {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 22px;
            }
            [data-slot~='field-stacked']:where(:not([hidden])) {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }
            [data-slot~='field-stacked-head'] {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }
            [data-slot~='field-inline']:where(:not([hidden])) {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
            }
            [data-slot~='field-inline-item'] {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            [data-slot~='field-toggle-label'] {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            [data-slot~='field-section'] {
                grid-column: 1 / -1;
                margin: 24px 0 0;
                padding-bottom: 8px;
                font-size: ${t.fontSize.sm};
                font-weight: 700;
                letter-spacing: 0.05em;
                text-transform: uppercase;
                color: ${t.fg.muted};

                &[data-variant='inputs'] {
                    margin: 0;
                    padding: 20px 0 8px;
                    font-size: 11px;
                    font-weight: 600;
                }
                &[data-variant='inputs'][data-first] {
                    padding-top: 4px;
                }
                &[data-info]:where(:not([hidden])) {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
            }
            [data-slot~='field-sep'] {
                grid-column: 1 / -1;
                height: 14px;
            }
        }
    `,
);

/* A row's master toggle dims its controls. The dimmed state must beat every other style on
   the control, the host's included, so it stays outside the layers and important. */
const DIM_CSS = '.vela-field-dim { opacity: 0.4 !important; pointer-events: none !important; }';

function injectStyles(doc: Document): void {
    injectFieldStyles(doc);
    injectSheet('vela-ui-field-dim', DIM_CSS, doc);
}

/** Give an element its field parts: the `vela-field-*` classes and the `data-slot` tokens. */
function cls(el: HTMLElement, ...parts: FieldPart[]): void {
    el.className = parts.map((p) => `vela-field-${p}`).join(' ');
    el.setAttribute('data-slot', parts.map((p) => fieldDef.slot(p)).join(' '));
}
export interface FieldGridOptions {
    variant?: FieldGridVariant;
    mobile?: boolean;
}

/** Shared label/control grid. Rows with `display:contents` participate in these tracks. */
export function fieldGrid(opts: FieldGridOptions = {}): HTMLElement {
    injectStyles(document);
    const el = document.createElement('div');
    cls(el, 'grid');
    const variant = opts.variant ?? 'inputs';
    el.dataset.variant = variant;
    if (opts.mobile) el.dataset.mobile = '';
    el.style.gridTemplateColumns = fieldGridColumns(variant, opts.mobile === true);
    return el;
}

export interface FieldSectionOptions {
    variant?: FieldGridVariant;
    first?: boolean;
    /** Placed after the heading text and centered on it, such as a help mark. */
    info?: HTMLElement;
}

/** Uppercase group heading that spans the field grid. */
export function fieldSection(title: string, opts: FieldSectionOptions = {}): HTMLElement {
    injectStyles(document);
    const el = document.createElement('div');
    cls(el, 'section');
    if (opts.variant) el.dataset.variant = opts.variant;
    if (opts.first) el.dataset.first = '';
    el.textContent = title;
    if (opts.info) {
        el.dataset.info = '';
        el.appendChild(opts.info);
    }
    return el;
}

/** Vertical breathing space between row clusters. */
export function fieldSeparator(): HTMLElement {
    injectStyles(document);
    const el = document.createElement('div');
    cls(el, 'sep');
    return el;
}

export interface FieldToggleOpts {
    checked: boolean;
    onChange: (v: boolean) => void;
    get?: () => boolean;
    id?: string;
}

export interface FieldInlineItem {
    label?: string;
    id?: string;
    control: HTMLElement;
    /** Toggle sits left of its label (bool companion on an inline row). */
    toggleFirst?: boolean;
    fit?: boolean;
}

export interface FieldRowOptions {
    label: string;
    id?: string;
    control?: HTMLElement | HTMLElement[];
    info?: HTMLElement;
    toggle?: FieldToggleOpts;
    /** Full-width toggle + label (no control column). */
    bool?: boolean;
    /** Full-width stacked: centered label above a full-width control (textarea). */
    stacked?: boolean;
    /** Full-width wrap of several labeled controls. */
    inline?: FieldInlineItem[];
    /** Skip the 100px control wrap (color / session / time). */
    fit?: boolean;
    /** Wrap a single control at this width (indicator dialog number/select column). */
    controlWidth?: number;
    labelSize?: FieldLabelSize;
    className?: string;
}

function labelEl(text: string, opts: { id?: string; size?: FieldLabelSize }): HTMLElement {
    // A SPAN on purpose, never a `<label for>`: the title is fully INERT — it neither
    // reacts to hover (native labels propagate `:hover` onto their control) nor to
    // clicks. Only the input itself is interactive. The a11y association a label would
    // have given lives on the control as `aria-labelledby` instead.
    const el = document.createElement('span');
    cls(el, 'label');
    if (opts.size) el.dataset.size = opts.size;
    el.textContent = text;
    const id = opts.id;
    if (id) {
        el.id = `${id}--title`;
        // The control exists but may not be attached yet (rows are assembled before the
        // dialog mounts); after the current task it is, so the name lands reliably.
        queueMicrotask(() => {
            el.ownerDocument.getElementById(id)?.setAttribute('aria-labelledby', el.id);
        });
    }
    return el;
}

function asList(control: HTMLElement | HTMLElement[] | undefined): HTMLElement[] {
    if (!control) return [];
    return Array.isArray(control) ? control : [control];
}

function applyClass(el: HTMLElement, extra?: string): void {
    if (extra) for (const c of extra.split(/\s+/)) if (c) el.classList.add(c);
}

function dimControls(controls: HTMLElement[], on: boolean): void {
    for (const c of controls) {
        if (c.dataset.sdSelfGated === '1') continue;
        c.classList.toggle('vela-field-dim', !on);
    }
}

/** Label + control slot, optional master toggle, optional ⓘ. Grid-aware. */
export function fieldRow(opts: FieldRowOptions): HTMLElement {
    injectStyles(document);
    const size = opts.labelSize;

    if (opts.inline) {
        const wrap = document.createElement('div');
        cls(wrap, 'span', 'inline');
        for (const item of opts.inline) {
            const it = document.createElement('div');
            cls(it, 'inline-item');
            if (item.toggleFirst) it.style.flexDirection = 'row-reverse';
            if (item.label) {
                it.appendChild(labelEl(item.label, { id: item.id, size }));
            }
            if (item.fit) it.appendChild(item.control);
            else {
                const cw = document.createElement('div');
                cw.style.width = '100px';
                cw.appendChild(item.control);
                it.appendChild(cw);
            }
            wrap.appendChild(it);
        }
        if (opts.info) wrap.appendChild(opts.info);
        applyClass(wrap, opts.className);
        return wrap;
    }

    if (opts.bool) {
        const wrap = document.createElement('div');
        cls(wrap, 'span', 'bool');
        const sw = new Checkbox({
            id: opts.toggle?.id ?? opts.id,
            checked: opts.toggle?.checked ?? false,
            size: 'md',
            tone: 'bright',
            onCheckedChange: (v) => opts.toggle?.onChange(v),
        });
        wrap.append(sw.el, labelEl(opts.label, { id: opts.toggle?.id ?? opts.id, size }));
        if (opts.info) wrap.appendChild(opts.info);
        if (opts.toggle?.get) {
            const get = opts.toggle.get;
            wrap.addEventListener('vela-sync', () => { sw.setChecked(get()); });
        }
        applyClass(wrap, opts.className);
        return wrap;
    }

    if (opts.stacked) {
        const wrap = document.createElement('div');
        cls(wrap, 'span', 'stacked');
        const head = document.createElement('div');
        cls(head, 'stacked-head');
        head.appendChild(labelEl(opts.label, { id: opts.id, size }));
        if (opts.info) head.appendChild(opts.info);
        wrap.appendChild(head);
        for (const c of asList(opts.control)) wrap.appendChild(c);
        applyClass(wrap, opts.className);
        return wrap;
    }

    const wrap = document.createElement('div');
    cls(wrap, 'row');
    const controls = asList(opts.control);

    if (opts.toggle) {
        const left = document.createElement('div');
        cls(left, 'toggle-label');
        const sw = new Checkbox({
            id: opts.toggle.id ?? opts.id,
            checked: opts.toggle.checked,
            size: 'md',
            tone: 'bright',
            onCheckedChange: (v) => {
                opts.toggle!.onChange(v);
                if (controls.length > 0) dimControls(controls, v);
            },
        });
        left.append(sw.el, labelEl(opts.label, { id: opts.toggle.id ?? opts.id, size }));
        wrap.appendChild(left);
        if (controls.length > 0) dimControls(controls, opts.toggle.checked);
        if (opts.toggle.get) {
            const get = opts.toggle.get;
            wrap.addEventListener('vela-sync', () => {
                const v = get();
                sw.setChecked(v);
                if (controls.length > 0) dimControls(controls, v);
            });
        }
    } else {
        wrap.appendChild(labelEl(opts.label, { id: opts.id, size }));
    }

    const cell = document.createElement('div');
    cls(cell, 'cell');
    if (opts.controlWidth != null && controls.length === 1 && !opts.fit) {
        const cw = document.createElement('div');
        cw.style.width = `${opts.controlWidth}px`;
        cw.appendChild(controls[0]!);
        cell.appendChild(cw);
    } else {
        for (const c of controls) cell.appendChild(c);
    }
    if (opts.info) cell.appendChild(opts.info);
    wrap.appendChild(cell);
    applyClass(wrap, opts.className);
    return wrap;
}

export interface FieldControlHandle {
    el: HTMLElement;
    setValue?: (v: unknown) => void;
    /** Release the control. Discarding a subtree with {@link disposeWithin} does it too. */
    destroy(): void;
}

export type FieldControlDesc =
    | {
        kind: 'number';
        id?: string;
        value: number;
        min?: number;
        max?: number;
        step?: number;
        integer?: boolean;
        commit?: 'blur' | 'live';
        steppers?: boolean;
        fill?: boolean;
        compact?: boolean;
        clamp?: boolean;
        placeholder?: string;
        emptyValue?: number;
        title?: string;
        onChange: (v: number) => void;
        sync?: () => number;
    }
    | {
        kind: 'select';
        id?: string;
        options: readonly SelectOption[];
        value: string;
        fill?: boolean;
        theme?: ChartTheme;
        list?: SelectListPopoverOpts;
        title?: string;
        onChange: (v: string) => void;
        sync?: () => string;
    }
    | {
        kind: 'switch';
        id?: string;
        checked: boolean;
        onChange: (v: boolean) => void;
        sync?: () => boolean;
    }
    | {
        kind: 'color';
        id?: string;
        theme: ChartTheme;
        get: () => string;
        onChange: (v: string) => void;
        popover?: ColorFieldOpts['popover'];
        /** Opacity-drag commit policy (default `'live'`): `'release'` when `onChange` recomputes rather than repaints. */
        commit?: ColorFieldOpts['commit'];
        title?: string;
    }
    | {
        kind: 'text';
        id?: string;
        value: string;
        fill?: boolean;
        placeholder?: string;
        onChange: (v: string) => void;
        sync?: () => string;
    }
    | {
        kind: 'textarea';
        id?: string;
        value: string;
        rows?: number;
        autoGrow?: boolean;
        maxLines?: number;
        placeholder?: string;
        onChange: (v: string) => void;
        sync?: () => string;
    }
    | {
        kind: 'width';
        theme: ChartTheme;
        get: () => number;
        onChange: (v: number) => void;
        title?: string;
    };

/** One kit control from a neutral descriptor. `sync` re-reads on `vela-sync`. */
export function buildFieldControl(desc: FieldControlDesc): FieldControlHandle {
    if (desc.kind === 'number') {
        const ni = new NumberInput({
            id: desc.id,
            value: desc.value,
            min: desc.min,
            max: desc.max,
            step: desc.step,
            integer: desc.integer,
            size: 'md',
            fill: desc.fill,
            compact: desc.compact,
            commit: desc.commit,
            steppers: desc.steppers,
            clamp: desc.clamp,
            placeholder: desc.placeholder,
            emptyValue: desc.emptyValue,
            title: desc.title,
            onChange: desc.onChange,
        });
        if (desc.sync) {
            const sync = desc.sync;
            ni.el.addEventListener('vela-sync', () => { ni.setValue(sync()); });
        }
        return { el: ni.el, setValue: (v) => ni.setValue(Number(v)), destroy: () => ni.destroy() };
    }
    if (desc.kind === 'select') {
        const sel = new Select({
            id: desc.id,
            options: desc.options,
            value: desc.value,
            size: 'md',
            fill: desc.fill,
            theme: desc.theme,
            list: desc.list,
            onValueChange: desc.onChange,
        });
        if (desc.title) sel.el.title = desc.title;
        if (desc.sync) {
            const sync = desc.sync;
            sel.el.addEventListener('vela-sync', () => { sel.setValue(sync()); });
        }
        return { el: sel.el, setValue: (v) => sel.setValue(String(v)), destroy: () => sel.destroy() };
    }
    if (desc.kind === 'switch') {
        const sw = new Checkbox({
            id: desc.id,
            checked: desc.checked,
            size: 'md',
            tone: 'bright',
            onCheckedChange: desc.onChange,
        });
        if (desc.sync) {
            const sync = desc.sync;
            sw.el.addEventListener('vela-sync', () => { sw.setChecked(sync()); });
        }
        return { el: sw.el, setValue: (v) => sw.setChecked(Boolean(v)), destroy: () => sw.destroy() };
    }
    if (desc.kind === 'color') {
        const field = new ColorField({
            theme: desc.theme,
            getVal: desc.get,
            onVal: desc.onChange,
            shape: 'circle',
            id: desc.id,
            popover: desc.popover,
            commit: desc.commit,
        });
        if (desc.title) field.el.title = desc.title;
        return { el: field.el, destroy: () => field.destroy() };
    }
    if (desc.kind === 'text') {
        const tf = new Input({
            id: desc.id,
            value: desc.value,
            size: 'md',
            fill: desc.fill,
            onChange: desc.onChange,
        });
        if (desc.placeholder) tf.input.placeholder = desc.placeholder;
        if (desc.sync) {
            const sync = desc.sync;
            tf.el.addEventListener('vela-sync', () => { tf.setValue(sync()); });
        }
        return { el: tf.el, setValue: (v) => tf.setValue(String(v)), destroy: () => tf.destroy() };
    }
    if (desc.kind === 'textarea') {
        const ta = new TextArea({
            id: desc.id,
            value: desc.value,
            rows: desc.rows,
            autoGrow: desc.autoGrow,
            maxLines: desc.maxLines,
            placeholder: desc.placeholder,
            onChange: desc.onChange,
        });
        if (desc.sync) {
            const sync = desc.sync;
            ta.el.addEventListener('vela-sync', () => { ta.setValue(sync()); });
        }
        return { el: ta.el, setValue: (v) => ta.setValue(String(v)), destroy: () => ta.destroy() };
    }
    const el = widthField(desc.theme, desc.get, desc.onChange);
    if (desc.title) el.title = desc.title;
    return { el, destroy: () => disposeWithin(el) };
}