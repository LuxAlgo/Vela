import type { VelaTheme } from '../../../core/options';
import { msg } from '../../../core/i18n/message';
import type { MessageLike } from '../../../core/i18n/types';
import type { FrvpStyle, PositionLevelMode } from '../../../core/drawings';
import { DIRECTION_OPTIONS, FixedRangeVolumeProfile, LINE_STYLE_OPTIONS, PositionTool } from '../../../core/drawings';
import { contrastColor } from '../../shared/drawing-geometry';
import { fieldRow, fieldSection, buildFieldControl } from '../../../ui/components/field';
import type { SelectOption } from '../../../ui/components/select';
import type { SettingsActions } from './DrawingSettingsPopup';

const TEXT = {
    account: msg('drawing.section.account', 'Account'),
    riskPct: msg('drawing.section.riskPct', 'Risk %'),
    accountBalance: msg('drawing.section.accountBalance', 'Account balance'),
    positionSize: msg('drawing.section.positionSize', 'Position size'),
    levels: msg('drawing.section.levels', 'Levels'),
    direction: msg('drawing.section.direction', 'Direction'),
    entryPrice: msg('drawing.section.entryPrice', 'Entry price'),
    stop: msg('drawing.section.stop', 'Stop'),
    target: msg('drawing.section.target', 'Target'),
    display: msg('drawing.section.display', 'Display'),
    showText: msg('drawing.section.showText', 'Show text'),
    showDirectionAndRatio: msg('drawing.section.showDirectionAndRatio', 'Show direction & ratio'),
    showLossAndSize: msg('drawing.section.showLossAndSize', 'Show loss & size'),
    showTargetLabel: msg('drawing.section.showTargetLabel', 'Show target label'),
    showStopLabel: msg('drawing.section.showStopLabel', 'Show stop label'),
    showLevelPrices: msg('drawing.section.showLevelPrices', 'Show level prices'),
    rows: msg('drawing.section.rows', 'Rows'),
    valueArea: msg('drawing.section.valueArea', 'Value Area'),
    widthPct: msg('drawing.section.widthPct', 'Width %'),
    anchor: msg('drawing.section.anchor', 'Anchor'),
    upVolume: msg('drawing.section.upVolume', 'Up Volume'),
    downVolume: msg('drawing.section.downVolume', 'Down Volume'),
    valueAreaUp: msg('drawing.section.valueAreaUp', 'Value Area Up'),
    valueAreaDown: msg('drawing.section.valueAreaDown', 'Value Area Down'),
    vah: msg('drawing.section.vah', 'VAH'),
    val: msg('drawing.section.val', 'VAL'),
    poc: msg('drawing.section.poc', 'POC'),
    developingPOC: msg('drawing.section.developingPOC', 'Developing POC'),
    developingVA: msg('drawing.section.developingVA', 'Developing VA'),
};


/**
 * The rich, per-type sections of the drawing settings panel — the parts a schema field list
 * can't express (a position's sizing maths, a profile's level lines).
 * Each appends its rows to a field grid and edits through the panel's actions.
 */

/** Resolves display text in the chart's language. */
export type SectionText = (m: MessageLike, values?: Record<string, string | number>) => string;

const LEVEL_UNITS: ReadonlyArray<{ value: string; label: MessageLike }> = [
    { value: 'price', label: msg('drawing.position.unit.price', 'Price') },
    { value: 'points', label: msg('drawing.position.unit.points', 'Points') },
];
const FRVP_ANCHOR: ReadonlyArray<{ value: string; label: MessageLike }> = [
    { value: 'right', label: msg('drawing.fixedrangevp.anchor.right', 'Right') },
    { value: 'left', label: msg('drawing.fixedrangevp.anchor.left', 'Left') },
];

/** Options with their labels in the chart's language. */
function choices(options: ReadonlyArray<{ value: string; label: MessageLike }>, t: SectionText): SelectOption[] {
    return options.map((o) => ({ value: o.value, label: t(o.label) }));
}

/** Position tool: account and risk sizing, the three levels, and which labels show. */
export function buildPositionSection(grid: HTMLElement, drawing: PositionTool, actions: SettingsActions, theme: VelaTheme, t: SectionText): void {
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
            options: choices(LEVEL_UNITS, t),
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

    grid.appendChild(fieldSection(t(TEXT.account), { variant: 'inputs', first: true }));
    numberRow(t(TEXT.riskPct), 'riskPercent', { min: 0, max: 100, step: 0.1 });
    numberRow(t(TEXT.accountBalance), 'accountBalance', { min: 0, max: 1e12, step: 1, integer: true });
    numberRow(t(TEXT.positionSize), 'quantity');

    grid.appendChild(fieldSection(t(TEXT.levels), { variant: 'inputs' }));
    const dir = buildFieldControl({
        kind: 'select',
        options: choices(DIRECTION_OPTIONS, t),
        value: live().direction,
        fill: false,
        theme: theme,
        onChange: (v) => {
            actions.patch({ direction: v });
            refreshAll();
        },
    });
    refreshers.push(() => dir.setValue?.(live().direction));
    grid.appendChild(fieldRow({ label: t(TEXT.direction), control: dir.el }));
    numberRow(t(TEXT.entryPrice), 'entryPrice');
    levelRow(t(TEXT.stop), 'stopPrice', 'stop');
    levelRow(t(TEXT.target), 'targetPrice', 'target');

    grid.appendChild(fieldSection(t(TEXT.display), { variant: 'inputs' }));
    const toggles: Array<[string, 'showText' | 'showHeader' | 'showLossSize' | 'showTargetLabel' | 'showStopLabel' | 'showPrices']> = [
        [t(TEXT.showText), 'showText'],
        [t(TEXT.showDirectionAndRatio), 'showHeader'],
        [t(TEXT.showLossAndSize), 'showLossSize'],
        [t(TEXT.showTargetLabel), 'showTargetLabel'],
        [t(TEXT.showStopLabel), 'showStopLabel'],
        [t(TEXT.showLevelPrices), 'showPrices'],
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
    summary.dataset.slot = 'field-span';
    summary.style.cssText = 'opacity:0.7;font-size:11px;line-height:1.4;border-top:1px solid var(--vela-border);padding-top:6px;font-variant-numeric:tabular-nums;';
    refreshers.push(() => {
        const d = live();
        summary.textContent = `${d.headerLabel()}  —  ${d.lossSizeLabel()}`;
    });
    grid.appendChild(summary);
    refreshAll();
}

/** Fixed-range volume profile: rows, value area, colors and its level lines. */
export function buildProfileSection(grid: HTMLElement, drawing: FixedRangeVolumeProfile, actions: SettingsActions, theme: VelaTheme, t: SectionText): void {
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
    numberRow(t(TEXT.rows), 'rows', 1, 500, 1);
    numberRow(t(TEXT.valueArea), 'valueAreaPct', 0, 100, 1);
    numberRow(t(TEXT.widthPct), 'widthPct', 0, 100, 1);
    grid.appendChild(fieldRow({
        label: t(TEXT.anchor),
        control: buildFieldControl({
            kind: 'select',
            options: choices(FRVP_ANCHOR, t),
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
    colorRow(t(TEXT.upVolume), 'upColor');
    colorRow(t(TEXT.downVolume), 'downColor');
    colorRow(t(TEXT.valueAreaUp), 'vaUpColor');
    colorRow(t(TEXT.valueAreaDown), 'vaDownColor');

    const styles = choices(LINE_STYLE_OPTIONS, t);
    const levelRow = (label: string, showPath: keyof FrvpStyle, colorPath: keyof FrvpStyle, stylePath: keyof FrvpStyle): void => {
        const row = document.createElement('div');
        row.className = 'vela-field-span';
        row.dataset.slot = 'field-span';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;';
        const sw = buildFieldControl({
            kind: 'switch',
            checked: Boolean(s[showPath]),
            onChange: (v) => actions.patch({ [`frvp.${showPath}`]: v }),
        });
        const lbl = document.createElement('span');
        lbl.className = 'vela-field-label';
        lbl.dataset.slot = 'field-label';
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
    levelRow(t(TEXT.vah), 'showVah', 'vahColor', 'vahStyle');
    levelRow(t(TEXT.val), 'showVal', 'valColor', 'valStyle');
    levelRow(t(TEXT.poc), 'showPoc', 'pocColor', 'pocStyle');
    levelRow(t(TEXT.developingPOC), 'showDevelopingPoc', 'developingPocColor', 'developingPocStyle');
    levelRow(t(TEXT.developingVA), 'showDevelopingVa', 'developingVaColor', 'developingVaStyle');
}
