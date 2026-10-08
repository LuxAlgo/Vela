import type { VelaTheme } from '../../../core/options';
import type { FrvpStyle, PositionLevelMode } from '../../../core/drawings';
import { DIRECTION_OPTIONS, FixedRangeVolumeProfile, LINE_STYLE_OPTIONS, PositionTool } from '../../../core/drawings';
import { contrastColor } from '../../shared/drawing-geometry';
import { fieldRow, fieldSection, buildFieldControl } from '../../../ui/components/field';
import type { SelectOption } from '../../../ui/components/select';
import type { SettingsActions } from './DrawingSettingsPopup';

/**
 * The rich, per-type sections of the drawing settings panel — the parts a schema field list
 * can't express (a position's sizing maths, a profile's level lines).
 * Each appends its rows to a field grid and edits through the panel's actions.
 */

const LEVEL_UNITS: readonly SelectOption[] = [
    { value: 'price', label: 'Price' },
    { value: 'points', label: 'Points' },
];
const FRVP_ANCHOR: readonly SelectOption[] = [
    { value: 'right', label: 'Right' },
    { value: 'left', label: 'Left' },
];

/** Position tool: account and risk sizing, the three levels, and which labels show. */
export function buildPositionSection(grid: HTMLElement, drawing: PositionTool, actions: SettingsActions, theme: VelaTheme): void {
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
            theme: theme,
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
        theme: theme,
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

/** Fixed-range volume profile: rows, value area, colors and its level lines. */
export function buildProfileSection(grid: HTMLElement, drawing: FixedRangeVolumeProfile, actions: SettingsActions, theme: VelaTheme): void {
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
            theme: theme,
            onChange: (v) => actions.patch({ 'frvp.anchor': v }),
        }).el,
    }));

    const colorRow = (label: string, path: keyof FrvpStyle): void => {
        grid.appendChild(fieldRow({
            label,
            fit: true,
            control: buildFieldControl({
                kind: 'color',
                theme: theme,
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
        let cur = (s[colorPath] as string | undefined) ?? contrastColor(theme.background);
        const col = buildFieldControl({
            kind: 'color',
            theme: theme,
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
            theme: theme,
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
