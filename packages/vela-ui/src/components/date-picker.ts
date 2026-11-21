// DatePicker: a month calendar with month and year panels behind its header. The header month
// and year switch to their panel; picking a year leads to its months and picking a month back
// to its days. Dates travel as local `YYYY-MM-DD` strings. Names, digits and the first day of
// the week follow the `i18n` translator's locale (English, weeks from Sunday, without one);
// the calendar is always Gregorian. The picker is content only: its host (a popover, a panel)
// owns the surface around it.
import { calendarSettings, monthNames, plainInteger, weekdayNames, yearBeforeMonth, yearLabel } from '../lib/calendar';
import { msg, textOf } from '../lib/i18n';
import type { Translator } from '../lib/i18n';
import { iconEl } from '../lib/icons';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';

export type DatePickerPanel = 'date' | 'month' | 'year';

export interface DatePickerControllerOptions {
    /** The selected date (`YYYY-MM-DD`); the calendar opens on its month. */
    value?: string;
    /** "Today" for the today ring and the initial month when nothing is selected. */
    today?: Date;
    /** The translator whose locale names the months and weekdays, picks the first day of
     *  the week and the digits: `chart.i18n` inside a chart, `createTranslator(...)`
     *  elsewhere. Default: English, weeks starting on Sunday. */
    i18n?: Translator;
}

/** One cell of the current panel. `blank` cells pad the first week of a month. */
export interface DatePickerCell {
    label: string;
    /** The day (`YYYY-MM-DD`) on the date panel; the month index or the year otherwise. */
    value: string | number;
    checked: boolean;
    today: boolean;
    /** A padding year outside the decade on the year panel. */
    outside?: boolean;
    blank?: boolean;
}

export interface DatePickerController {
    readonly panel: DatePickerPanel;
    readonly year: number;
    readonly month: number;
    readonly value: string | null;
    /** Whether the locale writes the year before the month (the header's switch order). */
    readonly yearFirst: boolean;
    /** The weekday column labels, starting on the locale's first day of the week. */
    weekdays(): string[];
    /** Header text: the month switch (hidden off the date panel) and the year switch. */
    header(): { month: string; monthVisible: boolean; year: string; yearDisabled: boolean };
    /** What the arrows step on the current panel. */
    navLabels(): { prev: string; next: string };
    cells(): DatePickerCell[];
    /** One month, one year or ten, depending on the panel. */
    step(dir: 1 | -1): void;
    showMonths(): void;
    showYears(): void;
    /** Activate a cell: a day returns its date (the pick); a month or year only navigates. */
    choose(cell: DatePickerCell): string | null;
    /** Rewrite the selection without emitting (and open on its month). */
    setValue(value: string | null): void;
}

const NAV = {
    prevMonth: msg('ui.datePicker.previousMonth', 'Previous month'),
    nextMonth: msg('ui.datePicker.nextMonth', 'Next month'),
    prevYear: msg('ui.datePicker.previousYear', 'Previous year'),
    nextYear: msg('ui.datePicker.nextYear', 'Next year'),
    prevDecade: msg('ui.datePicker.previousDecade', 'Previous decade'),
    nextDecade: msg('ui.datePicker.nextDecade', 'Next decade'),
};

/** `YYYY-MM-DD` for a local date. */
export function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Accept `YYYY-MM-DD` or `YYYY-M-D` and return a padded ISO date, or null if unusable. */
export function normalizeDateInput(raw: string): string | null {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return isoDate(dt);
}

function parseIsoDate(raw: string | null | undefined): Date | null {
    const iso = raw ? normalizeDateInput(raw) : null;
    if (!iso) return null;
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(y!, mo! - 1, d!);
}

/** The calendar's panels, navigation and selection, without DOM. */
export function datePickerController(opts: DatePickerControllerOptions = {}): DatePickerController {
    const today = opts.today ?? new Date();
    let selected = parseIsoDate(opts.value);
    let year = selected?.getFullYear() ?? today.getFullYear();
    let month = selected?.getMonth() ?? today.getMonth();
    let panel: DatePickerPanel = 'date';
    const i18n = opts.i18n ?? null;
    const settings = calendarSettings(i18n);
    // Without a translator the picker keeps its historical Sunday-first grid.
    const weekStart = opts.i18n?.weekStart ?? 0;
    const monthsLong = monthNames(settings, 'long');
    const monthsShort = monthNames(settings, 'short');
    const num = (n: number): string => plainInteger(settings, n);

    const decade = (): number => Math.floor(year / 10) * 10;

    return {
        get panel() {
            return panel;
        },
        get year() {
            return year;
        },
        get month() {
            return month;
        },
        get value() {
            return selected ? isoDate(selected) : null;
        },
        yearFirst: yearBeforeMonth(settings),
        weekdays() {
            const names = weekdayNames(settings);
            return Array.from({ length: 7 }, (_, i) => names[(weekStart + i) % 7]!);
        },
        header() {
            return {
                month: monthsLong[month] ?? '',
                monthVisible: panel === 'date',
                year: panel === 'year' ? `${num(decade())}-${num(decade() + 9)}` : yearLabel(settings, year),
                yearDisabled: panel === 'year', // in the decade panel the year reads as its title
            };
        },
        navLabels() {
            if (panel === 'date') return { prev: textOf(i18n, NAV.prevMonth), next: textOf(i18n, NAV.nextMonth) };
            if (panel === 'month') return { prev: textOf(i18n, NAV.prevYear), next: textOf(i18n, NAV.nextYear) };
            return { prev: textOf(i18n, NAV.prevDecade), next: textOf(i18n, NAV.nextDecade) };
        },
        cells() {
            const out: DatePickerCell[] = [];
            if (panel === 'date') {
                const startPad = (new Date(year, month, 1).getDay() - weekStart + 7) % 7;
                const days = new Date(year, month + 1, 0).getDate();
                const todayIso = isoDate(today);
                const selectedIso = selected ? isoDate(selected) : '';
                for (let i = 0; i < startPad; i++) out.push({ label: '', value: '', checked: false, today: false, blank: true });
                for (let day = 1; day <= days; day++) {
                    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    out.push({ label: num(day), value: iso, checked: iso === selectedIso, today: iso === todayIso });
                }
                return out;
            }
            if (panel === 'month') {
                for (let m = 0; m < 12; m++) {
                    out.push({
                        label: monthsShort[m] ?? '',
                        value: m,
                        checked: selected?.getFullYear() === year && selected.getMonth() === m,
                        today: today.getFullYear() === year && today.getMonth() === m,
                    });
                }
                return out;
            }
            // One padding year on each side, so the decade fills the same 3×4 grid as the months.
            const d = decade();
            for (let y = d - 1; y <= d + 10; y++) {
                out.push({ label: num(y), value: y, checked: selected?.getFullYear() === y, today: today.getFullYear() === y, outside: y < d || y > d + 9 });
            }
            return out;
        },
        step(dir) {
            if (panel === 'date') {
                month += dir;
                if (month < 0) {
                    month = 11;
                    year -= 1;
                }
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            } else {
                year += panel === 'month' ? dir : dir * 10;
            }
        },
        showMonths() {
            panel = 'month';
        },
        showYears() {
            panel = 'year';
        },
        choose(cell) {
            if (cell.blank) return null;
            if (panel === 'date') {
                selected = parseIsoDate(String(cell.value));
                return selected ? isoDate(selected) : null;
            }
            if (panel === 'month') {
                month = Number(cell.value);
                panel = 'date';
                return null;
            }
            year = Number(cell.value);
            panel = 'month';
            return null;
        },
        setValue(value) {
            selected = parseIsoDate(value);
            if (selected) {
                year = selected.getFullYear();
                month = selected.getMonth();
            }
            panel = 'date';
        },
    };
}

export const datePickerDef = defineComponent({
    name: 'date-picker',
    parts: ['root', 'head', 'title', 'switch', 'nav', 'week', 'grid', 'cells', 'blank', 'day', 'cell'],
    settings: { radius: t.radius.sm, 'today-ring': `inset 0 0 0 1px ${t.border.strong}` },
});

export interface DatePickerOptions extends DatePickerControllerOptions {
    /** A day was picked (`YYYY-MM-DD`). */
    onPick?: (value: string) => void;
}

export type DatePickerProps = DatePickerOptions;

const CHOOSE_MONTH = msg('ui.datePicker.chooseMonth', 'Choose month');
const CHOOSE_YEAR = msg('ui.datePicker.chooseYear', 'Choose year');

const injectStyles = defineStyles(
    'vela-date-picker-styles',
    css`
        @layer vela.ui {
            [data-slot='date-picker'] {
                color: ${t.fg};
                font: 14px ${t.font};
                user-select: none;
            }
            [data-slot='date-picker-head'] {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 8px;
            }
            [data-slot='date-picker-title'] {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
                min-width: 0;
            }
            [data-slot='date-picker-switch'] {
                border: none;
                background: transparent;
                color: ${t.fg.bright};
                font: inherit;
                font-weight: 600;
                font-size: 14px;
                padding: 2px 6px;
                border-radius: ${datePickerDef.vars.radius};
                cursor: pointer;

                &:disabled {
                    cursor: default;
                }
                &:not(:disabled):hover {
                    background: ${t.hover};
                }
            }
            [data-slot='date-picker-nav'] {
                width: 24px;
                height: 24px;
                border: none;
                background: transparent;
                color: ${t.fg.muted};
                border-radius: ${datePickerDef.vars.radius};
                padding: 0;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;

                &:hover {
                    background: ${t.hover};
                    color: ${t.fg.bright};
                }
            }
            [data-slot='date-picker-week'],
            [data-slot='date-picker-grid'] {
                grid-template-columns: repeat(7, 28px);
                gap: 2px;
            }
            [data-slot='date-picker-week']:where(:not([hidden])),
            [data-slot='date-picker-grid'] {
                display: grid;
            }
            [data-slot='date-picker-week'] {
                margin-bottom: 4px;
                color: ${t.fg.muted};
                font-size: 11px;
                text-align: center;

                & > span {
                    line-height: 20px;
                }
            }
            [data-slot='date-picker-blank'] {
                width: 28px;
                height: 28px;
            }
            [data-slot='date-picker-day'] {
                width: 28px;
                height: 28px;
                border: none;
                background: transparent;
                color: inherit;
                border-radius: ${datePickerDef.vars.radius};
                padding: 0;
                cursor: pointer;
                font: inherit;
                font-size: 14px;

                &:hover {
                    background: ${t.hover};
                }
                &[data-checked] {
                    background: ${t.hover.strong};
                    color: ${t.fg.bright};
                }
                &[data-today]:not([data-checked]) {
                    box-shadow: ${datePickerDef.vars['today-ring']};
                }
            }
            [data-slot='date-picker-cells'] {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 4px;
                width: calc(7 * 28px + 6 * 2px);
            }
            [data-slot='date-picker-cell'] {
                height: 36px;
                border: none;
                background: transparent;
                color: inherit;
                border-radius: ${datePickerDef.vars.radius};
                padding: 0 4px;
                cursor: pointer;
                font: inherit;
                font-size: 14px;

                &:hover {
                    background: ${t.hover};
                }
                &[data-checked] {
                    background: ${t.hover.strong};
                    color: ${t.fg.bright};
                }
                &[data-today]:not([data-checked]) {
                    box-shadow: ${datePickerDef.vars['today-ring']};
                }
                &[data-outside] {
                    opacity: 0.45;
                }
            }
        }
    `,
);

export class DatePicker {
    readonly el: HTMLDivElement;
    private readonly ctrl: DatePickerController;
    private readonly prev: HTMLButtonElement;
    private readonly next: HTMLButtonElement;
    private readonly monthBtn: HTMLButtonElement;
    private readonly yearBtn: HTMLButtonElement;
    private readonly week: HTMLDivElement;
    private readonly grid: HTMLDivElement;

    constructor(private readonly opts: DatePickerOptions = {}) {
        const doc = document;
        injectStyles(doc);
        this.ctrl = datePickerController(opts);
        const button = (className: string, part: string): HTMLButtonElement => h('button', { className, slot: part, attrs: { type: 'button' } });
        this.prev = button('vela-date-picker-nav', datePickerDef.slot('nav'));
        this.prev.append(iconEl('chevron-left', doc));
        this.next = button('vela-date-picker-nav', datePickerDef.slot('nav'));
        this.next.append(iconEl('chevron-right', doc));
        const i18n = opts.i18n ?? null;
        this.monthBtn = button('vela-date-picker-switch', datePickerDef.slot('switch'));
        this.monthBtn.setAttribute('aria-label', textOf(i18n, CHOOSE_MONTH));
        this.yearBtn = button('vela-date-picker-switch', datePickerDef.slot('switch'));
        this.yearBtn.setAttribute('aria-label', textOf(i18n, CHOOSE_YEAR));
        const title = h('div', { className: 'vela-date-picker-title', slot: datePickerDef.slot('title') }, this.ctrl.yearFirst ? [this.yearBtn, this.monthBtn] : [this.monthBtn, this.yearBtn]);
        const head = h('div', { className: 'vela-date-picker-head', slot: datePickerDef.slot('head') }, this.prev, title, this.next);
        this.week = h(
            'div',
            { className: 'vela-date-picker-week', slot: datePickerDef.slot('week') },
            this.ctrl.weekdays().map((d) => h('span', { text: d })),
        );
        this.grid = h('div');

        // Every control stops propagation: the picker usually sits in a popover whose
        // outside-dismiss must not read a panel switch as a click elsewhere.
        const on = (el: HTMLElement, run: () => void): void =>
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                run();
                this.paint();
            });
        on(this.prev, () => this.ctrl.step(-1));
        on(this.next, () => this.ctrl.step(1));
        on(this.monthBtn, () => this.ctrl.showMonths());
        on(this.yearBtn, () => this.ctrl.showYears());

        this.el = h('div', { className: 'vela-date-picker', slot: datePickerDef.slot('root') }, head, this.week, this.grid);
        this.paint();
    }

    get value(): string | null {
        return this.ctrl.value;
    }

    /** Rewrite the selection without emitting (the calendar opens on its month). */
    setValue(value: string | null): void {
        this.ctrl.setValue(value);
        this.paint();
    }

    destroy(): void {}

    private paint(): void {
        const doc = this.el.ownerDocument;
        const head = this.ctrl.header();
        this.monthBtn.hidden = !head.monthVisible;
        this.monthBtn.textContent = head.month;
        this.yearBtn.textContent = head.year;
        this.yearBtn.disabled = head.yearDisabled;
        const nav = this.ctrl.navLabels();
        this.prev.setAttribute('aria-label', nav.prev);
        this.next.setAttribute('aria-label', nav.next);
        const dates = this.ctrl.panel === 'date';
        this.week.hidden = !dates;
        this.grid.className = dates ? 'vela-date-picker-grid' : 'vela-date-picker-cells';
        this.grid.setAttribute('data-slot', datePickerDef.slot(dates ? 'grid' : 'cells'));
        this.grid.replaceChildren(...this.ctrl.cells().map((cell) => this.cellEl(doc, cell, dates)));
    }

    private cellEl(doc: Document, cell: DatePickerCell, dates: boolean): HTMLElement {
        if (cell.blank) return h('span', { className: 'vela-date-picker-blank', slot: datePickerDef.slot('blank') });
        const b = h('button', {
            className: dates ? 'vela-date-picker-day' : 'vela-date-picker-cell',
            slot: datePickerDef.slot(dates ? 'day' : 'cell'),
            attrs: { type: 'button' },
            data: { checked: cell.checked ? '1' : null, today: cell.today ? '1' : null, outside: cell.outside ? '1' : null },
            text: cell.label,
        });
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const picked = this.ctrl.choose(cell);
            if (picked) this.opts.onPick?.(picked);
            else this.paint();
        });
        return b;
    }
}

export function createDatePicker(props: DatePickerProps = {}): DatePicker {
    return new DatePicker(props);
}
