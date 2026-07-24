// Bottom-center status toast — the reference's small pill over the chart (loading /
// info / error states, auto-hide). One instance per widget.
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-widget-toast';
const CSS = `
.vela-toast {
    position: absolute;
    left: 50%;
    bottom: 34px;
    transform: translateX(-50%);
    z-index: 30;
    display: none;
    align-items: center;
    gap: 8px;
    max-width: 70%;
    padding: 6px 14px;
    border-radius: 999px;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border);
    color: var(--vela-fg);
    font-size: 12px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.vela-toast[data-open] { display: inline-flex; }
.vela-toast[data-type='error'] { color: var(--vela-down); border-color: var(--vela-down); }
.vela-toast[data-type='success'] { color: var(--vela-up); }
`;

export class Toast {
    private readonly el: HTMLElement;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(host: HTMLElement) {
        injectStyles(STYLE_ID, CSS, host.ownerDocument);
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
