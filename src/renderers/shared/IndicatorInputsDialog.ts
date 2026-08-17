import type { InputSchema, InputValue, SymbolPickerFn } from '../../core/model/inputs';
import type { VelaTheme } from '../../core/options';
import { isDarkColor } from '../../core/color';
import { iconAt } from '../../core/icons';
import { applyChromeTokens } from './theme-tokens';
import { attachChromeTooltip } from './chrome-tooltip';
import { toggleSelectList, type SelectOption } from '../../ui/components/select';
import { Popover, closeOpenPopovers, eventDismissedPopover, isPopoverOpen, openPopoverTrigger } from '../../ui/components/popover';
import { Dialog } from '../../ui/components/dialog';
import { fieldRow, fieldSection, buildFieldControl, fieldGridColumns, FIELD_GAP_PX } from '../../ui/components/field';
import { overlayScrollbarCss, FIELD_FOCUS_CSS, FIELD_FOCUS_RING } from '../../ui/styles';

/** Emitted when the user edits an input in the in-chart settings dialog. */
export interface InputsUIChange {
    indicatorId: string;
    key: string;
    value: InputValue;
}

/** The slice of a legend row the settings dialog needs. */
export interface IndicatorDialogRow {
    id: string;
    settingsTitle: string;
    inputs: InputSchema[];
    values: Record<string, InputValue>;
}

export interface IndicatorDialogHost {
    container: HTMLElement;
    theme: () => VelaTheme;
    mobile: () => boolean;
    dialogHost: () => HTMLElement | null;
    symbolPicker: () => SymbolPickerFn | null;
    onChange: ((c: InputsUIChange) => void) | null;
    onBackdropClose: () => void;
}

const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];

/**
 * Indicator settings dialog — tabbed live-edit form opened from the legend gear.
 * Cancel reverts to the open-time snapshot; Ok / × / backdrop / Esc keep live edits.
 */
export class IndicatorInputsDialog {
    private dialog: HTMLElement | null = null;
    private backdrop: HTMLElement | null = null;
    private uiDialog: Dialog | null = null;
    openId: string | null = null;
    private row: IndicatorDialogRow | null = null;
    private snapshot: Record<string, InputValue> | null = null;
    private dialogTips: Array<() => void> = [];
    private choicePop: Popover | null = null;
    private calendarPop: Popover | null = null;
    private calendarAnchor: HTMLElement | null = null;

    constructor(private readonly host: IndicatorDialogHost) {}

    isOpen(): boolean {
        return this.dialog !== null;
    }

    private readonly onDialogKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            if (isPopoverOpen()) { closeOpenPopovers(); return; }
            this.close();
        }
    };

    open(row: IndicatorDialogRow): void {
        this.close();
        if (row.inputs.length === 0) return;
        this.row = row;
        this.openId = row.id;
        this.snapshot = { ...row.values };
        ensureDialogStyles();
        const t = this.host.theme();
        const border = 'var(--vela-border)';
        const fg = 'var(--vela-fg-bright)';
        const host = this.host.dialogHost() ?? this.host.container;

        const ui = new Dialog({
            host,
            title: row.settingsTitle,
            // Non-modal: live-edit dialog — a modal machine locks pointer events on the
            // whole body, killing the chart and the body-portaled popovers.
            modal: false,
            contained: true,
            align: 'center',
            draggable: !this.host.mobile(),
            flush: true,
            className: 'vela-dialog--form vela-ind-dialog',
            closeOnEscape: false,
            footer: (foot) => {
                foot.append(
                    this.dialogButton('Cancel', false, () => this.revertAndClose()),
                    this.dialogButton('Ok', true, () => this.close()),
                );
            },
            onOpenChange: (open) => { if (!open) this.close(); },
        });
        applyChromeTokens(ui.panel, t);
        ui.panel.style.colorScheme = this.isDarkTheme() ? 'dark' : 'light';
        this.dialogTips.push(attachChromeTooltip(ui.panel.querySelector('.vela-dialog-close') as HTMLElement, {
            host: this.host.container,
            theme: () => this.host.theme(),
            text: () => 'Close',
        }));

        const tabDefs = tabInputs(row.inputs);
        const tabs = document.createElement('div');
        tabs.style.cssText = `display:flex;gap:12px;padding:0 20px;border-bottom:1px solid ${border};flex:0 0 auto;`;
        const tabEls: HTMLElement[] = [];
        const bodies: HTMLElement[] = [];
        const activate = (idx: number): void => {
            for (let i = 0; i < tabEls.length; i += 1) {
                const active = i === idx;
                const el = tabEls[i]!;
                el.style.borderBottomColor = active ? fg : 'transparent';
                el.style.color = active ? 'inherit' : 'var(--vela-fg-muted)';
                el.classList.toggle('vela-ind-tab-active', active);
                bodies[i]!.style.display = active ? 'grid' : 'none';
            }
        };
        for (const [idx, def] of tabDefs.entries()) {
            const tab = document.createElement('div');
            tab.textContent = def.name;
            tab.className = 'vela-ind-tab';
            tab.style.cssText = `padding:0 0 8px;margin-bottom:-1px;border-bottom:2px solid transparent;${tabDefs.length > 1 ? 'cursor:pointer;' : ''}`;
            tab.addEventListener('click', () => activate(idx));
            tabs.appendChild(tab);
            tabEls.push(tab);
            bodies.push(this.buildTabBody(def.inputs, row));
        }
        ui.body.appendChild(tabs);
        for (const b of bodies) ui.body.appendChild(b);
        activate(0);

        const onBackdropDown = (e: Event): void => {
            if (e.target !== ui.backdrop && e.target !== ui.positioner) return;
            // An open portaled popover (color picker, select list, calendar) is part of
            // the dialog: the first outside click dismisses it, not the dialog itself.
            if (isPopoverOpen() || eventDismissedPopover(e)) {
                closeOpenPopovers();
                return;
            }
            this.close();
            this.host.onBackdropClose();
        };
        ui.backdrop.addEventListener('pointerdown', onBackdropDown);
        ui.positioner.addEventListener('pointerdown', onBackdropDown);
        this.uiDialog = ui;
        this.dialog = ui.panel;
        this.backdrop = ui.backdrop;
        ui.show();
        document.addEventListener('keydown', this.onDialogKey);
    }

    /** One tab's scrollable body — one shared grid so every group's controls share a
     *  left edge (a 100px number field lines up with a wider session/time pair). */
    private buildTabBody(inputs: InputSchema[], row: IndicatorDialogRow): HTMLElement {
        const body = document.createElement('div');
        // `display:contents` on each group lets headers + rows participate in this
        // one grid; per-section grids would each pick their own control-column width.
        // overflow-x is pinned to hidden: `overflow-y:auto` alone would compute overflow-x
        // to auto too, and a transient sliver of horizontal overflow (layout settling, the
        // vertical scrollbar stealing width from the fit-content card) then flashes a
        // horizontal scrollbar across the bottom of the dialog.
        // overflow-anchor is OFF: Chrome's scroll anchoring miscompensates when a body-portaled
        // popover (color picker, select list) is swapped in one gesture, jumping this scroller
        // to its max — content here only scrolls when the user scrolls it.
        body.style.cssText = inputDialogBodyStyle(this.host.mobile());
        for (const group of groupInputs(inputs)) {
            const section = document.createElement('div');
            section.style.cssText = 'display:contents;';
            if (group.name) {
                section.appendChild(fieldSection(group.name, { variant: 'inputs', first: body.childElementCount === 0 }));
            }
            for (const inputRow of group.rows) this.buildInputRow(section, inputRow, row);
            body.appendChild(section);
        }
        return body;
    }

    close(): void {
        document.removeEventListener('keydown', this.onDialogKey);
        closeOpenPopovers();
        this.choicePop = null;
        this.calendarPop = null;
        this.calendarAnchor = null;
        for (const dispose of this.dialogTips.splice(0)) dispose(); // a tip open right now dies with its dialog
        const ui = this.uiDialog;
        this.uiDialog = null;
        this.backdrop = null;
        this.dialog = null;
        this.openId = null;
        this.row = null;
        this.snapshot = null;
        ui?.destroy();
    }

    /** Restore every input to its open-time value (re-running the indicator), then close. */
    private revertAndClose(): void {
        const row = this.row;
        const snap = this.snapshot;
        if (row && snap) {
            for (const inp of row.inputs) {
                const snapped = snap[inp.key];
                const before: InputValue = snapped !== undefined ? snapped : inp.defval;
                if (row.values[inp.key] !== before) {
                    row.values[inp.key] = before;
                    this.host.onChange?.({ indicatorId: row.id, key: inp.key, value: before });
                }
            }
        }
        this.close();
    }

    /** One settings row (or several `inline=` inputs) placed into a section's grid. */
    private buildInputRow(grid: HTMLElement, decls: InputSchema[], row: IndicatorDialogRow): void {
        const idOf = (inp: InputSchema): string => `vela-inp-${row.id}-${inp.key}`;

        if (decls.length > 1) {
            grid.appendChild(fieldRow({
                label: '',
                inline: decls.map((d) => ({
                    label: nameOf(d) || undefined,
                    id: idOf(d),
                    control: this.buildControl(row, d, idOf(d)),
                    toggleFirst: d.type === 'bool',
                    fit: d.type === 'color' || d.type === 'bool',
                })),
                info: [...decls].reverse().find((d) => d.tooltip)?.tooltip
                    ? this.infoButton([...decls].reverse().find((d) => d.tooltip)!.tooltip!)
                    : undefined,
            }));
            return;
        }

        const lead = decls[0]!;
        const id = idOf(lead);
        const info = lead.tooltip ? this.infoButton(lead.tooltip) : undefined;

        if (lead.type === 'bool') {
            const current = Boolean(row.values[lead.key] ?? lead.defval);
            grid.appendChild(fieldRow({
                label: nameOf(lead),
                id,
                bool: true,
                info,
                toggle: {
                    id,
                    checked: current,
                    onChange: (v) => {
                        row.values[lead.key] = v;
                        this.host.onChange?.({ indicatorId: row.id, key: lead.key, value: v });
                    },
                },
            }));
            return;
        }

        if (lead.type === 'text_area') {
            grid.appendChild(fieldRow({
                label: nameOf(lead),
                id,
                stacked: true,
                info,
                control: this.buildControl(row, lead, id),
            }));
            return;
        }

        const fit = lead.type === 'color' || lead.type === 'session' || lead.type === 'time';
        grid.appendChild(fieldRow({
            label: nameOf(lead),
            id,
            fit,
            controlWidth: fit ? undefined : 100,
            info,
            control: this.buildControl(row, lead, id),
        }));
    }

    /** Build the typed control for one input, committing edits live via `onChange`. */
    private buildControl(row: IndicatorDialogRow, inp: InputSchema, id: string): HTMLElement {
        const current = row.values[inp.key] ?? inp.defval;
        const emit = (value: InputValue): void => {
            row.values[inp.key] = value;
            this.host.onChange?.({ indicatorId: row.id, key: inp.key, value });
        };

        if (inp.type === 'bool') {
            return buildFieldControl({ kind: 'switch', id, checked: Boolean(current), onChange: (v) => emit(v) }).el;
        }
        if (inp.options && inp.options.length > 0) return this.select(id, inp.options.map(String), String(current), emit);
        if (inp.type === 'source') return this.select(id, SOURCES, String(current), emit);
        if (inp.type === 'color') {
            return buildFieldControl({
                kind: 'color',
                id,
                theme: this.host.theme(),
                get: () => String(row.values[inp.key] ?? inp.defval),
                onChange: (v) => emit(v),
            }).el;
        }
        if (inp.type === 'symbol') return this.buildSymbol(id, String(current), emit);
        if (inp.type === 'timeframe') return this.selectPairs(id, TIMEFRAME_OPTIONS, String(current), emit);
        if (inp.type === 'session') return this.buildSession(id, String(current), emit);
        if (inp.type === 'time') return this.buildTime(id, Number(current) || 0, emit);
        if (inp.type === 'text_area') {
            return buildFieldControl({
                kind: 'textarea',
                id,
                value: String(current),
                onChange: (v) => emit(v),
            }).el;
        }
        if (inp.type === 'int' || inp.type === 'float' || inp.type === 'price') {
            return buildFieldControl({
                kind: 'number',
                id,
                value: Number(current),
                min: inp.min,
                max: inp.max,
                step: inp.step ?? (inp.type === 'int' ? 1 : 0.1),
                integer: inp.type === 'int',
                commit: 'blur',
                onChange: (v) => emit(v),
            }).el;
        }
        return this.buildTextField(id, String(current), emit);
    }

    /** A plain text field that commits on blur / Enter (shared by string inputs and the pickerless symbol field). */
    private buildTextField(id: string, current: string, emit: (v: InputValue) => void): HTMLElement {
        return buildFieldControl({ kind: 'text', id, value: current, onChange: emit }).el;
    }

    /** A hoverable ⓘ affordance carrying an input's `tooltip` (themed chrome tip; wraps). */
    private infoButton(tooltip: string): HTMLElement {
        const b = document.createElement('span');
        b.textContent = 'i';
        this.dialogTips.push(attachChromeTooltip(b, { host: this.host.container, theme: () => this.host.theme(), text: () => tooltip, wrap: true, delayMs: 250 }));
        b.className = 'vela-ind-hint';
        b.style.cssText = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-weight:600;font-size:11px;font-family:inherit;line-height:1;cursor:help;user-select:none;';
        return b;
    }

    /** A dropdown over plain string options (value === label) — a thin case of {@link selectPairs}. */
    private select(id: string, options: string[], current: string, emit: (v: InputValue) => void): HTMLElement {
        return this.selectPairs(id, options.map((o) => ({ value: o, label: o })), current, emit);
    }

    /** A dropdown whose visible labels differ from the committed values (label ≠ value pairs). */
    private selectPairs(id: string, pairs: readonly SelectOption[], current: string, onChange: (v: string) => void): HTMLElement {
        return buildFieldControl({
            kind: 'select',
            id,
            options: pairs,
            value: current,
            theme: this.host.theme(),
            list: this.listPopover(),
            onChange,
        }).el;
    }

    /** `input.session` → two typeable HH:MM comboboxes committing a `HHMM-HHMM` session string. */
    private buildSession(id: string, current: string, emit: (v: InputValue) => void): HTMLElement {
        const [start, end] = sessionToTimes(current);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
        let from = start;
        let to = end;
        const commit = (): void => emit(timesToSession(from, to));
        wrap.append(
            this.timeCombobox(id, from, 86, (v) => { from = v; commit(); }),
            this.timeCombobox(`${id}-end`, to, 86, (v) => { to = v; commit(); }),
        );
        return wrap;
    }

    /** `input.time` → a date picker + an HH:MM dropdown, committing an epoch-ms timestamp. */
    private buildTime(id: string, current: number, emit: (v: InputValue) => void): HTMLElement {
        const parts = timeParts(current);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
        let date = parts.date;
        let time = parts.time;
        const commit = (): void => {
            if (!date) return; // no date chosen yet → nothing to commit
            const ms = Date.parse(`${date}T${time}:00`);
            if (Number.isFinite(ms)) emit(ms);
        };
        const dateField = this.dateField(id, date, (v) => { date = v; commit(); });
        const timeSel = this.timeCombobox(`${id}-time`, time, 86, (v) => { time = v; commit(); });
        wrap.append(dateField, timeSel);
        return wrap;
    }

    /** A fixed-width HH:MM combobox (typeable, plus a 30-minute-step dropdown) used by session + time. */
    private timeCombobox(id: string, current: string, width: number, onChange: (v: string) => void): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'vela-ind-combo';
        wrap.style.cssText = `position:relative;width:${width}px;`;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.value = current;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.style.cssText = `${this.ctrlStyle()}padding-right:26px;`;
        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.tabIndex = -1;
        chevron.className = 'vela-ind-combo-chevron';
        chevron.setAttribute('aria-label', 'Open time list');
        chevron.innerHTML = CLOCK_SVG;
        let value = current;
        const commitTyped = (): void => {
            const next = normalizeTimeInput(input.value);
            if (!next) { input.value = value; return; }
            input.value = next;
            if (next !== value) { value = next; onChange(next); }
        };
        input.addEventListener('blur', () => {
            // A click on the open list focuses the item, not the input — don't revert yet.
            if (isPopoverOpen()) return;
            commitTyped();
        });
        const pick = (v: string): void => {
            value = v;
            input.value = v;
            onChange(v);
        };
        const openList = (): void => {
            this.choicePop = toggleSelectList(wrap, TIME_OPTIONS, value, pick, {
                ...this.listPopover(),
                onClose: () => { this.choicePop = null; },
            });
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitTyped(); input.blur(); }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                openList();
            }
        });
        const open = (e: Event): void => {
            e.preventDefault();
            e.stopPropagation();
            openList();
        };
        // The field itself is the dropdown trigger — typing still works while the list is open.
        input.addEventListener('click', open);
        chevron.addEventListener('mousedown', (e) => e.preventDefault()); // keep input focused
        chevron.addEventListener('click', open);
        wrap.append(input, chevron);
        return wrap;
    }

    /** A typeable YYYY-MM-DD field that also opens a themed month calendar. */
    private dateField(id: string, current: string, onChange: (v: string) => void): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'vela-ind-combo';
        wrap.style.cssText = 'position:relative;width:128px;';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = id;
        input.value = current;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.style.cssText = `${this.ctrlStyle()}padding-right:26px;`;
        const chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.tabIndex = -1;
        chevron.className = 'vela-ind-combo-chevron';
        chevron.setAttribute('aria-label', 'Open calendar');
        chevron.innerHTML = CALENDAR_SVG;
        let value = current;
        const commitTyped = (): void => {
            const next = normalizeDateInput(input.value);
            if (!next) { input.value = value; return; }
            input.value = next;
            if (next !== value) { value = next; onChange(next); }
        };
        input.addEventListener('blur', () => {
            if (isPopoverOpen()) return;
            commitTyped();
        });
        const pick = (v: string): void => {
            value = v;
            input.value = v;
            onChange(v);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitTyped(); input.blur(); }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.openCalendar(wrap, value, pick);
            }
        });
        const open = (e: Event): void => {
            e.preventDefault();
            e.stopPropagation();
            if (openPopoverTrigger() === wrap) {
                closeOpenPopovers();
                return;
            }
            this.openCalendar(wrap, value, pick);
        };
        input.addEventListener('click', open);
        chevron.addEventListener('mousedown', (e) => e.preventDefault());
        chevron.addEventListener('click', open);
        wrap.append(input, chevron);
        return wrap;
    }

    /** Placement shared by the indicator dialog's dropdowns and the time combobox. */
    private listPopover(): { theme: VelaTheme; matchWidth: boolean; boundary: HTMLElement | 'viewport'; boundaryInset: number; gap: number } {
        return {
            theme: this.host.theme(),
            matchWidth: true,
            boundary: this.dialog ?? 'viewport',
            boundaryInset: 8,
            gap: 4,
        };
    }

    /** Open a themed month calendar under `anchor` — same surface + shadow as the choice list. */
    private openCalendar(anchor: HTMLElement, current: string, onPick: (iso: string) => void): void {
        const parsed = parseIsoDate(current);
        let year = parsed?.getFullYear() ?? new Date().getFullYear();
        let month = parsed?.getMonth() ?? new Date().getMonth();
        const selected = parsed ? isoDate(parsed) : current;

        const pop = new Popover({
            trigger: anchor,
            theme: this.host.theme(),
            className: 'vela-ind-cal',
            boundary: this.dialog ?? 'viewport',
            boundaryInset: 8,
            gap: 4,
            onClose: () => {
                this.calendarPop = null;
                this.calendarAnchor = null;
            },
            content: (el) => {
                const title = document.createElement('div');
                title.className = 'vela-ind-cal-title';
                const prev = document.createElement('button');
                prev.type = 'button';
                prev.className = 'vela-ind-cal-nav';
                prev.setAttribute('aria-label', 'Previous month');
                prev.innerHTML = iconAt('chevron-left', 14);
                const next = document.createElement('button');
                next.type = 'button';
                next.className = 'vela-ind-cal-nav';
                next.setAttribute('aria-label', 'Next month');
                next.innerHTML = iconAt('chevron-right', 14);
                const head = document.createElement('div');
                head.className = 'vela-ind-cal-head';
                head.append(prev, title, next);

                const week = document.createElement('div');
                week.className = 'vela-ind-cal-week';
                for (const d of WEEKDAY_LABELS) {
                    const cell = document.createElement('span');
                    cell.textContent = d;
                    week.appendChild(cell);
                }
                const grid = document.createElement('div');
                grid.className = 'vela-ind-cal-grid';

                const paint = (): void => {
                    title.textContent = `${MONTH_LABELS[month]} ${year}`;
                    grid.replaceChildren();
                    const first = new Date(year, month, 1);
                    const startPad = first.getDay();
                    const days = new Date(year, month + 1, 0).getDate();
                    const today = isoDate(new Date());
                    for (let i = 0; i < startPad; i++) {
                        const blank = document.createElement('span');
                        blank.className = 'vela-ind-cal-blank';
                        grid.appendChild(blank);
                    }
                    for (let day = 1; day <= days; day++) {
                        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                        const b = document.createElement('button');
                        b.type = 'button';
                        b.className = 'vela-ind-cal-day';
                        b.textContent = String(day);
                        if (iso === selected) b.dataset.checked = '1';
                        if (iso === today) b.dataset.today = '1';
                        b.addEventListener('click', (e) => {
                            e.stopPropagation();
                            pop.hide();
                            onPick(iso);
                        });
                        grid.appendChild(b);
                    }
                };
                prev.addEventListener('click', (e) => {
                    e.stopPropagation();
                    month -= 1;
                    if (month < 0) { month = 11; year -= 1; }
                    paint();
                });
                next.addEventListener('click', (e) => {
                    e.stopPropagation();
                    month += 1;
                    if (month > 11) { month = 0; year += 1; }
                    paint();
                });
                paint();
                el.append(head, week, grid);
            },
        });
        this.calendarPop = pop;
        this.calendarAnchor = anchor;
        pop.show();
    }

    /**
     * `input.symbol` → a field that opens the host's ticker-selection UI when a picker is wired
     * (the chosen symbol is written back), else a plain text field (type the ticker).
     */
    private buildSymbol(id: string, current: string, emit: (v: InputValue) => void): HTMLElement {
        const picker = this.host.symbolPicker();
        if (!picker) return this.buildTextField(id, current, emit);
        // Track the stored symbol so the picker is seeded with the actual value (not the
        // placeholder), and stays in sync after each pick for subsequent openings.
        let value = current;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = id;
        btn.style.cssText = `${this.ctrlStyle()}display:flex;align-items:center;cursor:pointer;text-align:left;`;
        const label = document.createElement('span');
        label.textContent = value || 'Select symbol…';
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        btn.append(label);
        btn.addEventListener('click', () => picker(value, (picked) => {
            if (!picked) return;
            value = picked;
            label.textContent = picked;
            emit(picked);
        }));
        return btn;
    }

    /** Shared field chrome for text / number / select controls (fills its wrapper's width). */
    private ctrlStyle(): string {
        return 'width:100%;box-sizing:border-box;height:34px;background:transparent;border:1px solid var(--vela-border-strong);color:var(--vela-fg-bright);border-radius:6px;padding:0 8px;font-size:14px;font-family:inherit;outline:none;';
    }

    /** Whether the active theme is dark (drives the dialog's `color-scheme`). */
    private isDarkTheme(): boolean {
        return isDarkColor(this.host.theme().background);
    }

    private dialogButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        // Primary = filled inverse chip; Cancel = outlined. Both hover states are in the
        // scoped stylesheet.
        b.className = primary ? 'vela-dialog-btn vela-dialog-btn-primary' : 'vela-dialog-btn';
        b.addEventListener('click', onClick);
        return b;
    }
}

/**
 * Display name for an input: its `title`, first letter capitalized. A blank title yields no label
 * (empty string) — the Pine idiom for a companion `inline=` control (e.g. `input.timeframe('1', '')`).
 * An omitted title is already substituted with the input's key upstream in `mapInputs`, so a blank
 * title reaching here is an explicit "no label" rather than a missing one.
 */
export function nameOf(inp: InputSchema): string {
    const t = inp.title;
    return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/** Label↔control and between-row rhythm of the indicator settings dialog. */
export const INPUT_DIALOG_GAP_PX = FIELD_GAP_PX;

/**
 * Inline style for one tab's scrollable settings grid.
 * `align-content:start` is load-bearing on mobile: the body flex-grows to fill the
 * fullscreen card, and grid's default stretch would inflate each row past the
 * {@link INPUT_DIALOG_GAP_PX} rhythm.
 */
export function inputDialogBodyStyle(mobile: boolean): string {
    const columns = fieldGridColumns('inputs', mobile);
    return (
        `padding:16px 20px;overflow-y:auto;overflow-x:hidden;overflow-anchor:none;` +
        `flex:1 1 auto;display:grid;grid-template-columns:${columns};` +
        `align-items:center;align-content:start;` +
        `column-gap:${INPUT_DIALOG_GAP_PX}px;row-gap:${INPUT_DIALOG_GAP_PX}px;`
    );
}

/** The settings-dialog tab hosting inputs that declare no `tab=`. */
export const DEFAULT_INPUT_TAB = 'Inputs';

/** One settings-dialog tab: its strip label and the inputs it hosts (declaration order). */
export interface InputTab {
    name: string;
    inputs: InputSchema[];
}

/**
 * Partition inputs into settings-dialog tabs. Inputs without a `tab=` land on the
 * default "Inputs" tab (an explicit `tab='Inputs'` merges with it), which leads the
 * strip whenever it has members; declared tabs follow in first-seen order. Within a
 * tab, declaration order is kept — `group=`/`inline=` layout happens per tab.
 */
export function tabInputs(inputs: InputSchema[]): InputTab[] {
    const byTab = new Map<string, InputSchema[]>();
    for (const inp of inputs) {
        const name = inp.tab && inp.tab.length > 0 ? inp.tab : DEFAULT_INPUT_TAB;
        if (!byTab.has(name)) byTab.set(name, []);
        byTab.get(name)!.push(inp);
    }
    const names = [...byTab.keys()];
    if (names.includes(DEFAULT_INPUT_TAB)) {
        names.splice(names.indexOf(DEFAULT_INPUT_TAB), 1);
        names.unshift(DEFAULT_INPUT_TAB);
    }
    return names.map((name) => ({ name, inputs: byTab.get(name)! }));
}

interface InputGroup {
    name: string | null;
    rows: InputSchema[][];
}

/**
 * Bucket inputs into `group=` sections (first-seen order — a section appears at its first
 * member's position, ungrouped inputs stay where declared) and, within each, collapse
 * inputs that share an `inline=` id onto one row (Pine convention).
 */
function groupInputs(inputs: InputSchema[]): InputGroup[] {
    const order: (string | null)[] = [];
    const byGroup = new Map<string | null, InputSchema[]>();
    for (const inp of inputs) {
        const g = inp.group && inp.group.length > 0 ? inp.group : null;
        if (!byGroup.has(g)) {
            byGroup.set(g, []);
            order.push(g);
        }
        byGroup.get(g)!.push(inp);
    }
    return order.map((name) => {
        const members = byGroup.get(name)!;
        const rows: InputSchema[][] = [];
        const inlineRowIndex = new Map<string, number>();
        for (const inp of members) {
            const inline = inp.inline && inp.inline.length > 0 ? inp.inline : null;
            if (inline && inlineRowIndex.has(inline)) {
                rows[inlineRowIndex.get(inline)!]!.push(inp);
            } else {
                if (inline) inlineRowIndex.set(inline, rows.length);
                rows.push([inp]);
            }
        }
        return { name, rows };
    });
}

const CALENDAR_SVG = iconAt('calendar', 14);
const CLOCK_SVG = iconAt('clock', 14);

const DIALOG_STYLE_ID = 'vela-ind-dialog-styles';
/** Bump when the injected sheet's rules change so an already-mounted page refreshes them. */
const DIALOG_STYLE_REV = '29';
const LEGEND_ICON_PX = 16;

/** Inject the scoped styles inline cssText can't reach (color-swatch, focus ring, scrollbar). */
export function ensureDialogStyles(): void {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(DIALOG_STYLE_ID) as HTMLStyleElement | null;
    if (existing?.dataset.rev === DIALOG_STYLE_REV) return;
    const s = existing ?? document.createElement('style');
    s.id = DIALOG_STYLE_ID;
    s.dataset.rev = DIALOG_STYLE_REV;
    s.textContent = `
.vela-ind-combo input{${FIELD_FOCUS_CSS}}
.vela-ind-combo input:hover{border-color:var(--vela-fg-muted);}
.vela-ind-combo input:focus{${FIELD_FOCUS_RING}}
.vela-ind-combo-chevron{position:absolute;right:0;top:0;bottom:0;width:26px;border:none;background:transparent;color:inherit;opacity:0.55;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
.vela-ind-combo-chevron:hover{opacity:0.9;}
.vela-ind-cal{background:var(--vela-bg);color:var(--vela-fg);border:none;border-radius:6px;box-shadow:var(--vela-shadow);font:14px var(--vela-font);padding:10px 12px;user-select:none;}
.vela-ind-cal-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.vela-ind-cal-title{flex:1;text-align:center;font-weight:600;font-size:14px;color:var(--vela-fg-bright);}
.vela-ind-cal-nav{width:24px;height:24px;border:none;background:transparent;color:var(--vela-fg-muted);border-radius:4px;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
.vela-ind-cal-nav:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-ind-cal-week,.vela-ind-cal-grid{display:grid;grid-template-columns:repeat(7,28px);gap:2px;}
.vela-ind-cal-week{margin-bottom:4px;color:var(--vela-fg-muted);font-size:11px;text-align:center;}
.vela-ind-cal-week span{line-height:20px;}
.vela-ind-cal-blank{width:28px;height:28px;}
.vela-ind-cal-day{width:28px;height:28px;border:none;background:transparent;color:inherit;border-radius:4px;padding:0;cursor:pointer;font:inherit;font-size:14px;}
.vela-ind-cal-day:hover{background:var(--vela-hover);}
.vela-ind-cal-day[data-checked]{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-ind-cal-day[data-today]:not([data-checked]){box-shadow:inset 0 0 0 1px var(--vela-border-strong);}
${overlayScrollbarCss('.vela-dialog.vela-ind-dialog *', 9)}
.vela-ind-tab{font-weight:600;font-size:13px;line-height:20px;transition:color var(--vela-dur-fast) ease,border-color var(--vela-dur-fast) ease;}
.vela-ind-tab:not(.vela-ind-tab-active):hover{color:var(--vela-fg-bright);}
.vela-ind-hint{background:var(--vela-hover);color:var(--vela-fg-muted);transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-ind-hint:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-ind-ctl,.vela-ind-close{background-color:transparent;color:inherit;transition:color var(--vela-dur-fast) ease,background-color var(--vela-dur-fast) ease;}
.vela-ind-ctl svg,.vela-ind-close svg{width:${LEGEND_ICON_PX}px;height:${LEGEND_ICON_PX}px;display:block;flex:none;stroke-width:1;}
.vela-ind-ctl:hover{background-color:var(--vela-hover-strong);}
.vela-ind-close:hover{color:var(--vela-danger) !important;background-color:var(--vela-hover-strong);}
.vela-ind-fold{transition:border-color var(--vela-dur-fast) ease,opacity var(--vela-dur-fast) ease;}
.vela-ind-fold:hover{border-color:var(--vela-border-strong);opacity:0.9;}`;
    if (!existing) document.head.appendChild(s);
}

/** `input.timeframe` choices — label shown, Pine resolution string committed (`''` = chart's). */
const TIMEFRAME_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '', label: 'Chart' },
    { value: '1', label: '1 minute' },
    { value: '3', label: '3 minutes' },
    { value: '5', label: '5 minutes' },
    { value: '15', label: '15 minutes' },
    { value: '30', label: '30 minutes' },
    { value: '45', label: '45 minutes' },
    { value: '60', label: '1 hour' },
    { value: '120', label: '2 hours' },
    { value: '180', label: '3 hours' },
    { value: '240', label: '4 hours' },
    { value: 'D', label: '1 day' },
    { value: 'W', label: '1 week' },
    { value: 'M', label: '1 month' },
];

/** HH:MM options at 30-minute steps (`00:00` … `23:30`) for the session + time dropdowns. */
const TIME_OPTIONS: readonly { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
    const hh = String(Math.floor(i / 2)).padStart(2, '0');
    const mm = i % 2 === 0 ? '00' : '30';
    const v = `${hh}:${mm}`;
    return { value: v, label: v };
});

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Accept `YYYY-MM-DD` or `YYYY-M-D` and return a padded ISO date, or null if unusable. */
export function normalizeDateInput(raw: string): string | null {
    const t = raw.trim();
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return isoDate(dt);
}

function parseIsoDate(raw: string): Date | null {
    const iso = normalizeDateInput(raw);
    if (!iso) return null;
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(y!, mo! - 1, d!);
}

function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Accept `HH:MM`, `H:MM`, or `HHMM` and return a padded `HH:MM`, or null if unusable. */
export function normalizeTimeInput(raw: string): string | null {
    const t = raw.trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Split a Pine `HHMM-HHMM` session into two `HH:MM` strings (defaults `09:00`–`16:00`). */
function sessionToTimes(session: string): [string, string] {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(session.trim());
    if (!m) return ['09:00', '16:00'];
    return [`${m[1]}:${m[2]}`, `${m[3]}:${m[4]}`];
}

/** Recombine two `HH:MM` strings into a Pine `HHMM-HHMM` session string. */
function timesToSession(start: string, end: string): string {
    return `${start.replace(':', '')}-${end.replace(':', '')}`;
}

/** Split an epoch timestamp (s or ms) into a `YYYY-MM-DD` date + a 30-min-snapped `HH:MM`. */
function timeParts(ts: number): { date: string; time: string } {
    if (!ts) return { date: '', time: '09:30' };
    const ms = ts < 1e12 ? ts * 1000 : ts; // Pine epochs may arrive in seconds
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return { date: '', time: '09:30' };
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const snapped = Math.round((d.getHours() * 60 + d.getMinutes()) / 30) * 30;
    const hh = String(Math.floor(snapped / 60) % 24).padStart(2, '0');
    const mm = String(snapped % 60).padStart(2, '0');
    return { date, time: `${hh}:${mm}` };
}

