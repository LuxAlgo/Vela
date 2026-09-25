// DatePicker VIEW — a month calendar with month/year panel switches in its header.
import { injectStyles } from '../../styles';
import { iconEl } from '../../icons';
import { datePickerController, WEEKDAY_LABELS, type DatePickerCell, type DatePickerControllerOptions } from './controller';
import { DATE_PICKER_CSS, DATE_PICKER_STYLE_ID } from './styles';

export interface DatePickerOptions extends DatePickerControllerOptions {
    /** A day was picked (`YYYY-MM-DD`). */
    onPick?: (value: string) => void;
}

export class DatePicker {
    readonly el: HTMLDivElement;
    private readonly ctrl: ReturnType<typeof datePickerController>;
    private readonly prev: HTMLButtonElement;
    private readonly next: HTMLButtonElement;
    private readonly monthBtn: HTMLButtonElement;
    private readonly yearBtn: HTMLButtonElement;
    private readonly week: HTMLDivElement;
    private readonly grid: HTMLDivElement;

    constructor(private readonly opts: DatePickerOptions = {}) {
        const doc = document;
        injectStyles(DATE_PICKER_STYLE_ID, DATE_PICKER_CSS, doc);
        this.ctrl = datePickerController(opts);
        const button = (className: string): HTMLButtonElement => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = className;
            return b;
        };
        this.prev = button('vela-date-picker-nav');
        this.prev.append(iconEl('chevron-left', doc));
        this.next = button('vela-date-picker-nav');
        this.next.append(iconEl('chevron-right', doc));
        this.monthBtn = button('vela-date-picker-switch');
        this.monthBtn.setAttribute('aria-label', 'Choose month');
        this.yearBtn = button('vela-date-picker-switch');
        this.yearBtn.setAttribute('aria-label', 'Choose year');
        const title = doc.createElement('div');
        title.className = 'vela-date-picker-title';
        title.append(this.monthBtn, this.yearBtn);
        const head = doc.createElement('div');
        head.className = 'vela-date-picker-head';
        head.append(this.prev, title, this.next);

        this.week = doc.createElement('div');
        this.week.className = 'vela-date-picker-week';
        for (const d of WEEKDAY_LABELS) {
            const cell = doc.createElement('span');
            cell.textContent = d;
            this.week.appendChild(cell);
        }
        this.grid = doc.createElement('div');

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

        this.el = doc.createElement('div');
        this.el.className = 'vela-date-picker';
        this.el.append(head, this.week, this.grid);
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

    private paint(): void {
        const doc = this.el.ownerDocument;
        const h = this.ctrl.header();
        this.monthBtn.hidden = !h.monthVisible;
        this.monthBtn.textContent = h.month;
        this.yearBtn.textContent = h.year;
        this.yearBtn.disabled = h.yearDisabled;
        const nav = this.ctrl.navLabels();
        this.prev.setAttribute('aria-label', nav.prev);
        this.next.setAttribute('aria-label', nav.next);
        const dates = this.ctrl.panel === 'date';
        this.week.hidden = !dates;
        this.grid.className = dates ? 'vela-date-picker-grid' : 'vela-date-picker-cells';
        this.grid.replaceChildren(...this.ctrl.cells().map((cell) => this.cellEl(doc, cell, dates)));
    }

    private cellEl(doc: Document, cell: DatePickerCell, dates: boolean): HTMLElement {
        if (cell.blank) {
            const blank = doc.createElement('span');
            blank.className = 'vela-date-picker-blank';
            return blank;
        }
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = dates ? 'vela-date-picker-day' : 'vela-date-picker-cell';
        b.textContent = cell.label;
        if (cell.checked) b.dataset.checked = '1';
        if (cell.today) b.dataset.today = '1';
        if (cell.outside) b.dataset.outside = '1';
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            const picked = this.ctrl.choose(cell);
            if (picked) this.opts.onPick?.(picked);
            else this.paint();
        });
        return b;
    }
}
