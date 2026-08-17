// Field VIEW — labeled row, section heading, and the typed-control factory.
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../styles';
import { Switch } from '../switch';
import { Select, type SelectListPopoverOpts, type SelectOption } from '../select';
import { NumberInput } from '../number-input';
import { TextField } from '../text-field';
import { TextArea } from '../text-area';
import { colorField, type ColorFieldOpts } from '../color-picker';
import { widthField } from '../glyph-select';
import { fieldGridColumns, type FieldGridVariant, type FieldLabelSize } from './controller';
import { FIELD_CSS, FIELD_STYLE_ID } from './styles';

function ensureFieldStyles(doc: Document = document): void {
    injectStyles(FIELD_STYLE_ID, FIELD_CSS, doc);
}

export interface FieldGridOptions {
    variant?: FieldGridVariant;
    mobile?: boolean;
}

/** Shared label/control grid. Rows with `display:contents` participate in these tracks. */
export function fieldGrid(opts: FieldGridOptions = {}): HTMLElement {
    ensureFieldStyles();
    const el = document.createElement('div');
    el.className = 'vela-field-grid';
    const variant = opts.variant ?? 'inputs';
    el.dataset.variant = variant;
    if (opts.mobile) el.dataset.mobile = '';
    el.style.gridTemplateColumns = fieldGridColumns(variant, opts.mobile === true);
    return el;
}

export interface FieldSectionOptions {
    variant?: FieldGridVariant;
    first?: boolean;
}

/** Uppercase group heading that spans the field grid. */
export function fieldSection(title: string, opts: FieldSectionOptions = {}): HTMLElement {
    ensureFieldStyles();
    const el = document.createElement('div');
    el.className = 'vela-field-section';
    if (opts.variant) el.dataset.variant = opts.variant;
    if (opts.first) el.dataset.first = '';
    el.textContent = title;
    return el;
}

/** Vertical breathing space between row clusters. */
export function fieldSeparator(): HTMLElement {
    ensureFieldStyles();
    const el = document.createElement('div');
    el.className = 'vela-field-sep';
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
    const el = opts.id ? document.createElement('label') : document.createElement('span');
    if (opts.id && el instanceof HTMLLabelElement) el.htmlFor = opts.id;
    el.className = 'vela-field-label';
    if (opts.size) el.dataset.size = opts.size;
    el.textContent = text;
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
    ensureFieldStyles();
    const size = opts.labelSize;

    if (opts.inline) {
        const wrap = document.createElement('div');
        wrap.className = 'vela-field-span vela-field-inline';
        for (const item of opts.inline) {
            const it = document.createElement('div');
            it.className = 'vela-field-inline-item';
            if (item.toggleFirst) it.style.flexDirection = 'row-reverse';
            if (item.label) {
                const lbl = labelEl(item.label, { id: item.id, size });
                if (item.toggleFirst) lbl.style.cursor = 'pointer';
                it.appendChild(lbl);
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
        wrap.className = 'vela-field-span vela-field-bool';
        const sw = new Switch({
            id: opts.toggle?.id ?? opts.id,
            checked: opts.toggle?.checked ?? false,
            size: 'md',
            tone: 'bright',
            onChange: (v) => opts.toggle?.onChange(v),
        });
        wrap.append(sw.el, labelEl(opts.label, { size }));
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
        wrap.className = 'vela-field-span vela-field-stacked';
        const head = document.createElement('div');
        head.className = 'vela-field-stacked-head';
        head.appendChild(labelEl(opts.label, { id: opts.id, size }));
        if (opts.info) head.appendChild(opts.info);
        wrap.appendChild(head);
        for (const c of asList(opts.control)) wrap.appendChild(c);
        applyClass(wrap, opts.className);
        return wrap;
    }

    const wrap = document.createElement('div');
    wrap.className = 'vela-field-row';
    const controls = asList(opts.control);

    if (opts.toggle) {
        const left = document.createElement('div');
        left.className = 'vela-field-toggle-label';
        const sw = new Switch({
            id: opts.toggle.id ?? opts.id,
            checked: opts.toggle.checked,
            size: 'md',
            tone: 'bright',
            onChange: (v) => {
                opts.toggle!.onChange(v);
                if (controls.length > 0) dimControls(controls, v);
            },
        });
        left.append(sw.el, labelEl(opts.label, { size }));
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
    cell.className = 'vela-field-cell';
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
        theme?: VelaTheme;
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
        theme: VelaTheme;
        get: () => string;
        onChange: (v: string) => void;
        popover?: ColorFieldOpts['popover'];
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
        theme: VelaTheme;
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
        return { el: ni.el, setValue: (v) => ni.setValue(Number(v)) };
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
            onChange: desc.onChange,
        });
        if (desc.title) sel.el.title = desc.title;
        if (desc.sync) {
            const sync = desc.sync;
            sel.el.addEventListener('vela-sync', () => { sel.setValue(sync()); });
        }
        return { el: sel.el, setValue: (v) => sel.setValue(String(v)) };
    }
    if (desc.kind === 'switch') {
        const sw = new Switch({
            id: desc.id,
            checked: desc.checked,
            size: 'md',
            tone: 'bright',
            onChange: desc.onChange,
        });
        if (desc.sync) {
            const sync = desc.sync;
            sw.el.addEventListener('vela-sync', () => { sw.setChecked(sync()); });
        }
        return { el: sw.el, setValue: (v) => sw.setChecked(Boolean(v)) };
    }
    if (desc.kind === 'color') {
        const el = colorField(desc.theme, desc.get, desc.onChange, {
            shape: 'circle',
            id: desc.id,
            popover: desc.popover,
        });
        if (desc.title) el.title = desc.title;
        return { el };
    }
    if (desc.kind === 'text') {
        const tf = new TextField({
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
        return { el: tf.el, setValue: (v) => tf.setValue(String(v)) };
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
        return { el: ta.el, setValue: (v) => ta.setValue(String(v)) };
    }
    const el = widthField(desc.theme, desc.get, desc.onChange);
    if (desc.title) el.title = desc.title;
    return { el };
}
