// Bottom-center status toast — the reference's small pill over the chart (loading /
// info / error states, auto-hide). One instance per widget.
import { injectChromeStyles } from '../ui/chromeStyles';
import { css } from '@luxalgo/vela-ui/css';
import { t } from '@luxalgo/vela-ui/t';

const STYLE_ID = 'vela-widget-toast';
const CSS = css`@layer vela.chrome {

.vela-toast {
    position: absolute;
    inset-inline-start: 50%;
    bottom: 34px;
    transform: translateX(-50%);
    z-index: 30;
    display: none;
    align-items: center;
    gap: 8px;
    max-width: 70%;
    padding: 6px 14px;
    border-radius: 999px;
    background: ${t.surface.elev};
    border: 1px solid ${t.border};
    color: ${t.fg};
    font-size: ${t.fontSize.md};
    box-shadow: ${t.shadow};
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.vela-toast[data-open] { display: inline-flex; }
.vela-toast[data-type='error'] { color: ${t.down}; border-color: ${t.down}; }
.vela-toast[data-type='success'] { color: ${t.up}; }

}`;

export class Toast {
    private readonly el: HTMLElement;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(host: HTMLElement) {
        injectChromeStyles(STYLE_ID, CSS, host.ownerDocument);
        this.el = host.ownerDocument.createElement('div');
        this.el.className = 'vela-toast';
        host.appendChild(this.el);
    }

    /** Show a message; auto-hides after `ms` (0 = sticky until `hide()`). */
    show(message: string, type: 'info' | 'success' | 'error' = 'info', ms = 3000): void {
        this.el.textContent = message;
        this.el.dataset.type = type;
        this.el.dataset.open = '1';
        if (this.timer) clearTimeout(this.timer);
        this.timer = ms > 0 ? setTimeout(() => this.hide(), ms) : null;
    }

    hide(): void {
        delete this.el.dataset.open;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    destroy(): void {
        this.hide();
        this.el.remove();
    }
}
