// Bottom bar — date-range presets (left), live clock + timezone picker (right).
// Range presets switch the timeframe AND frame the matching visible window; the widget
// owns the rebuild, so the bar only reports the chosen preset upward.
import type { VisibleRangePreset } from '../core/visible-range';
import type { MarketSession, MarketSessionDefinition } from '../core/options';
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
.vela-bb-session {
    all: unset;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    margin-left: 6px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 4px;
    color: var(--vela-fg-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-session[hidden] { display: none !important; }
.vela-bb-session:not(:disabled):hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-bb-session .vela-icon { width: 12px; height: 12px; }
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
    /** A declared/metadata-derived session selected from the active cell's menu. */
    onSession?: (session: MarketSession) => void;
    onSettingsClick?: () => void;
}

export class Bottombar {
    readonly el: HTMLElement;
    private readonly clockEl: HTMLElement;
    private readonly tzLabelEl: HTMLElement;
    private readonly tzButton: HTMLElement;
    private readonly tzMenu: Menu;
    private readonly sessionButton: HTMLButtonElement;
    private readonly sessionLabelEl: HTMLElement;
    private readonly sessionMenu: Menu;
    private readonly settingsTip: Tooltip | null = null;
    private readonly rangeButtons = new Map<string, HTMLButtonElement>();
    private sessionChoices: ReadonlyArray<Pick<MarketSessionDefinition, 'id' | 'label'>> = [];
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
        this.sessionButton = doc.createElement('button');
        this.sessionButton.className = 'vela-bb-session';
        this.sessionButton.hidden = true;
        this.sessionButton.disabled = true;
        this.sessionButton.setAttribute('aria-label', 'Trading session');
        this.sessionLabelEl = doc.createElement('span');
        this.sessionLabelEl.className = 'vela-bb-session-label';
        this.sessionButton.append(this.sessionLabelEl, iconEl('chevron-down', doc));
        const settingsBtn = doc.createElement('button');
        settingsBtn.className = 'vela-bb-settings';
        settingsBtn.appendChild(iconEl('gear', doc));
        settingsBtn.setAttribute('aria-label', 'Chart settings');
        if (opts.onSettingsClick) settingsBtn.addEventListener('click', opts.onSettingsClick);
        this.settingsTip = new Tooltip(settingsBtn, { content: 'Chart settings', triggerId: 'vela-bb-settings', host });
        this.el.append(spacer, this.tzButton, this.sessionButton, settingsBtn);
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
        this.sessionMenu = new Menu({
            trigger: this.sessionButton,
            triggerId: 'vela-bb-session',
            host,
            placement: 'top-end',
            items: [],
            onSelect: (id) => {
                const choice = this.sessionChoices.find((candidate) => candidate.id === id);
                if (!choice) return;
                this.setSession({ session: choice.id, choices: this.sessionChoices });
                opts.onSession?.(choice.id);
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

    /** Reflect the active cell's ordered session catalog. Fewer than two choices keep
     * the picker hidden; a single choice may still drive provider data and shading. */
    setSession(state: {
        session: MarketSession;
        choices: ReadonlyArray<Pick<MarketSessionDefinition, 'id' | 'label'>>;
    }): void {
        this.sessionChoices = [...state.choices];
        const active = this.sessionChoices.find((choice) => choice.id === state.session) ?? this.sessionChoices[0];
        this.sessionLabelEl.textContent = active?.label ?? '';
        const visible = this.sessionChoices.length >= 2;
        this.sessionButton.hidden = !visible;
        this.sessionButton.disabled = !visible;
        this.sessionMenu.setItems(this.sessionChoices.map((choice) => ({
            id: choice.id,
            label: choice.label,
            checked: choice.id === active?.id,
        })));
    }

    destroy(): void {
        if (this.timer !== null) clearInterval(this.timer);
        this.tzMenu.destroy();
        this.sessionMenu.destroy();
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
