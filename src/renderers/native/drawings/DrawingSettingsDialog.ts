import type { VelaTheme } from '../../../core/options';
import type { Drawing, FrvpStyle, PositionLevelMode, SerializedDrawing } from '../../../core/drawings';
import {
    DIRECTION_OPTIONS,
    FixedRangeVolumeProfile,
    LINE_STYLE_OPTIONS,
    MachFigure,
    PositionTool,
    clonePlain,
} from '../../../core/drawings';
import { contrastColor } from '../../shared/drawing-geometry';
import { applyChromeTokens } from '../../shared/theme-tokens';
import { Dialog } from '../../../ui/components/dialog';
import { closeOpenPopovers, eventDismissedPopover, isPopoverOpen } from '../../../ui/components/popover';
import { fieldGrid, fieldRow, fieldSection, buildFieldControl } from '../../../ui/components/field';
import type { SelectOption } from '../../../ui/components/select';
import type { SettingsActions } from './DrawingSettingsPopup';

export type DrawingDialogKind = 'position' | 'frvp' | 'levels';

const LEVEL_UNITS: readonly SelectOption[] = [
    { value: 'price', label: 'Price' },
    { value: 'points', label: 'Points' },
];
const FRVP_ANCHOR: readonly SelectOption[] = [
    { value: 'right', label: 'Right' },
    { value: 'left', label: 'Left' },
];

const TITLES: Record<DrawingDialogKind, string> = {
    position: 'Position size',
    frvp: 'Volume profile',
    levels: 'Levels',
};

/**
 * Settings dialog opened from the drawing toolbar's gear. Same shell and field
 * language as the indicator inputs dialog: live edits, Cancel restores the
 * open-time snapshot, Ok keeps them.
 */
export class DrawingSettingsDialog {
    private ui: Dialog | null = null;
    private theme: VelaTheme;

    constructor(private readonly host: HTMLElement, theme: VelaTheme) {
        this.theme = theme;
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
    }

    isOpen(): boolean {
        return this.ui != null;
    }

    contains(node: Node | null): boolean {
        return this.ui?.contains(node) === true;
    }

    open(drawing: Drawing, actions: SettingsActions, kind: DrawingDialogKind): void {
        this.close();
        const snapshot = clonePlain(drawing.serialize());
        const grid = fieldGrid({ variant: 'inputs' });
        grid.style.padding = '16px 20px';
        grid.style.overflowY = 'auto';
        grid.style.overflowX = 'hidden';
        grid.style.flex = '1 1 auto';
        if (kind === 'position' && drawing instanceof PositionTool) this.buildPosition(grid, drawing, actions);
        else if (kind === 'frvp' && drawing instanceof FixedRangeVolumeProfile) this.buildFrvp(grid, drawing, actions);
        else if (kind === 'levels') this.buildLevels(grid, drawing, actions);
        else return;

        const ui = new Dialog({
            host: this.host,
            title: TITLES[kind],
            // Non-modal: live-edit dialog — a modal machine locks pointer events on the
            // whole body, killing the chart and the body-portaled popovers.
            modal: false,
            contained: true,
            align: 'center',
            draggable: true,
            flush: true,
            className: 'vela-dialog--form',
            closeOnEscape: false,
            footer: (foot) => {
                foot.append(
                    btn('Cancel', false, () => {
                        actions.restore?.(snapshot);
                        this.close();
                    }),
                    btn('Ok', true, () => this.close()),
                );
            },
            onOpenChange: (open) => { if (!open) this.close(); },
        });
        applyChromeTokens(ui.panel, this.theme);
        ui.body.appendChild(grid);
        const onBackdropDown = (e: Event): void => {
            if (e.target !== ui.backdrop && e.target !== ui.positioner) return;
            // An open portaled popover (color picker, select list) is part of the
            // dialog: the first outside click dismisses it, not the dialog itself.
            if (isPopoverOpen() || eventDismissedPopover(e)) {
                closeOpenPopovers();
                return;
            }
            this.close();
        };
        ui.backdrop.addEventListener('pointerdown', onBackdropDown);
        ui.positioner.addEventListener('pointerdown', onBackdropDown);
        ui.panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                actions.restore?.(snapshot);
                this.close();
            }
        });
        this.ui = ui;
        ui.show();
    }

    close(): void {
        const ui = this.ui;
        this.ui = null;
        ui?.destroy();
    }

    destroy(): void {
        this.close();
    }

    private buildPosition(grid: HTMLElement, drawing: PositionTool, actions: SettingsActions): void {
        const live = (): PositionTool => {
            const d = actions.resolve();
            return d instanceof PositionTool ? d : drawing;
        };
        const refreshers: Array<() => void> = [];
        const refreshAll = (): void => refreshers.forEach((f) => f());
        const fmt = (n: number): number => Math.round(n * 1e8) / 1e8;

        const numberRow = (
            label: string,
            path: 'riskPercent' | 'accountBalance' | 'quantity' | 'entryPrice',
            clamp?: { min: number; max: number; step: number; integer?: boolean },
        ): void => {
            const ctrl = buildFieldControl({
                kind: 'number',
                value: fmt(live()[path]),
                min: clamp?.min,
                max: clamp?.max,
                step: clamp?.step,
                integer: clamp?.integer,
                fill: false,
                commit: 'blur',
                onChange: (n) => {
                    actions.patch({ [path]: n });
                    refreshAll();
                },
            });
            refreshers.push(() => {
                if (document.activeElement !== ctrl.el.querySelector('input')) ctrl.setValue?.(fmt(live()[path]));
            });
            grid.appendChild(fieldRow({ label, control: ctrl.el }));
        };

        const levelRow = (label: string, path: 'stopPrice' | 'targetPrice', level: 'stop' | 'target'): void => {
            let mode: PositionLevelMode = 'price';
            const display = (): number => fmt(live().levelDisplayValue(level, mode));
            const ni = buildFieldControl({
                kind: 'number',
                value: display(),
                fill: false,
                commit: 'blur',
                onChange: (n) => {
                    actions.patch({ [path]: live().levelPriceFromDisplay(level, mode, n) });
                    refreshAll();
                },
            });
            const sel = buildFieldControl({
                kind: 'select',
                options: LEVEL_UNITS,
                value: mode,
                fill: false,
                theme: this.theme,
                onChange: (v) => {
                    mode = v as PositionLevelMode;
                    ni.setValue?.(display());
                },
            });
            refreshers.push(() => {
                if (document.activeElement !== ni.el.querySelector('input')) ni.setValue?.(display());
            });
            grid.appendChild(fieldRow({ label, control: [ni.el, sel.el] }));
        };

        grid.appendChild(fieldSection('Account', { variant: 'inputs', first: true }));
        numberRow('Risk %', 'riskPercent', { min: 0, max: 100, step: 0.1 });
        numberRow('Account balance', 'accountBalance', { min: 0, max: 1e12, step: 1, integer: true });
        numberRow('Position size', 'quantity');

        grid.appendChild(fieldSection('Levels', { variant: 'inputs' }));
        const dir = buildFieldControl({
            kind: 'select',
            options: DIRECTION_OPTIONS,
            value: live().direction,
            fill: false,
            theme: this.theme,
            onChange: (v) => {
                actions.patch({ direction: v });
                refreshAll();
            },
        });
        refreshers.push(() => dir.setValue?.(live().direction));
        grid.appendChild(fieldRow({ label: 'Direction', control: dir.el }));
        numberRow('Entry price', 'entryPrice');
        levelRow('Stop', 'stopPrice', 'stop');
        levelRow('Target', 'targetPrice', 'target');

        grid.appendChild(fieldSection('Display', { variant: 'inputs' }));
        const toggles: Array<[string, 'showText' | 'showHeader' | 'showLossSize' | 'showTargetLabel' | 'showStopLabel' | 'showPrices']> = [
            ['Show text', 'showText'],
            ['Show direction & ratio', 'showHeader'],
            ['Show loss & size', 'showLossSize'],
            ['Show target label', 'showTargetLabel'],
            ['Show stop label', 'showStopLabel'],
            ['Show level prices', 'showPrices'],
        ];
        for (const [label, path] of toggles) {
            grid.appendChild(fieldRow({
                label,
                bool: true,
                toggle: {
                    checked: live()[path],
                    onChange: (v) => {
                        actions.patch({ [path]: v });
                        refreshAll();
                    },
                    get: () => live()[path],
                },
            }));
        }

        const summary = document.createElement('div');
        summary.className = 'vela-field-span';
        summary.style.cssText = 'opacity:0.7;font-size:11px;line-height:1.4;border-top:1px solid var(--vela-border);padding-top:6px;font-variant-numeric:tabular-nums;';
        refreshers.push(() => {
            const d = live();
            summary.textContent = `${d.headerLabel()}  —  ${d.lossSizeLabel()}`;
        });
        grid.appendChild(summary);
        refreshAll();
    }

    private buildFrvp(grid: HTMLElement, drawing: FixedRangeVolumeProfile, actions: SettingsActions): void {
        const styleOf = (): FrvpStyle => {
            const d = actions.resolve();
            return d instanceof FixedRangeVolumeProfile ? d.frvp : drawing.frvp;
        };
        const s = styleOf();

        const numberRow = (label: string, path: keyof FrvpStyle, min: number, max: number, step: number, integer = true): void => {
            grid.appendChild(fieldRow({
                label,
                control: buildFieldControl({
                    kind: 'number',
                    value: s[path] as number,
                    min,
                    max,
                    step,
                    integer,
                    fill: false,
                    commit: 'blur',
                    onChange: (n) => actions.patch({ [`frvp.${path}`]: n }),
                }).el,
            }));
        };
        numberRow('Rows', 'rows', 1, 500, 1);
        numberRow('Value Area', 'valueAreaPct', 0, 100, 1);
        numberRow('Width %', 'widthPct', 0, 100, 1);
        grid.appendChild(fieldRow({
            label: 'Anchor',
            control: buildFieldControl({
                kind: 'select',
                options: FRVP_ANCHOR,
                value: s.anchor,
                fill: false,
                theme: this.theme,
                onChange: (v) => actions.patch({ 'frvp.anchor': v }),
            }).el,
        }));

        const colorRow = (label: string, path: keyof FrvpStyle): void => {
            grid.appendChild(fieldRow({
                label,
                fit: true,
                control: buildFieldControl({
                    kind: 'color',
                    theme: this.theme,
                    get: () => styleOf()[path] as string,
                    onChange: (v) => actions.patch({ [`frvp.${path}`]: v }),
                }).el,
            }));
        };
        colorRow('Up Volume', 'upColor');
        colorRow('Down Volume', 'downColor');
        colorRow('Value Area Up', 'vaUpColor');
        colorRow('Value Area Down', 'vaDownColor');

        const styles = LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
        const levelRow = (label: string, showPath: keyof FrvpStyle, colorPath: keyof FrvpStyle, stylePath: keyof FrvpStyle): void => {
            const row = document.createElement('div');
            row.className = 'vela-field-span';
            row.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const sw = buildFieldControl({
                kind: 'switch',
                checked: Boolean(s[showPath]),
                onChange: (v) => actions.patch({ [`frvp.${showPath}`]: v }),
            });
            const lbl = document.createElement('span');
            lbl.className = 'vela-field-label';
            lbl.style.flex = '1';
            lbl.textContent = label;
            let cur = (s[colorPath] as string | undefined) ?? contrastColor(this.theme.background);
            const col = buildFieldControl({
                kind: 'color',
                theme: this.theme,
                get: () => cur,
                onChange: (v) => {
                    cur = v;
                    actions.patch({ [`frvp.${colorPath}`]: v });
                },
            });
            const style = buildFieldControl({
                kind: 'select',
                options: styles,
                value: s[stylePath] as string,
                fill: false,
                theme: this.theme,
                onChange: (v) => actions.patch({ [`frvp.${stylePath}`]: v }),
            });
            row.append(sw.el, lbl, col.el, style.el);
            grid.appendChild(row);
        };
        levelRow('VAH', 'showVah', 'vahColor', 'vahStyle');
        levelRow('VAL', 'showVal', 'valColor', 'valStyle');
        levelRow('POC', 'showPoc', 'pocColor', 'pocStyle');
        levelRow('Developing POC', 'showDevelopingPoc', 'developingPocColor', 'developingPocStyle');
        levelRow('Developing VA', 'showDevelopingVa', 'developingVaColor', 'developingVaStyle');
    }

    private buildLevels(grid: HTMLElement, drawing: Drawing, actions: SettingsActions): void {
        const levels = drawing.editableLevels();
        if (!levels) return;
        const isMach = drawing instanceof MachFigure;
        if (isMach) {
            const mach = drawing as MachFigure;
            grid.appendChild(fieldRow({
                label: 'Show ratio labels',
                bool: true,
                toggle: {
                    checked: mach.showRatios !== false,
                    onChange: (v) => actions.patch({ showRatios: v }),
                },
            }));
        }
        levels.forEach((lv, i) => {
            const row = document.createElement('div');
            row.className = 'vela-field-span';
            row.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const sw = buildFieldControl({
                kind: 'switch',
                checked: lv.enabled,
                onChange: (v) => actions.patch({ [`levels.${i}.enabled`]: v }),
            });
            let curC = lv.color;
            const col = buildFieldControl({
                kind: 'color',
                theme: this.theme,
                get: () => curC,
                onChange: (v) => {
                    curC = v;
                    actions.patch({ [`levels.${i}.color`]: v });
                },
            });
            let curRatio = lv.ratio;
            const ratio = buildFieldControl({
                kind: 'number',
                value: curRatio,
                min: 0,
                step: 0.01,
                fill: isMach,
                compact: !isMach,
                commit: 'blur',
                onChange: (n) => {
                    if (n <= 0) {
                        ratio.setValue?.(curRatio);
                        return;
                    }
                    curRatio = n;
                    actions.patch({ [`levels.${i}.ratio`]: n });
                },
            });
            if (isMach) ratio.el.style.flex = '1';
            row.append(sw.el, col.el, ratio.el);
            if (!isMach) {
                const label = buildFieldControl({
                    kind: 'text',
                    value: lv.label ?? '',
                    fill: true,
                    placeholder: 'label…',
                    onChange: (v) => actions.patch({ [`levels.${i}.label`]: v }),
                });
                label.el.style.flex = '1';
                label.el.style.minWidth = '60px';
                row.appendChild(label.el);
            }
            grid.appendChild(row);
        });
    }
}

function btn(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = primary ? 'vela-dialog-btn vela-dialog-btn-primary' : 'vela-dialog-btn';
    b.addEventListener('click', onClick);
    return b;
}
