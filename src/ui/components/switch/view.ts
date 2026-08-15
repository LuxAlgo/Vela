// Switch VIEW — square check-toggle (filled + check when on).
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { switchController, type SwitchControllerOptions } from './controller';
import { SWITCH_CSS, SWITCH_STYLE_ID } from './styles';

export interface SwitchOptions extends SwitchControllerOptions {
    id?: string;
}

export class Switch {
    readonly el: HTMLButtonElement;
    private readonly ctrl: ReturnType<typeof switchController>;

    constructor(opts: SwitchOptions = {}) {
        injectStyles(SWITCH_STYLE_ID, SWITCH_CSS, document);
        this.ctrl = switchController(opts);
        const b = document.createElement('button');
        b.type = 'button';
        if (opts.id) b.id = opts.id;
        b.className = 'vela-switch';
        b.dataset.size = this.ctrl.size;
        b.dataset.tone = this.ctrl.tone;
        b.setAttribute('role', 'switch');
        if (this.ctrl.disabled) b.disabled = true;
        b.appendChild(iconEl('check', b.ownerDocument));
        this.el = b;
        this.paint();
        // Suppress the default mousedown focus: when this press outside-dismisses an open
        // popover, Chrome's focus action can scroll the dialog body under the pointer.
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            b.focus({ preventScroll: true });
        });
        b.addEventListener('click', () => {
            this.ctrl.toggle();
            this.paint();
        });
    }

    get checked(): boolean {
        return this.ctrl.checked;
    }

    setChecked(v: boolean): void {
        this.ctrl.setChecked(v);
        this.paint();
    }

    private paint(): void {
        const on = this.ctrl.checked;
        this.el.setAttribute('aria-checked', on ? 'true' : 'false');
        if (on) this.el.dataset.checked = '';
        else delete this.el.dataset.checked;
    }
}
