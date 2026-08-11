// Timezone drawer (mobile) — opened by a long-press on the time axis. Lists every
// IANA zone the desktop bottom-bar picker offers; picking one applies and closes.
import { Drawer } from '../ui/components/drawer';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { TIMEZONES, tzMenuLabel, normalizeTimezone } from './timezones';

const STYLE_ID = 'vela-widget-timezone-drawer';
const CSS = `
.vela-tzd-list { padding: 2px 0 4px; }
.vela-tzd-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 46px;
    padding: 0 2px;
    border-radius: 8px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.vela-tzd-row:active { background: var(--vela-hover); }
.vela-tzd-row-label { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--vela-fg-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-tzd-row .vela-icon { flex: none; color: var(--vela-fg-bright); }
`;

export interface TimezoneDrawerOptions {
    host: HTMLElement;
    timezone: () => string;
    onTimezone: (zone: string) => void;
    onOpenChange?: (open: boolean) => void;
}

export class TimezoneDrawer {
    private readonly drawer: Drawer;

    constructor(private readonly opts: TimezoneDrawerOptions) {
        injectStyles(STYLE_ID, CSS, opts.host.ownerDocument);
        this.drawer = new Drawer({ host: opts.host, title: 'Time zone', onOpenChange: opts.onOpenChange });
    }

    open(): void {
        this.render();
        this.drawer.show();
    }

    close(): void {
        this.drawer.hide();
    }

    destroy(): void {
        this.drawer.destroy();
    }

    private render(): void {
        const doc = this.drawer.body.ownerDocument;
        this.drawer.body.replaceChildren();
        const list = doc.createElement('div');
        list.className = 'vela-tzd-list';
        const current = normalizeTimezone(this.opts.timezone());
        for (const tz of TIMEZONES) {
            const row = doc.createElement('div');
            row.className = 'vela-tzd-row';
            const label = doc.createElement('span');
            label.className = 'vela-tzd-row-label';
            label.textContent = tzMenuLabel(tz.value, tz.label);
            row.appendChild(label);
            if (tz.value === current) row.appendChild(iconEl('check', doc));
            row.addEventListener('click', () => {
                this.opts.onTimezone(tz.value);
                this.drawer.hide();
            });
            list.appendChild(row);
        }
        this.drawer.body.appendChild(list);
    }
}
