// MonthGrid: a month of day cells, each with a figure: a trading journal's P&L by day. A day's
// tone tints its cell and colors its figure (profit, loss or neutral), and a line under the
// figure says more (`3 trades · 67%`). Weeks start on the translator's first day, under the
// weekdays' names; the cells outside the month are blank. With `onSelect` every day of the
// month is a button, and the arrow keys walk the days (Home and End: the week's ends).
import { calendarSettings, longDate, plainInteger, weekdayNames, type CalendarSettings } from '../lib/calendar';
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import type { Translator } from '../lib/i18n';
import { kitTranslator } from '../lib/kit-text';
import { t } from '../lib/t';

export const monthGridDef = defineComponent({
    name: 'month-grid',
    parts: ['root', 'weekday', 'day', 'date', 'value', 'detail', 'blank'],
    settings: { radius: '8px', 'day-height': '56px', gap: '4px', 'selected-ring': `inset 0 0 0 1px ${t.selected.bg}` },
});

export type MonthGridTone = 'profit' | 'loss' | 'neutral';

export interface MonthGridDay {
    /** The day's figure (`+1,240.50`). */
    value?: string;
    /** A line under the figure (`3 trades · 67%`). */
    detail?: string;
    /** Tints the cell and colors the figure. */
    tone?: MonthGridTone;
    /** What a screen reader hears for the day (default: the date, the figure and the line). */
    label?: string;
}

export interface MonthGridProps {
    /** The month shown (`2026-11`). */
    month: string;
    /** The days with something to show, by date (`2026-11-06`). */
    days?: Readonly<Record<string, MonthGridDay>>;
    /** The selected day (`2026-11-06`), ringed. */
    selected?: string | null;
    /** Today (`2026-11-06`), its date in the accent color. */
    today?: string | null;
    /** A day was chosen: a click, Enter or Space. Without it the days are not buttons. */
    onSelect?: (date: string) => void;
    /** The translator whose locale names the weekdays, picks the first day of the week and
     *  the digits. Default: the kit build's, else English with weeks starting on Sunday. */
    i18n?: Translator;
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface MonthGridHandle {
    readonly el: HTMLElement;
    /** The month shown (`2026-11`). */
    readonly month: string;
    setMonth(month: string): void;
    setDays(days: Readonly<Record<string, MonthGridDay>>): void;
    setSelected(date: string | null): void;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-month-grid',
    css`
        @layer vela.ui {
            [data-slot='month-grid'] {
                min-width: 0;

                &:where(:not([hidden])) {
                    display: grid;
                    grid-template-columns: repeat(7, minmax(0, 1fr));
                    gap: ${monthGridDef.vars.gap};
                }
            }
            [data-slot='month-grid-weekday'] {
                padding: 4px 0;
                color: ${t.fg.muted};
                font-size: 10px;
                font-weight: 500;
                letter-spacing: 0.06em;
                text-align: center;
                text-transform: uppercase;
            }
            [data-slot='month-grid-blank'],
            [data-slot='month-grid-day'] {
                min-width: 0;
                min-height: ${monthGridDef.vars['day-height']};
                border-radius: ${monthGridDef.vars.radius};
            }
            [data-slot='month-grid-day'] {
                all: unset;
                box-sizing: border-box;
                min-width: 0;
                min-height: ${monthGridDef.vars['day-height']};
                padding: 5px;
                overflow: hidden;
                border: 1px solid ${t.border.faint};
                border-radius: ${monthGridDef.vars.radius};
                background: color-mix(in srgb, ${t.fg.bright} 2%, transparent);
                text-align: start;
                font-variant-numeric: tabular-nums;
                transition: border-color ${t.dur.fast} ease;

                &:where(:not([hidden])) {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                }
                &[data-tone='profit'] {
                    border-color: color-mix(in srgb, ${t.profit} 40%, transparent);
                    background: color-mix(in srgb, ${t.profit} 10%, transparent);
                }
                &[data-tone='loss'] {
                    border-color: color-mix(in srgb, ${t.loss} 40%, transparent);
                    background: color-mix(in srgb, ${t.loss} 10%, transparent);
                }
                &[data-tone='neutral'] {
                    border-color: ${t.border};
                    background: ${t.hover};
                }
                &[type='button'] {
                    cursor: pointer;
                }
                &[data-checked] {
                    border-color: ${t.selected.bg};
                    box-shadow: ${monthGridDef.vars['selected-ring']};
                }
                &:focus-visible {
                    outline: 2px solid ${t.focus};
                    outline-offset: 1px;
                }
                &[type='button']:not([data-checked]):hover {
                    border-color: ${t.border.strong};
                }
            }
            [data-slot='month-grid-date'] {
                color: ${t.fg.muted};
                font-size: 10px;
                line-height: 12px;

                &:is([data-today] > *) {
                    color: ${t.accent};
                    font-weight: 600;
                }
            }
            [data-slot='month-grid-value'],
            [data-slot='month-grid-detail'] {
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            [data-slot='month-grid-value'] {
                margin-top: auto;
                color: ${t.fg.bright};
                font-size: 11px;
                font-weight: 500;
                line-height: 14px;

                &:is([data-tone='profit'] > *) {
                    color: ${t.profit};
                }
                &:is([data-tone='loss'] > *) {
                    color: ${t.loss};
                }
            }
            [data-slot='month-grid-detail'] {
                color: ${t.fg.muted};
                font-size: 9px;
                line-height: 12px;
            }
        }
    `,
);

const MONTH = /^(\d{4})-(\d{2})$/;
const pad = (n: number): string => String(n).padStart(2, '0');

class MonthGridImpl implements MonthGridHandle {
    readonly el: HTMLElement;
    private readonly settings: CalendarSettings;
    private readonly weekStart: number;
    private shown: string;
    private days: Readonly<Record<string, MonthGridDay>>;
    private selected: string | null;
    private readonly today: string | null;
    /** The day that takes Tab into the grid, and keeps it while the arrow keys move. */
    private focusDate: string | null = null;
    private readonly onClick = (e: MouseEvent): void => {
        const day = this.dayOf(e.target);
        if (day) this.choose(day);
    };
    private readonly onKey = (e: KeyboardEvent): void => {
        const day = this.dayOf(e.target);
        if (!day) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.choose(day);
            return;
        }
        const rtl = getComputedStyle(this.el).direction === 'rtl';
        const n = Number(day.dataset.date!.slice(8));
        const column = (Array.prototype.indexOf.call(this.el.children, day) - 7) % 7;
        const moves: Record<string, number> = {
            ArrowLeft: rtl ? 1 : -1,
            ArrowRight: rtl ? -1 : 1,
            ArrowUp: -7,
            ArrowDown: 7,
            Home: -column,
            End: 6 - column,
        };
        const move = moves[e.key];
        if (move === undefined) return;
        e.preventDefault();
        // Home and End stop at the month's ends; the arrows stop at its edge.
        const last = this.el.querySelectorAll('[data-date]').length;
        const next = e.key === 'Home' || e.key === 'End' ? Math.min(last, Math.max(1, n + move)) : n + move;
        const target = this.el.querySelector<HTMLElement>(`[data-date="${this.shown}-${pad(next)}"]`);
        if (!target) return;
        this.roveTo(target.dataset.date!);
        target.focus();
    };

    constructor(private readonly props: MonthGridProps) {
        injectStyles(document);
        const i18n = props.i18n ?? kitTranslator();
        this.settings = calendarSettings(i18n);
        this.weekStart = i18n?.weekStart ?? 0;
        this.shown = MONTH.test(props.month) ? props.month : props.month.slice(0, 7);
        this.days = props.days ?? {};
        this.selected = props.selected ?? null;
        this.today = props.today ?? null;
        this.el = h('div', { className: props.className, slot: monthGridDef.slot('root') });
        if (props.onSelect) {
            this.el.addEventListener('click', this.onClick);
            this.el.addEventListener('keydown', this.onKey);
        }
        this.render();
    }

    get month(): string {
        return this.shown;
    }

    setMonth(month: string): void {
        this.shown = month;
        this.focusDate = null;
        this.render();
    }

    setDays(days: Readonly<Record<string, MonthGridDay>>): void {
        this.days = days;
        this.render();
    }

    setSelected(date: string | null): void {
        this.selected = date;
        this.render();
    }

    destroy(): void {
        this.el.removeEventListener('click', this.onClick);
        this.el.removeEventListener('keydown', this.onKey);
    }

    private dayOf(target: EventTarget | null): HTMLElement | null {
        const day = target instanceof Element ? target.closest<HTMLElement>(`[data-slot="${monthGridDef.slot('day')}"]`) : null;
        return day && this.el.contains(day) ? day : null;
    }

    private choose(day: HTMLElement): void {
        const date = day.dataset.date!;
        this.roveTo(date);
        this.props.onSelect?.(date);
    }

    private roveTo(date: string): void {
        this.focusDate = date;
        for (const el of this.el.querySelectorAll<HTMLElement>('[data-date]')) el.tabIndex = el.dataset.date === date ? 0 : -1;
    }

    private render(): void {
        const m = MONTH.exec(this.shown);
        if (!m) {
            this.el.replaceChildren();
            return;
        }
        const year = Number(m[1]);
        const month = Number(m[2]) - 1;
        const names = weekdayNames(this.settings);
        const startPad = (new Date(Date.UTC(year, month, 1)).getUTCDay() - this.weekStart + 7) % 7;
        const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const endPad = (7 - ((startPad + count) % 7)) % 7;
        const clickable = !!this.props.onSelect;
        const blank = (): HTMLElement => h('div', { slot: monthGridDef.slot('blank'), attrs: { 'aria-hidden': 'true' } });
        const cells: HTMLElement[] = [];
        for (let i = 0; i < 7; i++) cells.push(h('div', { slot: monthGridDef.slot('weekday'), attrs: { 'aria-hidden': 'true' }, text: names[(this.weekStart + i) % 7]! }));
        for (let i = 0; i < startPad; i++) cells.push(blank());
        const inMonth = (date: string | null): boolean => !!date && date.startsWith(`${this.shown}-`);
        const rover = [this.focusDate, this.selected, this.today].find(inMonth) ?? `${this.shown}-01`;
        for (let d = 1; d <= count; d++) {
            const date = `${this.shown}-${pad(d)}`;
            const day = this.days[date];
            const label = day?.label ?? [longDate(this.settings, year, month, d), day?.value, day?.detail].filter(Boolean).join(', ');
            const current = date === this.selected ? 'true' : date === this.today ? 'date' : null;
            cells.push(
                h(
                    clickable ? 'button' : 'div',
                    {
                        slot: monthGridDef.slot('day'),
                        data: { date, tone: day?.tone ?? null, today: date === this.today, checked: date === this.selected },
                        attrs: clickable ? { type: 'button', tabindex: date === rover ? '0' : '-1', 'aria-label': label, 'aria-current': current } : undefined,
                    },
                    h('span', { slot: monthGridDef.slot('date'), text: plainInteger(this.settings, d) }),
                    day?.value ? h('span', { slot: monthGridDef.slot('value'), text: day.value }) : null,
                    day?.detail ? h('span', { slot: monthGridDef.slot('detail'), text: day.detail }) : null,
                ),
            );
        }
        for (let i = 0; i < endPad; i++) cells.push(blank());
        const hadFocus = this.el.contains(document.activeElement);
        this.el.replaceChildren(...cells);
        if (hadFocus) this.el.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    }
}

export function createMonthGrid(props: MonthGridProps): MonthGridHandle {
    return new MonthGridImpl(props);
}
