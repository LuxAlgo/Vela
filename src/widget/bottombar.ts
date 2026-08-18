// Bottom bar — date-range presets (left), live clock + timezone picker (right).
// Range presets switch the timeframe AND frame the matching visible window; the widget
// owns the rebuild, so the bar only reports the chosen preset upward.
import type { VisibleRangePreset } from '../core/visible-range';
import { Menu } from '../ui/components/menu';
import { Tooltip } from '../ui/components/tooltip';
import { iconEl } from '../ui/icons';
import { injectStyles } from '../ui/styles';
import { TIMEZONES, tzMenuLabel, tzButtonLabel, normalizeTimezone } from './timezones';

export interface RangePreset {
    /** Button label. */
    id: string;
    /** Timeframe to switch to for this range. */
    tf: string;
    /** The core visible-range preset framed once the chart is ready. */
    preset: VisibleRangePreset;
    /**
     * Bars the window needs AT `tf` — the fetch budget for the rebuild. Without it the
     * chart loads its default depth and the framed window is clipped to whatever
     * history happens to be loaded (a "1D" that only shows 16 hours). Includes a small
     * margin; `ALL` asks for as much history as the provider will serve.
     */
    bars: number;
}

/**
 * Range chips — each pairs a timeframe, a visible window, and the fetch depth that
 * window needs. Resolutions follow the reference: the shorter the range, the finer the
 * bars (1 day of 1-minute bars … 5 years of weekly bars).
 */
export const RANGE_PRESETS: readonly RangePreset[] = [
    { id: '1D', tf: '1', preset: '1D', bars: 1500 }, //   1 day  @ 1m  = 1440 bars
    { id: '7D', tf: '5', preset: '1W', bars: 2100 }, //   7 days @ 5m  = 2016
    { id: '1M', tf: '30', preset: '1M', bars: 1500 }, //  30 days @ 30m = 1440
    { id: '3M', tf: '60', preset: '3M', bars: 2200 }, //  90 days @ 1h  = 2160
    { id: '6M', tf: '240', preset: '6M', bars: 1150 }, // 180 days @ 4h  = 1080
    { id: 'YTD', tf: 'D', preset: 'YTD', bars: 400 }, //  ≤366 days @ 1D
    { id: '1Y', tf: 'D', preset: '1Y', bars: 400 }, //    365 days @ 1D
    { id: '5Y', tf: 'W', preset: '5Y', bars: 300 }, //    5 years  @ 1W = 261
    { id: 'ALL', tf: 'W', preset: 'ALL', bars: 5000 }, // everything the provider serves
];

const STYLE_ID = 'vela-widget-bottombar';
const CSS = `
.vela-widget-bottombar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 8px;
    border-top: 1px solid var(--vela-border);
    color: var(--vela-fg-muted);
    font-size: 12px;
    flex: none;
}
.vela-bb-range {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 9px;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-range:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-range[data-active='1'] { color: var(--vela-fg-bright); background: var(--vela-hover); }
.vela-bb-spacer { flex: 1 1 auto; }
.vela-bb-clock { font-variant-numeric: tabular-nums; color: var(--vela-fg-bright); font-weight: 600; }
.vela-bb-tz {
    all: unset;
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border-radius: 4px;
    font-weight: 600;
    color: var(--vela-fg-bright);
    cursor: pointer;
}
.vela-bb-tz:hover { background: var(--vela-hover); }
.vela-bb-session { display: inline-flex; border: 1px solid var(--vela-border-strong); border-radius: 4px; overflow: hidden; margin-left: 6px; }
.vela-bb-session-btn {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    color: var(--vela-fg-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-session-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.vela-bb-session-btn:not(:disabled):hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-session-btn.is-active { color: var(--vela-fg); background: var(--vela-surface-elev); }
.vela-bb-session-btn.is-active:disabled { opacity: 0.8; }
.vela-bb-settings {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    margin-left: 6px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--vela-fg-muted);
    font-size: 14px;
}
.vela-bb-settings:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
`;

export interface BottombarOptions {
    timezone: string;
    onRange: (preset: RangePreset) => void;
    onTimezone: (zone: string) => void;
    /** RTH/ETH toggled by the user. Fires only while the toggle is ENABLED (see {@link Bottombar.setSession}). */
    onSession?: (session: 'regular' | 'extended') => void;
    onSettingsClick?: () => void;
}

export class Bottombar {
    readonly el: HTMLElement;
    private readonly clockEl: HTMLElement;
    private readonly tzLabelEl: HTMLElement;
    private readonly tzButton: HTMLElement;
    private readonly tzMenu: Menu;
    private readonly settingsTip: Tooltip | null = null;
    private readonly rangeButtons = new Map<string, HTMLButtonElement>();
    private readonly sessionButtons = new Map<'regular' | 'extended', HTMLButtonElement>();
    private sessionEl: HTMLElement | null = null;
    private timezone: string;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(host: HTMLElement, opts: BottombarOptions) {
        this.timezone = opts.timezone;
        const doc = host.ownerDocument;
        injectStyles(STYLE_ID, CSS, doc);

        this.el = doc.createElement('div');
        this.el.className = 'vela-widget-bottombar';
        for (const preset of RANGE_PRESETS) {
            const b = doc.createElement('button');
            b.className = 'vela-bb-range';
            b.textContent = preset.id;
            b.addEventListener('click', () => {
                this.setActiveRange(preset.id);
                opts.onRange(preset);
            });
            this.rangeButtons.set(preset.id, b);
            this.el.appendChild(b);
        }
        const spacer = doc.createElement('span');
        spacer.className = 'vela-bb-spacer';
        // The clock lives INSIDE the timezone trigger: clicking the time opens the same
        // zone dropdown as clicking the zone label (one affordance, reference behavior).
        this.tzButton = doc.createElement('button');
        this.tzButton.className = 'vela-bb-tz';
        this.tzButton.setAttribute('aria-label', 'Time zone');
        this.clockEl = doc.createElement('span');
        this.clockEl.className = 'vela-bb-clock';
        this.tzLabelEl = doc.createElement('span');
        this.tzLabelEl.textContent = tzButtonLabel(this.timezone);
        this.tzButton.append(this.clockEl, this.tzLabelEl);
        const session = doc.createElement('span');
        session.className = 'vela-bb-session';
        this.sessionEl = session;
        // Boots HIDDEN (sessions only apply to markets that have them); the host reveals
        // it per active chart via `setSession` once symbol metadata declares sessions.
        session.style.display = 'none';
        session.title = 'Session — regular (RTH) vs extended (ETH) hours';
        for (const [key, label] of [['regular', 'RTH'], ['extended', 'ETH']] as const) {
            const b = doc.createElement('button');
            b.className = 'vela-bb-session-btn' + (key === 'regular' ? ' is-active' : '');
            b.textContent = label;
            b.disabled = true;
            b.addEventListener('click', () => {
                if (b.disabled) return;
                this.setSession({ session: key, enabled: true }); // optimistic — the reload confirms
                opts.onSession?.(key);
            });
            this.sessionButtons.set(key, b);
            session.appendChild(b);
        }
        const settingsBtn = doc.createElement('button');
        settingsBtn.className = 'vela-bb-settings';
        settingsBtn.appendChild(iconEl('gear', doc));
        settingsBtn.setAttribute('aria-label', 'Chart settings');
        if (opts.onSettingsClick) settingsBtn.addEventListener('click', opts.onSettingsClick);
        this.settingsTip = new Tooltip(settingsBtn, { content: 'Chart settings', triggerId: 'vela-bb-settings', host });
        this.el.append(spacer, this.tzButton, session, settingsBtn);
        host.appendChild(this.el);

        this.tzMenu = new Menu({
            trigger: this.tzButton,
            triggerId: 'vela-bb-tz',
            host,
            placement: 'top-end',
            items: this.tzItems(),
            onSelect: (zone) => {
                this.setTimezone(zone);
                opts.onTimezone(zone);
            },
        });

        this.tick();
        this.timer = setInterval(() => this.tick(), 1000);
    }

    setTimezone(zone: string): void {
        this.timezone = zone;
        this.tzLabelEl.textContent = tzButtonLabel(zone);
        this.tzMenu.setItems(this.tzItems());
        this.tick();
    }

    /** Highlight (or clear with null) the active range chip — cleared on manual tf changes. */
    setActiveRange(id: string | null): void {
        for (const [key, b] of this.rangeButtons) {
            if (id !== null && key === id) b.dataset.active = '1';
            else delete b.dataset.active;
        }
    }

    /**
     * Reflect the ACTIVE chart's session posture. `enabled: false` (a continuous
     * market, or metadata not landed yet) HIDES the toggle entirely — RTH/ETH is
     * meaningless there. Enabled, the chips appear and the active one tracks the
     * chart's current session.
     */
    setSession(state: { session: 'regular' | 'extended'; enabled: boolean }): void {
        if (this.sessionEl) this.sessionEl.style.display = state.enabled ? '' : 'none';
        for (const [key, b] of this.sessionButtons) {
            b.disabled = !state.enabled;
            b.classList.toggle('is-active', key === (state.enabled ? state.session : 'regular'));
        }
    }

    destroy(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.tzMenu.destroy();
        this.settingsTip?.destroy();
        this.el.remove();
    }

    private tzItems() {
        return TIMEZONES.map((t) => ({
            id: t.value,
            label: tzMenuLabel(t.value, t.label),
            checked: t.value === normalizeTimezone(this.timezone),
        }));
    }

    private tick(): void {
        try {
            this.clockEl.textContent = new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
                timeZone: this.timezone,
            }).format(new Date());
        } catch {
            this.clockEl.textContent = '';
        }
    }
}
