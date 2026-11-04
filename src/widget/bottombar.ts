// Bottom bar — date-range presets (left), live clock + timezone picker (right).
// Range presets switch the timeframe AND frame the matching visible window; the widget
// owns the rebuild, so the bar only reports the chosen preset upward.
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import { englishTranslator } from '../core/i18n/translator';
import type { MessageLike, Translator } from '../core/i18n/types';
import type { VisibleRangePreset } from '../core/visible-range';
import type { Unsubscribe } from '../core/util/types';
import { SecondClock, type WallClock } from '../core/util/wall-clock';
import { DropdownMenu } from '@luxalgo/vela-ui/dropdown-menu';
import { Tooltip } from '@luxalgo/vela-ui/tooltip';
import { iconEl } from '@luxalgo/vela-ui/icons';
import { injectChromeStyles } from '../ui/chromeStyles';
import { timezoneMenuRows, tzButtonLabel, resolveTimezone } from './timezones';
import { css } from '@luxalgo/vela-ui/css';
import { t } from '@luxalgo/vela-ui/t';

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
const CSS = css`@layer vela.chrome {

.vela-widget-bottombar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 38px;
    padding: 0 8px;
    border-top: 1px solid ${t.border};
    color: ${t.fg.muted};
    font-size: 12px;
    flex: none;
}
.vela-bb-range {
    all: unset;
    box-sizing: border-box;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 9px;
    border-radius: ${t.radius.sm};
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-range:hover { background: ${t.hover}; color: ${t.fg.bright}; }
.vela-bb-range[data-active='1'] { color: ${t.fg.bright}; background: ${t.hover}; }
.vela-bb-spacer { flex: 1 1 auto; }
.vela-bb-clock { font-variant-numeric: tabular-nums; color: ${t.fg.bright}; font-weight: 600; }
.vela-bb-tz {
    all: unset;
    box-sizing: border-box;
    height: 26px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    border-radius: ${t.radius.sm};
    font-weight: 600;
    color: ${t.fg.bright};
    cursor: pointer;
}
.vela-bb-tz:hover { background: ${t.hover}; }
.vela-bb-session { display: inline-flex; border: 1px solid ${t.border.strong}; border-radius: ${t.radius.sm}; overflow: hidden; margin-inline-start: 6px; }
.vela-bb-session-btn {
    all: unset;
    box-sizing: border-box;
    height: 24px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    color: ${t.fg.muted};
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
}
.vela-bb-session-btn:disabled { cursor: not-allowed; opacity: 0.55; }
.vela-bb-session-btn:not(:disabled):hover { background: ${t.hover}; color: ${t.fg.bright}; }
.vela-bb-session-btn.is-active { color: ${t.fg}; background: ${t.surface.elev}; }
.vela-bb-session-btn.is-active:disabled { opacity: 0.8; }
.vela-bb-settings {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    margin-inline-start: 6px;
    border-radius: ${t.radius.sm};
    cursor: pointer;
    color: ${t.fg.muted};
    font-size: 14px;
}
.vela-bb-settings:hover { background: ${t.hover}; color: ${t.fg.bright}; }

}`;

export interface BottombarOptions {
    /** The stored display-timezone choice — an IANA zone or the exchange rule. */
    timezone: string;
    /** The active chart's market zone, resolving the exchange rule (see {@link Bottombar.setTimezone}). */
    exchangeTimezone?: string;
    /** The second pulse the clock ticks on. Share one with the charts' countdown chips
     *  (`renderer.setWallClock`) so every time display reads the same second; omitted,
     *  the bar runs its own second-aligned clock. */
    clock?: WallClock;
    onRange: (preset: RangePreset) => void;
    onTimezone: (zone: string) => void;
    /** RTH/ETH toggled by the user. Fires only while the toggle is ENABLED (see {@link Bottombar.setSession}). */
    onSession?: (session: 'regular' | 'extended') => void;
    onSettingsClick?: () => void;
    /** The workspace's translator (labels, the clock, the zone menu). Absent: English. */
    i18n?: Translator;
}

const TEXT = {
    timeZone: msg('widget.bottombar.timeZone', 'Time zone'),
    session: msg('widget.bottombar.session', 'Session — regular (RTH) vs extended (ETH) hours'),
    regular: msg('widget.bottombar.regular', 'RTH'),
    extended: msg('widget.bottombar.extended', 'ETH'),
    chartSettings: msg('widget.bottombar.chartSettings', 'Chart settings'),
};

/** The range chips' labels; a chip's id stays its identity. */
const RANGE_LABELS: Readonly<Record<string, MessageLike>> = {
    '1D': msg('widget.bottombar.range.1d', '1D'),
    '7D': msg('widget.bottombar.range.7d', '7D'),
    '1M': msg('widget.bottombar.range.1m', '1M'),
    '3M': msg('widget.bottombar.range.3m', '3M'),
    '6M': msg('widget.bottombar.range.6m', '6M'),
    YTD: msg('widget.bottombar.range.ytd', 'YTD'),
    '1Y': msg('widget.bottombar.range.1y', '1Y'),
    '5Y': msg('widget.bottombar.range.5y', '5Y'),
    ALL: msg('widget.bottombar.range.all', 'ALL'),
};

/** A range chip's label in the shell's language; an unknown preset shows its id. */
export function rangeLabel(id: string, i18n?: Translator | null): string {
    return textOf(i18n, RANGE_LABELS[id] ?? id);
}

export class Bottombar {
    readonly el: HTMLElement;
    private readonly clockEl: HTMLElement;
    private readonly tzLabelEl: HTMLElement;
    private readonly tzButton: HTMLElement;
    private readonly tzMenu: DropdownMenu;
    private readonly settingsTip: Tooltip | null = null;
    private readonly rangeButtons = new Map<string, HTMLButtonElement>();
    private readonly sessionButtons = new Map<'regular' | 'extended', HTMLButtonElement>();
    private sessionEl: HTMLElement | null = null;
    private timezone: string;
    private exchangeTimezone: string | undefined;
    private readonly unsubClock: Unsubscribe;
    private readonly i18n: Translator | null;
    private readonly settingsBtn: HTMLButtonElement;

    constructor(host: HTMLElement, opts: BottombarOptions) {
        this.i18n = opts.i18n ?? null;
        this.timezone = opts.timezone;
        this.exchangeTimezone = opts.exchangeTimezone;
        const doc = host.ownerDocument;
        injectChromeStyles(STYLE_ID, CSS, doc);

        this.el = doc.createElement('div');
        this.el.className = 'vela-widget-bottombar';
        for (const preset of RANGE_PRESETS) {
            const b = doc.createElement('button');
            b.className = 'vela-bb-range';
            b.textContent = this.t(RANGE_LABELS[preset.id] ?? preset.id);
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
        this.tzButton.setAttribute('aria-label', this.t(TEXT.timeZone));
        this.clockEl = doc.createElement('span');
        this.clockEl.className = 'vela-bb-clock';
        this.tzLabelEl = doc.createElement('span');
        this.tzLabelEl.textContent = tzButtonLabel(this.displayZone);
        this.tzButton.append(this.clockEl, this.tzLabelEl);
        const session = doc.createElement('span');
        session.className = 'vela-bb-session';
        this.sessionEl = session;
        // Boots HIDDEN (sessions only apply to markets that have them); the host reveals
        // it per active chart via `setSession` once symbol metadata declares sessions.
        session.style.display = 'none';
        session.title = this.t(TEXT.session);
        for (const [key, label] of [['regular', TEXT.regular], ['extended', TEXT.extended]] as const) {
            const b = doc.createElement('button');
            b.className = 'vela-bb-session-btn' + (key === 'regular' ? ' is-active' : '');
            b.textContent = this.t(label);
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
        this.settingsBtn = settingsBtn;
        settingsBtn.className = 'vela-bb-settings';
        settingsBtn.appendChild(iconEl('gear', doc));
        settingsBtn.setAttribute('aria-label', this.t(TEXT.chartSettings));
        if (opts.onSettingsClick) settingsBtn.addEventListener('click', opts.onSettingsClick);
        this.settingsTip = new Tooltip(settingsBtn, { content: this.t(TEXT.chartSettings), triggerId: 'vela-bb-settings', host });
        this.el.append(spacer, this.tzButton, session, settingsBtn);
        host.appendChild(this.el);

        this.tzMenu = new DropdownMenu({
            trigger: this.tzButton,
            triggerId: 'vela-bb-tz',
            host,
            side: 'top', align: 'end',
            items: this.tzItems(),
            onSelect: (zone) => {
                this.setTimezone(zone, this.exchangeTimezone);
                opts.onTimezone(zone);
            },
        });

        this.tick();
        this.unsubClock = (opts.clock ?? new SecondClock()).onTick(() => this.tick());
    }

    /**
     * Reflect the stored choice AND the active chart's market zone. The clock and the
     * offset label read the RESOLVED zone, so a workspace on the exchange rule re-labels
     * when the active cell (or its symbol) changes market — the host re-projects on
     * both. Idempotent: unchanged inputs leave the menu alone.
     */
    setTimezone(zone: string, exchangeTimezone?: string): void {
        if (zone === this.timezone && exchangeTimezone === this.exchangeTimezone) return;
        const choiceChanged = zone !== this.timezone;
        this.timezone = zone;
        this.exchangeTimezone = exchangeTimezone;
        this.tzLabelEl.textContent = tzButtonLabel(this.displayZone);
        if (choiceChanged) this.tzMenu.setItems(this.tzItems()); // the rows only depend on the choice
        this.tick();
    }

    /** The zone the bar's clock and label render in. */
    private get displayZone(): string {
        return resolveTimezone(this.timezone, this.exchangeTimezone);
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
        this.unsubClock();
        this.tzMenu.destroy();
        this.settingsTip?.destroy();
        this.el.remove();
    }

    private tzItems() {
        return timezoneMenuRows(this.timezone, this.i18n).map((r) => ({ id: r.value, label: r.label, checked: r.checked }));
    }

    private t(m: MessageLike): string {
        return textOf(this.i18n, m);
    }

    /** Re-read every label, the zone menu and the clock in the current language. */
    relocalize(): void {
        for (const [id, b] of this.rangeButtons) b.textContent = this.t(RANGE_LABELS[id] ?? id);
        this.tzButton.setAttribute('aria-label', this.t(TEXT.timeZone));
        if (this.sessionEl) this.sessionEl.title = this.t(TEXT.session);
        this.sessionButtons.get('regular')!.textContent = this.t(TEXT.regular);
        this.sessionButtons.get('extended')!.textContent = this.t(TEXT.extended);
        this.settingsBtn.setAttribute('aria-label', this.t(TEXT.chartSettings));
        this.settingsTip?.setContent(this.t(TEXT.chartSettings));
        this.tzMenu.setItems(this.tzItems());
        this.tick();
    }

    private tick(): void {
        this.clockEl.textContent = (this.i18n ?? englishTranslator()).format.clock(Date.now(), { timeZone: this.displayZone, surface: 'clock' });
    }
}
