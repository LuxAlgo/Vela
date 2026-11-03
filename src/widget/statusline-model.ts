// Status line MODEL — the segment visibility the parts config implies, plus the item
// descriptors for the status line's right-click menu. Pure functions over plain state,
// so both can be tested without a DOM; `Statusline` projects them onto its elements.
import type { MenuItemDescriptor } from '@luxalgo/vela-ui/menu';
import { msg } from '../core/i18n/message';
import { textOf } from '../core/i18n/text';
import type { MessageDescriptor, Translator } from '../core/i18n/types';

/** The readout cells' one-letter labels. */
const CELL_LABELS = {
    open: msg('widget.statusline.openShort', 'O'),
    high: msg('widget.statusline.highShort', 'H'),
    low: msg('widget.statusline.lowShort', 'L'),
    close: msg('widget.statusline.closeShort', 'C'),
};

/** Each part's name — the status line's right-click menu and the settings rows that toggle it. */
export const STATUSLINE_PART_LABELS: Readonly<Record<'logo' | 'name' | 'market' | 'ohlc' | 'change', MessageDescriptor>> = {
    logo: msg('widget.statusline.part.logo', 'Symbol logo'),
    name: msg('widget.statusline.part.name', 'Symbol name'),
    market: msg('widget.statusline.part.market', 'Market status'),
    ohlc: msg('widget.statusline.part.ohlc', 'OHLC values'),
    change: msg('widget.statusline.part.change', 'Bar change values'),
};

const TEXT = {
    hideChart: msg('widget.statusline.hideChart', 'Hide chart'),
    showChart: msg('widget.statusline.showChart', 'Show chart'),
};

/** The status line's toggleable segments — the settings dialog's Status line tab and
 *  the status line's own right-click menu drive these. */
export type StatuslinePart = 'logo' | 'name' | 'market' | 'ohlc' | 'change';

/** Per-segment visibility the parts config implies. The venue/timeframe meta carries no
 *  part of its own: it reads as an extension of the symbol name ("BTCUSDT · BINANCE ·
 *  1h" is one identity readout), so it follows 'name'. A hidden chart (the price series
 *  eye) drops the whole value readout — OHLC and bar change, values of a series that
 *  isn't painted — without touching the parts themselves, so showing the chart brings
 *  them straight back; the eye affordance that re-shows the chart is out only then. */
export function segmentVisibility(parts: Record<StatuslinePart, boolean>, chartHidden = false): { avatar: boolean; symbol: boolean; meta: boolean; market: boolean; ohlc: boolean; change: boolean; eye: boolean } {
    return { avatar: parts.logo, symbol: parts.name, meta: parts.name, market: parts.market, ohlc: parts.ohlc && !chartHidden, change: parts.change && !chartHidden, eye: chartHidden };
}

/** How much of the value readout a width step keeps: every value the price style reads
 *  out ('full'), just the close and the bar change ('compact'), or the close and the
 *  percent delta alone ('minimal'). */
export type StatuslineLevel = 'full' | 'compact' | 'minimal';

/** One rung of the width ladder: whether the value readout sits on its own row under
 *  the symbol line, and how much of it is kept. */
export interface StatuslineLayout {
    stacked: boolean;
    level: StatuslineLevel;
}

/** The width ladder the status line walks down until its row fits, widest first: the
 *  values first move under the symbol line, then shed O/H/L, then the absolute change.
 *  Every status line — single chart, phone, multi-chart cell — walks the same rungs; in
 *  fit mode whatever still overflows after the last one is hidden segment by segment
 *  (see `Statusline.fit`). */
export const STATUSLINE_LADDER: readonly StatuslineLayout[] = [
    { stacked: false, level: 'full' },
    { stacked: true, level: 'full' },
    { stacked: true, level: 'compact' },
    { stacked: true, level: 'minimal' },
];

/** Which of the O/H/L/C cells a level keeps, given the price style's readout shape.
 *  One-line styles ('value') only ever plot the close, so their readout is the single
 *  unlabeled value at every level; bar-shaped styles drop O/H/L below 'full' and keep
 *  the labeled close, whose 'C' the 'minimal' level drops too. */
export function readoutCells(level: StatuslineLevel, readout: 'ohlc' | 'value', i18n?: Translator | null): ReadonlyArray<{ key: 'open' | 'high' | 'low' | 'close'; label: string }> {
    if (readout === 'value') return [{ key: 'close', label: '' }];
    const label = (key: keyof typeof CELL_LABELS): string => textOf(i18n, CELL_LABELS[key]);
    if (level === 'full') {
        return [
            { key: 'open', label: label('open') },
            { key: 'high', label: label('high') },
            { key: 'low', label: label('low') },
            { key: 'close', label: label('close') },
        ];
    }
    return [{ key: 'close', label: level === 'compact' ? label('close') : '' }];
}

/** Right-click menu rows: one checkable toggle per part (same labels as the settings
 *  dialog's Status line tab), then the chart itself — the same hide/show of the price
 *  series the object tree's eye drives. */
export function statuslineMenuItems(parts: Record<StatuslinePart, boolean>, chartVisible: boolean, i18n?: Translator | null): MenuItemDescriptor[] {
    const t = (m: MessageDescriptor): string => textOf(i18n, m);
    return [
        { id: 'part:logo', label: t(STATUSLINE_PART_LABELS.logo), checked: parts.logo },
        { id: 'part:name', label: t(STATUSLINE_PART_LABELS.name), checked: parts.name },
        { id: 'part:market', label: t(STATUSLINE_PART_LABELS.market), checked: parts.market },
        { id: 'part:ohlc', label: t(STATUSLINE_PART_LABELS.ohlc), checked: parts.ohlc },
        { id: 'part:change', label: t(STATUSLINE_PART_LABELS.change), checked: parts.change },
        { id: 'chart', label: t(chartVisible ? TEXT.hideChart : TEXT.showChart), separatorBefore: true },
    ];
}

/** The show-chart eye's label (the same text as the menu row). */
export const SHOW_CHART_LABEL = TEXT.showChart;
