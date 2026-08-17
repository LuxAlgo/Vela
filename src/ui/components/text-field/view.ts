// Text-field VIEW — blur/Enter commit.
import { injectStyles } from '../../styles';
import { textFieldController, type TextFieldControllerOptions } from './controller';
import { TEXT_CSS, TEXT_STYLE_ID } from './styles';

export interface TextFieldOptions extends TextFieldControllerOptions {
    id?: string;
}

export class TextField {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;
    private readonly ctrl: ReturnType<typeof textFieldController>;

    constructor(opts: TextFieldOptions = {}) {
        const doc = document;
        injectStyles(TEXT_STYLE_ID, TEXT_CSS, doc);
        this.ctrl = textFieldController(opts);
        const wrap = doc.createElement('div');
        wrap.className = 'vela-text';
        wrap.dataset.size = this.ctrl.size;
        if (this.ctrl.fill) wrap.dataset.fill = '';
        const ti = doc.createElement('input');
        ti.type = 'text';
        // Kill the UA ~20ch min-width so a 100px wrap (or fill parent) actually holds.
        ti.size = 1;
        if (opts.id) ti.id = opts.id;
        ti.value = this.ctrl.value;
        ti.className = 'vela-text-field';
        if (this.ctrl.disabled) ti.disabled = true;
        ti.addEventListener('blur', () => { this.ctrl.commit(ti.value); });
        ti.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); ti.blur(); }
        });
        wrap.appendChild(ti);
        this.el = wrap;
        this.input = ti;
    }

    get value(): string {
        return this.ctrl.value;
    }

    setValue(v: string): void {
        this.ctrl.sync(v);
        this.input.value = v;
    }
}
