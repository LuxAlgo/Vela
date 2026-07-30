// Chart context-menu MODEL — the item descriptors for each right-click zone plus the
// renderer writes a selection implies. Pure functions over plain state, so the menus can
// be tested without a DOM; `ChartContextMenu` reads the renderer, calls these and shows
// the result.
import type { MenuItemDescriptor } from '../ui/components/menu';
import { TIMEZONES, tzMenuLabel } from './timezones';

/** Zone a right-click landed in — the chart body, the right price scale, the bottom time axis. */
export type Zone = 'body' | 'price-axis' | 'time-axis';

/** One pane's scale state, as reported by the renderer's `paneScales` feature. */
export interface PaneScaleInfo {
    id: string;
    kind: 'price' | 'study';
    /** The pane's pixel band inside the plot, so a click y maps to a pane. */
    top: number;
    height: number;
    mode: string;
    log: boolean;
    invert: boolean;
}

/** The settings-dialog tab each zone's settings item opens — the one holding the settings
 *  that zone is about, so the menu lands where the eye already is. */
export const SETTINGS_SECTION: Record<Zone, string> = {
    body: 'Canvas',
    'price-axis': 'Scales and lines',
    'time-axis': 'Scales and lines',
};

/** Menu id for the settings item of a zone, carrying the tab to open. */
function settingsItem(zone: Zone, label: string): MenuItemDescriptor {
    return { id: `settings:${SETTINGS_SECTION[zone]}`, label, separatorBefore: true };
}

/** The section a `settings:*` item asks for, or undefined for a bare `settings` id. */
export function settingsSectionOf(id: string): string | undefined {
    return id.slice('settings:'.length) || undefined;
}

/** The four mutually exclusive price-scale choices (log is part of the same group). */
export type ScaleChoice = 'regular' | 'percent' | 'indexed' | 'log';

const SCALE_CHOICES: ReadonlyArray<readonly [ScaleChoice, string]> = [
    ['regular', 'Regular'],
    ['percent', 'Percent'],
    ['indexed', 'Indexed to 100'],
    ['log', 'Logarithmic'],
];

/** Which pane's scale a right-click at plot-local `y` targets, or null without per-pane scales. */
export function paneScaleAt(panes: readonly PaneScaleInfo[], y: number): PaneScaleInfo | null {
    return panes.find((p) => y >= p.top && y < p.top + p.height) ?? panes[0] ?? null;
}

/** A pane's active choice. Log wins over the mode: the two live in one exclusive group. */
export function scaleChoiceOf(scale: { mode?: string; log?: boolean }): ScaleChoice {
    if (scale.log) return 'log';
    if (scale.mode === 'percent') return 'percent';
    if (scale.mode === 'indexed') return 'indexed';
    return 'regular';
}

/** The main (price-pane) scale is the chart-level setting keyboard shortcuts and the
 *  persisted config also drive; a study pane carries its own, so panes stay independent. */
function mainScale(pane: PaneScaleInfo | null): boolean {
    return pane === null || pane.kind === 'price';
}

/** Renderer writes that selecting a scale choice implies — picking one clears the others. */
export function scaleWrites(choice: ScaleChoice, pane: PaneScaleInfo | null): Array<[string, unknown]> {
    const mode = choice === 'percent' ? 'percent' : choice === 'indexed' ? 'indexed' : 'price';
    const log = choice === 'log';
    if (mainScale(pane)) {
        return [
            ['scaleMode', mode],
            ['logScale', log],
        ];
    }
    return [
        ['scaleMode', { pane: pane!.id, mode }],
        ['logScale', { pane: pane!.id, value: log }],
    ];
}

/** Renderer write inverting one pane's axis (high at the bottom). */
export function invertWrite(next: boolean, pane: PaneScaleInfo | null): [string, unknown] {
    return mainScale(pane) ? ['invertScale', next] : ['invertScale', { pane: pane!.id, value: next }];
}

export interface PriceAxisState {
    /** Autoscale on — the axis fits the visible data instead of a frozen window. */
    auto: boolean;
    invert: boolean;
    choice: ScaleChoice;
    axisLabels: boolean;
    priceLabel: boolean;
    countdown: boolean;
    priceLine: boolean;
}

export function priceAxisItems(s: PriceAxisState): MenuItemDescriptor[] {
    return [
        { id: 'auto', label: 'Auto (fits data to screen)', checked: s.auto },
        { id: 'invert', label: 'Invert scale', checked: s.invert },
        ...SCALE_CHOICES.map(([choice, label], i) => ({
            id: `scale:${choice}`,
            label,
            checked: s.choice === choice,
            separatorBefore: i === 0,
        })),
        {
            id: 'labels',
            label: 'Labels',
            separatorBefore: true,
            submenu: [
                { id: 'toggle:axisLabels', label: 'Price axis labels', checked: s.axisLabels },
                { id: 'toggle:priceLabel', label: 'Last price label', checked: s.priceLabel },
                { id: 'toggle:countdown', label: 'Countdown to bar close', checked: s.countdown },
            ],
        },
        {
            id: 'levels',
            label: 'Levels',
            submenu: [{ id: 'toggle:currentPriceLine', label: 'Last Price Line', checked: s.priceLine }],
        },
        settingsItem('price-axis', 'More settings…'),
    ];
}

export function timeAxisItems(timezone: string): MenuItemDescriptor[] {
    // A renderer defaulting to the bare `'UTC'` means the same zone as the list's `'Etc/UTC'`.
    const active = timezone === 'UTC' ? 'Etc/UTC' : timezone;
    return [
        {
            id: 'timezone',
            label: 'Time zone',
            submenu: TIMEZONES.map((t) => ({ id: `tz:${t.value}`, label: tzMenuLabel(t.value, t.label), checked: t.value === active })),
        },
        settingsItem('time-axis', 'More settings…'),
    ];
}

/** Chart-body items. The two removals stay VISIBLE with nothing to remove — disabled, so
 *  the menu keeps its shape. */
export function bodyItems(counts: { drawings: number; indicators: number }): MenuItemDescriptor[] {
    return [
        { id: 'reset-view', label: 'Reset chart view' },
        { id: 'remove-drawings', label: 'Remove drawings', disabled: counts.drawings === 0, separatorBefore: true },
        { id: 'remove-indicators', label: 'Remove indicators', disabled: counts.indicators === 0 },
        settingsItem('body', 'Settings…'),
    ];
}
