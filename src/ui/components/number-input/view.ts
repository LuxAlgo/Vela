// Number-input VIEW — typed field with optional hover steppers (press-repeat).
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { numberInputController, type NumberInputControllerOptions } from './controller';
import { NUMBER_CSS, NUMBER_STYLE_ID } from './styles';

export interface NumberInputOptions extends NumberInputControllerOptions {
    id?: string;
    title?: string;
    /** Chart-settings placeholder mode: empty field means `emptyValue` (the default). */
    placeholder?: string;
    emptyValue?: number;
    compact?: boolean;
}

export class NumberInput {
    readonly el: HTMLElement;
    readonly input: HTMLInputElement;
    private readonly ctrl: ReturnType<typeof numberInputController>;
    private last: string;
    private readonly placeholderMode: boolean;
    private readonly emptyValue: number;

    constructor(opts: NumberInputOptions) {
        const doc = document;
        injectStyles(NUMBER_STYLE_ID, NUMBER_CSS, doc);
        this.ctrl = numberInputController(opts);
        this.placeholderMode = opts.placeholder !== undefined;
        this.emptyValue = opts.emptyValue ?? opts.value;
        this.last = String(opts.value);

        const wrap = doc.createElement('div');
        wrap.className = 'vela-num';
        wrap.dataset.size = this.ctrl.size;
        if (this.ctrl.size !== 'sm') wrap.dataset.fill = '';
        if (opts.compact) wrap.dataset.compact = '';
        if (this.ctrl.steppers) wrap.dataset.steppers = '';

        const ni = doc.createElement('input');
        ni.type = 'number';
        if (opts.id) ni.id = opts.id;
        if (opts.title) ni.title = opts.title;
        if (opts.min !== undefined) ni.min = String(opts.min);
        if (opts.max !== undefined) ni.max = String(opts.max);
        ni.step = String(this.ctrl.step);
        if (this.ctrl.disabled) ni.disabled = true;
        if (this.placeholderMode) {
            ni.placeholder = opts.placeholder ?? '';
            ni.value = opts.value !== this.emptyValue ? String(opts.value) : '';
        } else {
            ni.value = String(opts.value);
        }

        const commitRaw = (raw: number): void => {
            const n = this.ctrl.apply(raw);
            if (n === null) {
                ni.value = this.placeholderMode && this.ctrl.value === this.emptyValue ? '' : this.last;
                return;
            }
            this.last = String(n);
            if (this.placeholderMode && n === this.emptyValue) ni.value = '';
            else ni.value = String(n);
        };

        if (this.placeholderMode) {
            ni.addEventListener('change', () => {
                const raw = ni.value.trim() === '' ? this.emptyValue : Number(ni.value);
                commitRaw(Number.isFinite(raw) ? raw : this.emptyValue);
            });
        } else if (this.ctrl.commit === 'live') {
            ni.addEventListener('input', () => {
                const v = Number(ni.value);
                if (Number.isFinite(v)) this.ctrl.apply(v);
            });
        } else {
            ni.addEventListener('blur', () => commitRaw(Number(ni.value)));
            ni.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); ni.blur(); }
            });
        }

        wrap.appendChild(ni);
        if (this.ctrl.steppers) {
            wrap.appendChild(this.buildSteppers(doc, (dir) => {
                const cur = Number(ni.value);
                const base = Number.isFinite(cur) ? cur : this.ctrl.value;
                commitRaw(base + dir * this.ctrl.step);
            }));
        }

        this.el = wrap;
        this.input = ni;
    }

    get value(): number {
        return this.ctrl.value;
    }

    setValue(v: number): void {
        const n = this.ctrl.sync(v);
        this.last = String(n);
        if (this.placeholderMode && n === this.emptyValue) this.input.value = '';
        else this.input.value = String(n);
    }

    private buildSteppers(doc: Document, applyDir: (dir: 1 | -1) => void): HTMLElement {
        const steps = doc.createElement('div');
        steps.className = 'vela-num-step';
        const mk = (dir: 1 | -1, icon: string, label: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.tabIndex = -1;
            b.setAttribute('aria-label', label);
            b.appendChild(iconEl(icon, doc));
            let timer = 0;
            const apply = (): void => applyDir(dir);
            const stop = (): void => { if (timer) { window.clearTimeout(timer); timer = 0; } };
            b.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                apply();
                timer = window.setTimeout(function tick() {
                    apply();
                    timer = window.setTimeout(tick, 60);
                }, 400);
            });
            b.addEventListener('pointerup', stop);
            b.addEventListener('pointerleave', stop);
            b.addEventListener('pointercancel', stop);
            return b;
        };
        steps.append(mk(1, 'chevron-up', 'Increase'), mk(-1, 'chevron-down', 'Decrease'));
        return steps;
    }
}
