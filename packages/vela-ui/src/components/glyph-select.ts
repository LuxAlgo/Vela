// GlyphSelect: a trigger showing the current option's glyph, and a list of glyph options on a
// popover. The settings dialogs' line-width field is one (`widthField`, 1–5 px).
import type { ChartTheme } from '../lib/tokens';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { Popover, closeOpenPopovers, openPopoverTrigger, type PlacementProps } from './popover';

export interface GlyphOption<T extends string | number = string | number> {
    value: T;
    label: string;
    /** Inner HTML of the preview glyph (currentColor stroke). */
    glyph: string;
}

export interface GlyphSelectControllerOptions<T extends string | number = string | number> {
    options: readonly GlyphOption<T>[];
    value: T;
    onChange?: (value: T) => void;
}

export interface GlyphSelectController<T extends string | number = string | number> {
    options: readonly GlyphOption<T>[];
    value: T;
    setValue(v: T): void;
    optionOf(value: T): GlyphOption<T> | undefined;
    pick(value: T): T;
}

/** The glyph select's options and current value, without DOM. */
export function glyphSelectController<T extends string | number>(opts: GlyphSelectControllerOptions<T>): GlyphSelectController<T> {
    let value = opts.value;
    return {
        options: opts.options,
        get value() {
            return value;
        },
        setValue(v) {
            value = v;
        },
        optionOf(v) {
            return opts.options.find((o) => o.value === v);
        },
        pick(v) {
            value = v;
            opts.onChange?.(v);
            return v;
        },
    };
}

/** The classic 1–5 px line-width ladder. */
export const WIDTH_FIELD_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];

/** A horizontal line glyph whose stroke IS the previewed weight. */
export function lineWidthGlyph(width: number): string {
    return `<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"/></svg>`;
}

export function widthFieldOptions(): readonly GlyphOption<number>[] {
    return WIDTH_FIELD_OPTIONS.map((w) => ({ value: w, label: `${w}px`, glyph: lineWidthGlyph(w) }));
}

export const glyphSelectDef = defineComponent({
    name: 'glyph-select',
    parts: ['root', 'value', 'icon', 'content', 'item'],
    settings: { radius: t.radius.md, 'content-radius': t.radius.md, 'focus-ring': `0 0 0 3px ${t.focus.soft}` },
});

/** Where the list opens beside the field (shadcn's placement props; default below and
 *  end-aligned, 6px away). */
export interface GlyphSelectOptions<T extends string | number = string | number> extends GlyphSelectControllerOptions<T>, PlacementProps {
    theme: ChartTheme;
    title?: string;
    get?: () => T;
}

export type GlyphSelectProps<T extends string | number = string | number> = GlyphSelectOptions<T>;

const injectStyles = defineStyles(
    'vela-ui-glyph-select',
    css`
        @layer vela.ui {
            [data-slot='glyph-select'] {
                height: 34px;
                padding-block: 0;
                padding-inline: 8px 26px;
                border: 1px solid ${t.border.strong};
                border-radius: ${glyphSelectDef.vars.radius};
                background: transparent;
                cursor: pointer;
                align-items: center;
                gap: 8px;
                flex: none;
                justify-self: start;
                color: ${t.fg.bright};
                font-size: 14px;
                font-family: inherit;
                outline: 2px solid transparent;
                position: relative;
                transition:
                    border-color ${t.dur.fast} ease,
                    box-shadow ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: inline-flex;
                }
                &:hover {
                    border-color: ${t.fg.muted};
                }
                &:focus {
                    border-color: ${t.focus};
                    box-shadow: ${glyphSelectDef.vars['focus-ring']};
                }
            }
            [data-slot='glyph-select-icon'] {
                position: absolute;
                inset-inline-end: 8px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                opacity: 0.55;
                color: inherit;
                line-height: 0;
                pointer-events: none;
            }
            [data-slot~='glyph-select-content'] {
                background: ${t.bg};
                border: none;
                border-radius: ${glyphSelectDef.vars['content-radius']};
                box-shadow: ${t.shadow};
                padding: 4px;
                display: flex;
                flex-direction: column;
                gap: 1px;
                color: ${t.fg};
                font: 14px ${t.font};
            }
            [data-slot='glyph-select-item'] {
                display: flex;
                align-items: center;
                gap: 8px;
                min-width: 96px;
                padding: 7px 10px;
                border: none;
                border-radius: ${t.radius.sm};
                background: transparent;
                color: inherit;
                cursor: pointer;
                text-align: start;
                font: inherit;

                &:hover {
                    background: ${t.hover};
                }
                &[data-active='1'] {
                    background: ${t.hover.strong};
                    color: ${t.fg.bright};
                }
            }
        }
    `,
);

export class GlyphSelect<T extends string | number = string | number> {
    readonly el: HTMLButtonElement;
    private readonly ctrl: GlyphSelectController<T>;
    private readonly theme: ChartTheme;
    private readonly get: () => T;
    private readonly placement: PlacementProps;

    constructor(opts: GlyphSelectOptions<T>) {
        injectStyles(document);
        this.placement = opts;
        this.ctrl = glyphSelectController(opts);
        this.theme = opts.theme;
        this.get = opts.get ?? (() => this.ctrl.value);

        const trigger = h('button', { className: 'vela-glyph-select', slot: glyphSelectDef.slot('root'), attrs: { type: 'button', title: opts.title } });
        this.el = trigger;
        this.paint();

        trigger.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            trigger.focus({ preventScroll: true });
        });
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        trigger.addEventListener('vela-sync', () => {
            this.ctrl.setValue(this.get());
            this.paint();
        });
    }

    setValue(v: T): void {
        this.ctrl.setValue(v);
        this.paint();
    }

    destroy(): void {}

    private paint(): void {
        const opt = this.ctrl.optionOf(this.get());
        const glyph = h('span', { slot: glyphSelectDef.slot('value'), style: 'display:flex' });
        glyph.innerHTML = opt?.glyph ?? '';
        const caret = h('span', { className: 'vela-glyph-select-caret', slot: glyphSelectDef.slot('icon') }, iconEl('chevron-down', this.el.ownerDocument));
        this.el.replaceChildren(glyph, caret);
    }

    private toggle(): void {
        if (openPopoverTrigger() === this.el) {
            closeOpenPopovers();
            return;
        }
        const current = this.get();
        const pop = new Popover({
            trigger: this.el,
            theme: this.theme,
            side: this.placement.side,
            align: this.placement.align ?? 'end',
            sideOffset: this.placement.sideOffset ?? 6,
            alignOffset: this.placement.alignOffset,
            avoidCollisions: this.placement.avoidCollisions,
            collisionPadding: this.placement.collisionPadding,
            collisionBoundary: this.placement.collisionBoundary,
            className: 'vela-glyph-select-pop',
            slot: glyphSelectDef.slot('content'),
            content: (el) => {
                el.style.font = `var(--vela-font-size-md) ${this.theme.fontFamily}`;
                for (const o of this.ctrl.options) {
                    const item = h('button', { className: 'vela-glyph-select-item', slot: glyphSelectDef.slot('item'), attrs: { type: 'button' }, data: { active: o.value === current ? '1' : '0' } });
                    item.innerHTML = `<span style="display:flex;flex:none;">${o.glyph}</span>` + `<span style="flex:1;font-variant-numeric:tabular-nums;">${o.label}</span>`;
                    item.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        pop.hide();
                        this.ctrl.pick(o.value);
                        this.paint();
                    });
                    el.appendChild(item);
                }
            },
        });
        pop.show();
    }
}

export function createGlyphSelect<T extends string | number = string | number>(props: GlyphSelectProps<T>): GlyphSelect<T> {
    return new GlyphSelect(props);
}

/** Settings-dialog line-width field (1–5 px glyphs). */
export function widthField(theme: ChartTheme, getVal: () => number, onVal: (v: number) => void): HTMLElement {
    return new GlyphSelect<number>({
        theme,
        options: widthFieldOptions(),
        value: getVal(),
        get: getVal,
        onChange: onVal,
    }).el;
}

export function closeWidthPopover(): void {
    closeOpenPopovers();
}
