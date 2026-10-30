// Badge VIEW — a <span> label or count.
import { injectStyles } from '../../styles';
import { applyProps } from '../../headless';
import { badgeController, type BadgeController, type BadgeControllerOptions, type BadgeTone } from './controller';
import { BADGE_CSS, BADGE_STYLE_ID } from './styles';

export interface BadgeOptions extends BadgeControllerOptions {
    text: string;
    className?: string;
}

export class Badge {
    readonly el: HTMLSpanElement;
    private readonly ctrl: BadgeController;

    constructor(opts: BadgeOptions) {
        injectStyles(BADGE_STYLE_ID, BADGE_CSS, document);
        this.ctrl = badgeController(opts);
        this.el = document.createElement('span');
        this.el.className = opts.className ? `vela-badge ${opts.className}` : 'vela-badge';
        this.el.textContent = opts.text;
        applyProps(this.el, this.ctrl.rootProps());
    }

    setText(text: string): void {
        this.el.textContent = text;
    }

    setTone(tone: BadgeTone): void {
        this.ctrl.setTone(tone);
        applyProps(this.el, this.ctrl.rootProps());
    }
}
