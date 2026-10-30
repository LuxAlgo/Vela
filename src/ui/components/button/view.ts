// Button VIEW — a <button> with optional icons before and after a text label.
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { applyProps } from '../../headless';
import { buttonController, type ButtonController, type ButtonControllerOptions } from './controller';
import { BUTTON_CSS, BUTTON_STYLE_ID } from './styles';

export interface ButtonOptions extends ButtonControllerOptions {
    /** The visible text (the `icon*` sizes show none; `label` names them). */
    text?: string;
    /** Icon id from the kit's registry, before the text (the icon of an `icon*` size). */
    icon?: string;
    /** Icon id after the text (a menu trigger's chevron). */
    iconEnd?: string;
    onClick?: (e: MouseEvent) => void;
    /** Extra class names on the button (layout hooks). */
    className?: string;
}

export class Button {
    readonly el: HTMLButtonElement;
    private readonly ctrl: ButtonController;
    private readonly textNode: Text | null;

    constructor(opts: ButtonOptions = {}) {
        injectStyles(BUTTON_STYLE_ID, BUTTON_CSS, document);
        this.ctrl = buttonController({ ...opts, label: opts.label ?? opts.text });
        const b = document.createElement('button');
        const doc = b.ownerDocument;
        b.className = opts.className ? `vela-btn ${opts.className}` : 'vela-btn';
        const icon = (id: string, side: 'inline-start' | 'inline-end'): HTMLElement => {
            const el = iconEl(id, doc);
            el.dataset.icon = side;
            return el;
        };
        if (opts.icon) b.appendChild(icon(opts.icon, 'inline-start'));
        this.textNode = !this.ctrl.iconOnly && opts.text !== undefined ? doc.createTextNode(opts.text) : null;
        if (this.textNode) b.appendChild(this.textNode);
        if (opts.iconEnd && !this.ctrl.iconOnly) b.appendChild(icon(opts.iconEnd, 'inline-end'));
        if (opts.onClick) b.addEventListener('click', opts.onClick);
        this.el = b;
        this.paint();
    }

    get pressed(): boolean | undefined {
        return this.ctrl.pressed;
    }

    setPressed(pressed: boolean): void {
        this.ctrl.setPressed(pressed);
        this.paint();
    }

    setDisabled(disabled: boolean): void {
        this.ctrl.setDisabled(disabled);
        this.paint();
    }

    /** New text (or, for an `icon*` size, a new accessible name). */
    setText(text: string): void {
        this.ctrl.setLabel(text);
        if (this.textNode) this.textNode.data = text;
        this.paint();
    }

    private paint(): void {
        applyProps(this.el, this.ctrl.rootProps());
    }
}
