// Glyph-select VIEW — trigger showing the current glyph, portaled option list.
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { Popover, closeOpenPopovers, openPopoverTrigger } from '../popover';
import {
    glyphSelectController,
    widthFieldOptions,
    type GlyphOption,
    type GlyphSelectControllerOptions,
} from './controller';
import { GLYPH_SELECT_CSS, GLYPH_SELECT_STYLE_ID } from './styles';

export interface GlyphSelectOptions<T extends string | number = string | number> extends GlyphSelectControllerOptions<T> {
    theme: VelaTheme;
    title?: string;
    get?: () => T;
}

export class GlyphSelect<T extends string | number = string | number> {
    readonly el: HTMLButtonElement;
    private readonly ctrl: ReturnType<typeof glyphSelectController<T>>;
    private readonly theme: VelaTheme;
    private readonly get: () => T;

    constructor(opts: GlyphSelectOptions<T>) {
        injectStyles(GLYPH_SELECT_STYLE_ID, GLYPH_SELECT_CSS, document);
        this.ctrl = glyphSelectController(opts);
        this.theme = opts.theme;
        this.get = opts.get ?? (() => this.ctrl.value);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'vela-glyph-select';
        if (opts.title) trigger.title = opts.title;
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

    private paint(): void {
        const cur = this.get();
        const opt = this.ctrl.optionOf(cur);
        const glyph = document.createElement('span');
        glyph.style.display = 'flex';
        glyph.innerHTML = opt?.glyph ?? '';
        const caret = document.createElement('span');
        caret.className = 'vela-glyph-select-caret';
        caret.appendChild(iconEl('chevron-down', this.el.ownerDocument));
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
            align: 'end',
            gap: 6,
            className: 'vela-glyph-select-pop',
            content: (el) => {
                el.style.font = `var(--vela-font-size-md) ${this.theme.fontFamily}`;
                for (const o of this.ctrl.options) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'vela-glyph-select-item';
                    item.dataset.active = o.value === current ? '1' : '0';
                    item.innerHTML =
                        `<span style="display:flex;flex:none;">${o.glyph}</span>` +
                        `<span style="flex:1;font-variant-numeric:tabular-nums;">${o.label}</span>`;
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

/** Settings-dialog line-width field (1–5 px glyphs). */
export function widthField(theme: VelaTheme, getVal: () => number, onVal: (v: number) => void): HTMLElement {
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

export type { GlyphOption };
