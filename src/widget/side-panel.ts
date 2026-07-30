// The docked side-panel shell: a fixed-width column on the chart's right edge with a titled
// header, a close button, and a scrolling body. Closed by default — a topbar button toggles it,
// and because the shell is a flex SIBLING of the chart (not an overlay) opening it shrinks the
// chart. The object tree and the data window are the two panels built on it.
import { injectStyles } from '../ui/styles';

const STYLE_ID = 'vela-widget-sidepanel';
const CSS = `
.vela-panel[hidden] { display: none !important; }
.vela-panel {
    width: 280px;
    flex: none;
    border-left: 1px solid var(--vela-border);
    display: flex;
    flex-direction: column;
    color: var(--vela-fg);
    font-size: 13px;
    box-sizing: border-box;
    background: var(--vela-bg);
}
.vela-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 10px 14px;
    border-bottom: 1px solid var(--vela-border);
    font-size: 14px;
    font-weight: 600;
    color: var(--vela-fg-bright);
}
.vela-panel-close {
    all: unset;
    cursor: pointer;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 13px;
}
.vela-panel-close:hover { background: var(--vela-hover); color: var(--vela-fg); }
.vela-panel-body { flex: 1; overflow: auto; padding: 8px; }
.vela-panel-body::-webkit-scrollbar { width: 8px; }
.vela-panel-body::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: 4px; border: 2px solid transparent; background-clip: padding-box; }
`;

export class SidePanel {
    readonly el: HTMLElement;
    /**
     * Notified whenever the panel opens or closes, by ANY path — a topbar toggle, the header ✕,
     * or another panel taking the dock. The owning shell reflects it on its chrome, so a button's
     * pressed state can never drift from the panel it controls.
     */
    onOpenChange: ((open: boolean) => void) | null = null;
    protected readonly body: HTMLElement;

    /** `modifier` is the panel's own class, carrying its content styles (e.g. `vela-ot`). */
    constructor(host: HTMLElement, title: string, modifier: string) {
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);
        this.el = doc.createElement('div');
        this.el.className = `vela-panel ${modifier}`;
        this.el.hidden = true;
        const header = doc.createElement('div');
        header.className = 'vela-panel-header';
        const heading = doc.createElement('span');
        heading.textContent = title;
        const close = doc.createElement('button');
        close.className = 'vela-panel-close';
        close.textContent = '✕';
        close.title = 'Close';
        close.addEventListener('click', () => this.toggle(false));
        header.append(heading, close);
        this.body = doc.createElement('div');
        this.body.className = 'vela-panel-body';
        this.el.append(header, this.body);
        host.appendChild(this.el);
    }

    get open(): boolean {
        return !this.el.hidden;
    }

    /** Open/close the panel — a bare call flips it. */
    toggle(open = this.el.hidden): void {
        if (open === !this.el.hidden) return;
        this.el.hidden = !open;
        this.onOpenChange?.(open);
    }

    destroy(): void {
        this.el.remove();
    }
}
