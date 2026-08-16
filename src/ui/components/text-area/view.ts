// Text-area VIEW — multi-line field, blur commit, optional auto-grow.
import { injectStyles } from '../../styles';
import { textAreaController, type TextAreaControllerOptions } from './controller';
import { TEXTAREA_CSS, TEXTAREA_STYLE_ID } from './styles';

export interface TextAreaOptions extends TextAreaControllerOptions {
    id?: string;
    placeholder?: string;
    /** Grow with content up to `maxLines`, then scroll. */
    autoGrow?: boolean;
    maxLines?: number;
}

export class TextArea {
    readonly el: HTMLElement;
    readonly input: HTMLTextAreaElement;
    private readonly ctrl: ReturnType<typeof textAreaController>;
    private readonly autoGrow: boolean;
    private readonly maxLines: number;

    constructor(opts: TextAreaOptions = {}) {
        const doc = document;
        injectStyles(TEXTAREA_STYLE_ID, TEXTAREA_CSS, doc);
        this.ctrl = textAreaController(opts);
        this.autoGrow = opts.autoGrow === true;
        this.maxLines = opts.maxLines ?? 4;

        const wrap = doc.createElement('div');
        wrap.className = 'vela-textarea';
        wrap.dataset.size = this.ctrl.size;
        if (this.autoGrow) wrap.dataset.autogrow = '';

        const ta = doc.createElement('textarea');
        ta.className = 'vela-textarea-field';
        if (opts.id) ta.id = opts.id;
        if (opts.placeholder) ta.placeholder = opts.placeholder;
        ta.rows = this.ctrl.rows;
        ta.value = this.ctrl.value;
        if (this.ctrl.disabled) ta.disabled = true;
        ta.addEventListener('blur', () => { this.ctrl.commit(ta.value); });
        if (this.autoGrow) {
            ta.addEventListener('input', () => this.grow());
        }
        wrap.appendChild(ta);
        this.el = wrap;
        this.input = ta;
        if (this.autoGrow) this.grow();
    }

    get value(): string {
        return this.ctrl.value;
    }

    setValue(v: string): void {
        this.ctrl.sync(v);
        this.input.value = v;
        if (this.autoGrow) this.grow();
    }

    private grow(): void {
        const ta = this.input;
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
        const pad = ta.clientHeight - (ta.offsetHeight ? lh * (ta.rows || 1) : 0);
        const max = lh * this.maxLines + (Number.isFinite(pad) && pad > 0 ? pad : 12);
        ta.style.height = 'auto';
        ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
        ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
    }
}
