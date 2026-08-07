import type { VelaTheme, ThemeName } from '../../../core/options';
import type { ChartConfig } from '../core/chartConfig';
import {
    chartType,
    chartTypes,
    settingsRowVisible,
    type ChartTypeSettingsInstance,
    type ChartTypeSettingsSection,
    type SettingsRowDescriptor,
    type SettingsRowWhen,
    type SettingsSelectOption,
} from '../../../chart-types/registry';
import { toHex6, withAlpha } from '../../../core/color';
import { iconAt } from '../../../core/icons';
import { TIMEZONES, tzMenuLabel, normalizeTimezone } from '../../../core/timezones';
import { colorField, closeColorPopover } from './ColorField';
import { widthField, closeWidthPopover } from './WidthField';
import { priceStyleIds, hasOwnCandlePaint } from '../core/chartConfig';

/** A nested partial of `ChartConfig` — what a single control edit emits. */
type ConfigPatch = Record<string, unknown>;

/**
 * The native renderer's chart-settings dialog (item 15): a DOM overlay, opened from
 * an in-chart gear, that edits a curated slice of the serializable `ChartConfig`
 * (background, candle/grid/crosshair colors, fonts, price scale, timezone, …). Each
 * control emits a minimal nested patch via `onChange`; the renderer merges it onto
 * the live config and repaints with NO indicator re-run. A footer exposes the whole
 * config as JSON for export/import — the templating surface.
 *
 * It is renderer chrome (a positioned overlay on the chart container), kept
 * dependency-free and themed to match the chart, mirroring `InputsUI`.
 */

/** A host-contributed settings row: callback-based (the host owns the state).
 *  `heading` opens a titled group inside the tab (an in-pane section title). */
export type HostSettingsRow =
    | { kind: 'heading'; label: string }
    | { kind: 'toggle'; label: string; get: () => boolean; set: (v: boolean) => void }
    | { kind: 'select'; label: string; options: readonly string[]; get: () => string; set: (v: string) => void };

/** A host-contributed settings tab (see `RendererControl.setSettingsSections`). */
export interface HostSettingsSection {
    title: string;
    rows: readonly HostSettingsRow[];
    /** Tab position: own tab after Symbol (default), end of the rail, or rows INSIDE
     *  the Symbol tab itself (`'symbol'` — e.g. the widget's watermark toggle). */
    placement?: 'after-symbol' | 'end' | 'symbol';
}

const BUILTIN_STYLE_LABELS: Record<string, string> = {
    candles: 'Candles',
    bars: 'Bars',
    line: 'Line',
    area: 'Area',
    baseline: 'Baseline',
};

/** Display label for a price style: registry label, built-in name, else the raw id. */
function styleLabel(id: string): string {
    return chartType(id)?.label ?? BUILTIN_STYLE_LABELS[id] ?? id;
}

const SD_STYLE_ID = 'vela-settings-controls';

/**
 * The dialog's surface palette. It follows the STABLE chrome surface (the tokens written on
 * the chart container), not the live plot background: recoloring the plot must not repaint
 * the dialog, but switching the app between dark and light must.
 */
export const SETTINGS_SURFACE = 'var(--vela-surface)';
export const SETTINGS_BORDER = 'var(--vela-border)';
export const SETTINGS_TEXT = 'var(--vela-fg)';

/** The reference control styles (checkbox, selects/inputs, swatches, scrollbars). */
function ensureControlStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(SD_STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = SD_STYLE_ID;
    st.textContent = `
.vela-sd-check{width:18px;height:18px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--vela-border-strong);border-radius:5px;background:transparent;color:transparent;cursor:pointer;}
.vela-sd-check:hover{border-color:var(--vela-fg-muted);}
.vela-sd-check.on{background:var(--vela-selected-bg);border-color:var(--vela-selected-bg);color:var(--vela-selected-fg);}
.vela-sd-check svg{display:block;}
.vela-sd-select,.vela-sd-number{height:28px;background:var(--vela-surface-elev);border:1px solid var(--vela-border-strong);border-radius:var(--vela-radius-sm);color:var(--vela-fg);padding:0 8px;font-size:13px;outline:none;font-family:inherit;}
.vela-sd-select:hover,.vela-sd-number:hover{border-color:var(--vela-fg-muted);}
/* Custom caret: the native one hugs the right border; ours gets 8px of air. (A data URI
   can't read currentColor, so it uses the shared muted-gray ink, legible on both themes.) */
.vela-sd-select{-webkit-appearance:none;appearance:none;padding-right:26px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' fill='none' stroke='%23868a96' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;}
.vela-sd-number{width:64px;}
.vela-sd-color{width:32px;height:26px;padding:0;border:1px solid var(--vela-border);border-radius:var(--vela-radius-sm);background:transparent;cursor:pointer;-webkit-appearance:none;appearance:none;}
.vela-sd-color::-webkit-color-swatch-wrapper{padding:2px;}
.vela-sd-color::-webkit-color-swatch{border:none;border-radius:2px;}
.vela-sd-pane::-webkit-scrollbar{width:8px;}
.vela-sd-pane::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:var(--vela-radius-sm);border:2px solid transparent;background-clip:padding-box;}
.vela-sd-pane::-webkit-scrollbar-track{background:transparent;}
.vela-sd-toggle{position:relative;width:38px;height:22px;border-radius:11px;background:var(--vela-surface-sunken);border:1px solid var(--vela-border);cursor:pointer;flex:none;padding:0;}
.vela-sd-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--vela-fg-muted);transition:transform var(--vela-dur-med) ease,background var(--vela-dur-med) ease;}
.vela-sd-toggle.on{background:var(--vela-active);border-color:var(--vela-selected-bg);}
.vela-sd-toggle.on::after{transform:translateX(16px);background:var(--vela-selected-bg);}
/* Tab rail / footer button / header close: base styles live HERE, not inline on the
   elements — inline declarations always beat stylesheet :hover rules, which is exactly
   what killed these hovers before. Active tab state is the .on class (like .vela-sd-check),
   hover fills follow the app convention (--vela-hover + --vela-fg-bright, fast transition). */
.vela-sd-tab{text-align:left;padding:9px 12px;background:transparent;border:none;border-radius:var(--vela-radius-md);color:var(--vela-fg-muted);font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-sd-tab:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-sd-tab.on{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-sd-btn{height:30px;padding:0 14px;font-size:var(--vela-font-size-md);color:var(--vela-fg);background:var(--vela-surface-sunken);border:1px solid var(--vela-border);border-radius:var(--vela-radius-md);cursor:pointer;font-family:inherit;transition:background var(--vela-dur-fast) ease,border-color var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-sd-btn:hover{background:var(--vela-hover);border-color:var(--vela-border-strong);color:var(--vela-fg-bright);}
.vela-sd-close{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--vela-fg-muted);line-height:0;width:30px;height:30px;border-radius:var(--vela-radius-sm);transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-sd-close:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
/* Rows/blocks gated away by chart-type conditions, TOC filters, or the instance strip.
   !important: the pane grid rewrites inline display ('contents') AFTER the initial
   visibility pass, so a class must win. */
.vela-sd-hide{display:none !important;}
/* Indented rail sub-entry (a chart-type section's subsection tab). */
.vela-sd-tab-sub{padding-left:28px;font-weight:600;font-size:12px;}
/* Instance strip: a tab per present instance (label, ✕ on the active removable one)
   and a dashed + that turns on the next absent instance. The rule under it separates
   the strip from the instance's TOC + rows area. */
.vela-sd-itabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:14px 0 0;padding-bottom:12px;border-bottom:1px solid var(--vela-border);}
.vela-sd-itab{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 11px;background:transparent;border:1px solid var(--vela-border);border-radius:var(--vela-radius-md);color:var(--vela-fg-muted);font-family:inherit;font-size:var(--vela-font-size-md);font-weight:600;cursor:pointer;transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease,border-color var(--vela-dur-fast) ease;}
.vela-sd-itab:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-sd-itab.on{background:var(--vela-active);color:var(--vela-fg-bright);border-color:var(--vela-border-strong);}
.vela-sd-ix{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:-4px;border-radius:var(--vela-radius-sm);color:var(--vela-fg-muted);font-size:10px;line-height:1;}
.vela-sd-ix:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-sd-itab-add{border-style:dashed;min-width:30px;justify-content:center;padding:0;}
/* Structured pane: group TOC column + rows column, TOP-ALIGNED (the shared padding-top
   lives on the wrap, never on one column). The TOC sticks while the pane scrolls; the
   vertical rule sits on the rows column so it spans the full content height. When every
   group gates out the TOC hides and .no-toc drops the rule with it. */
.vela-sd-struct{display:flex;align-items:flex-start;padding-top:14px;}
.vela-sd-toc{position:sticky;top:0;flex:0 0 auto;min-width:104px;display:flex;flex-direction:column;gap:2px;padding:2px 14px 0 0;}
.vela-sd-struct>[data-sd-rows-host]{border-left:1px solid var(--vela-border);padding-left:18px;}
.vela-sd-struct.no-toc>[data-sd-rows-host]{border-left:none;padding-left:0;}
.vela-sd-toc-btn{text-align:left;padding:6px 10px;background:transparent;border:none;border-radius:var(--vela-radius-sm);color:var(--vela-fg-muted);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-sd-toc-btn:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-sd-toc-btn.on{background:var(--vela-active);color:var(--vela-fg-bright);}
/* Soft-disable: a subsection's enableKey is off — rows stay visible (browseable) but
   muted and non-interactive. Applied to each row's children so it survives display:contents;
   !important beats the inline opacity on labels. */
.vela-sd-soft>*{opacity:0.4 !important;pointer-events:none !important;}
`;
    document.head.appendChild(st);
}

export class SettingsDialog {
    private root: HTMLDivElement | null = null;
    private onChange: ((patch: ConfigPatch) => void) | null = null;
    private onImport: ((json: unknown) => void) | null = null;
    private onReset: (() => void) | null = null;
    private config: ChartConfig | null = null;
    private syncTypeTabs: ((style: string) => void) | null = null;
    private hostSections: HostSettingsSection[] = [];
    /** The Canvas → Theme row: current app theme + where a pick is raised. The row is a
     *  host callback, NOT a config patch — the app theme stays out of the persisted
     *  `ChartConfig`, so exported templates never carry it. */
    private themeControl: { current: ThemeName; onSelect: (name: ThemeName) => void } | null = null;
    /** The built tabs, by title — how `showSection` reaches a pane while the dialog is open. */
    private tabs: Array<{ title: string; show: () => void }> = [];
    /** Active instance-strip tab per chart type — remembered across dialog rebuilds. */
    private readonly typeActiveInstance = new Map<string, number>();
    /** Active TOC group per structured pane (`<typeId>/<pane>` → group label). */
    private readonly typeActiveGroup = new Map<string, string>();
    /** The tab currently shown, so a theme change (which rebuilds) lands back on it. */
    private activeSection: string | null = null;

    /** Host-app sections (e.g. the widget's Status line tab) — re-shown on next open. */
    setHostSections(sections: HostSettingsSection[]): void {
        this.hostSections = sections;
    }

    /** Configure the Canvas → Theme row (see {@link themeControl}); null hides the row. */
    setThemeControl(current: ThemeName, onSelect: (name: ThemeName) => void): void {
        this.themeControl = { current, onSelect };
    }

    /** Refresh the stored config snapshot — a theme swap re-bases layout values while the
     *  dialog is open, and the rebuilt controls must show the live ones, not the open-time
     *  snapshot. */
    refreshConfig(config: ChartConfig): void {
        if (this.config) this.config = config;
    }

    constructor(
        private readonly container: HTMLElement,
        private theme: VelaTheme,
    ) {
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        if (this.root) {
            const cfg = this.config;
            const oc = this.onChange;
            const oi = this.onImport;
            const orst = this.onReset;
            const section = this.activeSection;
            this.close();
            if (cfg && oc) this.open(cfg, oc, oi ?? undefined, orst ?? undefined, section ?? undefined);
        }
    }

    isOpen(): boolean {
        return this.root !== null;
    }

    /** Toggle the dialog; `config` is the current resolved config to seed controls.
     *  `section` selects the tab to land on (a tab title; unknown ones fall back to the first). */
    toggle(config: ChartConfig, onChange: (patch: ConfigPatch) => void, onImport?: (json: unknown) => void, onReset?: () => void, section?: string): void {
        if (this.root) this.close();
        else this.open(config, onChange, onImport, onReset, section);
    }

    /** Switch an already-open dialog to a tab by title — no-op when closed or unknown. */
    showSection(section: string): void {
        this.tabs.find((t) => t.title.toLowerCase() === section.toLowerCase())?.show();
    }

    open(config: ChartConfig, onChange: (patch: ConfigPatch) => void, onImport?: (json: unknown) => void, onReset?: () => void, section?: string): void {
        this.close();
        this.config = config;
        this.onChange = onChange;
        this.onImport = onImport ?? null;
        this.onReset = onReset ?? null;

        // Scrim + centered box — the reference settings-dialog shell (top-aligned modal,
        // left tab rail, scrollable pane, footer). Section markers emitted by `section()`
        // are post-processed into tabs below. The scrim stays TRANSPARENT: the chart must
        // remain fully readable while its settings are edited live; the scrim only exists
        // to catch the click-outside-to-close.
        ensureControlStyles();
        const scrim = document.createElement('div');
        scrim.style.cssText = 'position:absolute;inset:0;z-index:21;display:flex;align-items:flex-start;justify-content:center;background:transparent;padding-top:8vh;pointer-events:auto;';
        scrim.addEventListener('mousedown', (e) => {
            if (e.target === scrim) this.close();
        });

        const dlg = document.createElement('div');
        // `cursor:default` shields the dialog from the plot's crosshair cursor; interactive
        // controls re-declare their own.
        // Shrink-to-fit width (mirrors the indicator dialog's `w-fit` card): the box is only
        // as wide as the rail + widest visible pane content needs, between a floor that keeps
        // sparse tabs from looking cramped and the old 720px cap.
        dlg.style.cssText = `width:fit-content;min-width:min(560px,94vw);max-width:min(720px,94vw);max-height:70vh;display:flex;flex-direction:column;background:${SETTINGS_SURFACE};border:1px solid ${SETTINGS_BORDER};border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow-dialog);color:${SETTINGS_TEXT};font:13px var(--vela-font);overflow:hidden;cursor:default;`;

        const header = document.createElement('div');
        header.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:9px 9px 9px 16px;border-bottom:1px solid ${SETTINGS_BORDER};flex:0 0 auto;user-select:none;`;
        const hTitle = document.createElement('span');
        hTitle.textContent = 'Chart settings';
        hTitle.style.cssText = 'font-size:17px;font-weight:600;letter-spacing:0.2px;';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.innerHTML = iconAt('close', 15);
        closeBtn.title = 'Close';
        closeBtn.className = 'vela-sd-close';
        closeBtn.addEventListener('click', () => this.close());
        header.append(hTitle, closeBtn);
        header.style.cursor = 'move';
        {
            let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
            header.addEventListener('pointerdown', (e) => {
                // ANCESTRY, not identity: the button holds an SVG icon, so a press on the ✕
                // targets the `<path>`. Comparing against the button itself let the header
                // take pointer capture, which retargets the click away — the button was dead
                // everywhere except its few pixels of padding.
                if ((e.target as Element | null)?.closest('.vela-sd-close')) return;
                dragging = true;
                sx = e.clientX - ox;
                sy = e.clientY - oy;
                header.setPointerCapture(e.pointerId);
            });
            header.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                ox = e.clientX - sx;
                oy = e.clientY - sy;
                dlg.style.transform = `translate(${ox}px, ${oy}px)`;
            });
            header.addEventListener('pointerup', () => (dragging = false));
        }
        dlg.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:0;';

        // ══ SYMBOL — chart type + per-style cosmetics + time zone (the reference tab) ══
        body.append(this.section('Symbol'));
        body.append(this.sectionTitle('Chart type'));
        const groups: Partial<Record<string, HTMLElement>> = {};
        const showActive = (style: string): void => {
            const active = style === 'heikinashi' ? 'candles' : style; // heikin-ashi is candle-drawn
            for (const key of priceStyleIds()) {
                const el = groups[key];
                if (el) el.style.display = key === active ? 'contents' : 'none';
            }
        };
        body.append(
            this.selectRowLabeled('Type', config.series.style, priceStyleIds().map((id) => [id, styleLabel(id)] as const), (v) => {
                this.emit({ series: { style: v } });
                showActive(v);
                this.syncTypeTabs?.(v);
            }),
        );

        // Candles — the reference compact rows: one toggle + an up/down swatch pair each.
        const candles = this.group();
        candles.append(this.sectionTitle('Candles'));
        candles.append(this.toggleRow('Body', config.candles.bodyVisible, (v) => this.emit({ candles: { bodyVisible: v } }), [
            this.swatch(config.candles.upColor, (v) => this.emit({ candles: { upColor: v } })),
            this.swatch(config.candles.downColor, (v) => this.emit({ candles: { downColor: v } })),
        ]));
        candles.append(this.toggleRow('Borders', config.candles.borderVisible, (v) => this.emit({ candles: { borderVisible: v } }), [
            this.swatch(config.candles.borderUpColor, (v) => this.emit({ candles: { borderUpColor: v } })),
            this.swatch(config.candles.borderDownColor, (v) => this.emit({ candles: { borderDownColor: v } })),
        ]));
        candles.append(this.toggleRow('Wick', config.candles.wickVisible, (v) => this.emit({ candles: { wickVisible: v } }), [
            this.swatch(config.candles.wickUpColor, (v) => this.emit({ candles: { wickUpColor: v } })),
            this.swatch(config.candles.wickDownColor, (v) => this.emit({ candles: { wickDownColor: v } })),
        ]));
        candles.append(this.numberRow('Spacing', config.series.spacing, 0.1, 10, 0.1, (v) => this.emit({ series: { spacing: v } })));
        groups.candles = candles;
        body.append(candles);

        const bars = this.group();
        bars.append(this.sectionTitle('Bars'));
        bars.append(this.colorRow('Color Up', config.bars.upColor, (v) => this.emit({ bars: { upColor: v } })));
        bars.append(this.colorRow('Color Down', config.bars.downColor, (v) => this.emit({ bars: { downColor: v } })));
        bars.append(this.numberRow('Spacing', config.series.spacing, 0.1, 10, 0.1, (v) => this.emit({ series: { spacing: v } })));
        groups.bars = bars;
        body.append(bars);

        const line = this.group();
        line.append(this.sectionTitle('Line'));
        line.append(this.colorRow('Color', config.line.color, (v) => this.emit({ line: { color: v } })));
        line.append(this.numberRow('Width', config.line.width, 1, 10, 1, (v) => this.emit({ line: { width: v } })));
        groups.line = line;
        body.append(line);

        const area = this.group();
        area.append(this.sectionTitle('Area'));
        area.append(this.colorRow('Line color', config.area.lineColor, (v) => this.emit({ area: { lineColor: v } })));
        area.append(this.numberRow('Width', config.area.width, 1, 10, 1, (v) => this.emit({ area: { width: v } })));
        area.append(this.colorRow('Top fill', config.area.topColor, (v) => this.emit({ area: { topColor: v } })));
        area.append(this.colorRow('Bottom fill', config.area.bottomColor, (v) => this.emit({ area: { bottomColor: v } })));
        groups.area = area;
        body.append(area);

        const baseline = this.group();
        baseline.append(this.sectionTitle('Baseline'));
        baseline.append(this.rowWith('Top line', [this.swatch(config.baseline.topLineColor, (v) => this.emit({ baseline: { topLineColor: v } }))]));
        baseline.append(this.rowWith('Bottom line', [this.swatch(config.baseline.bottomLineColor, (v) => this.emit({ baseline: { bottomLineColor: v } }))]));
        baseline.append(this.rowWith('Fill top area', [
            this.swatch(config.baseline.topFillColor, (v) => this.emit({ baseline: { topFillColor: v } })),
            this.swatch(config.baseline.topFillColor2, (v) => this.emit({ baseline: { topFillColor2: v } })),
        ]));
        baseline.append(this.rowWith('Fill bottom area', [
            this.swatch(config.baseline.bottomFillColor2, (v) => this.emit({ baseline: { bottomFillColor2: v } })),
            this.swatch(config.baseline.bottomFillColor, (v) => this.emit({ baseline: { bottomFillColor: v } })),
        ]));
        baseline.append(this.numberRow('Base level %', config.baseline.baselineLevel, 0, 100, 1, (v) => this.emit({ baseline: { baselineLevel: v } })));
        baseline.append(this.numberRow('Width', config.baseline.width, 1, 10, 1, (v) => this.emit({ baseline: { width: v } })));
        groups.baseline = baseline;
        body.append(baseline);

        // Candle-based PLUGIN styles (an order-flow type keeps candles under its layer):
        // the same candle rows, but stored in the type's OWN bag (chartTypes.<id>.candle*)
        // so edits style THAT type's candles without touching the shared candles block the
        // candles/heikin-ashi styles paint with. Unset keys inherit the shared values.
        for (const def of chartTypes()) {
            if (!hasOwnCandlePaint(def.id)) continue;
            const bag = config.chartTypes[def.id] ?? {};
            const colorOf = (key: string, shared: string): string => (typeof bag[key] === 'string' && bag[key] !== '' ? bag[key] as string : shared);
            const boolOf = (key: string, shared: boolean): boolean => (typeof bag[key] === 'boolean' ? bag[key] as boolean : shared);
            const g = this.group();
            g.append(this.sectionTitle('Candles'));
            g.append(this.toggleRow('Body', boolOf('candleBodyVisible', config.candles.bodyVisible), (v) => this.emitType(def.id, 'candleBodyVisible', v), [
                this.swatch(colorOf('candleUpColor', config.candles.upColor), (v) => this.emitType(def.id, 'candleUpColor', v)),
                this.swatch(colorOf('candleDownColor', config.candles.downColor), (v) => this.emitType(def.id, 'candleDownColor', v)),
            ]));
            g.append(this.toggleRow('Borders', boolOf('candleBorderVisible', config.candles.borderVisible), (v) => this.emitType(def.id, 'candleBorderVisible', v), [
                this.swatch(colorOf('candleBorderUpColor', config.candles.borderUpColor), (v) => this.emitType(def.id, 'candleBorderUpColor', v)),
                this.swatch(colorOf('candleBorderDownColor', config.candles.borderDownColor), (v) => this.emitType(def.id, 'candleBorderDownColor', v)),
            ]));
            g.append(this.toggleRow('Wick', boolOf('candleWickVisible', config.candles.wickVisible), (v) => this.emitType(def.id, 'candleWickVisible', v), [
                this.swatch(colorOf('candleWickUpColor', config.candles.wickUpColor), (v) => this.emitType(def.id, 'candleWickUpColor', v)),
                this.swatch(colorOf('candleWickDownColor', config.candles.wickDownColor), (v) => this.emitType(def.id, 'candleWickDownColor', v)),
            ]));
            g.append(this.numberRow('Spacing', config.series.spacing, 0.1, 10, 0.1, (v) => this.emit({ series: { spacing: v } })));
            groups[def.id] = g;
            body.append(g);
        }
        showActive(config.series.style);

        body.append(this.sectionTitle('Time zone'));
        body.append(this.selectRowLabeled('Time zone', normalizeTimezone(config.timeScale.timezone), timezoneOptions(config.timeScale.timezone), (v) => this.emit({ timeScale: { timezone: v } })));

        // ══ HOST SECTIONS — tabs contributed by the embedding app (widget Status line…) ══
        const renderHostSections = (placement: 'after-symbol' | 'end' | 'symbol'): void => {
            for (const hs of this.hostSections) {
                if ((hs.placement ?? 'after-symbol') !== placement) continue;
                // 'symbol' inlines rows into the CURRENT pane (a section title, no tab).
                body.append(placement === 'symbol' ? this.sectionTitle(hs.title) : this.section(hs.title));
                for (const hr of hs.rows) {
                    if (hr.kind === 'heading') body.append(this.sectionTitle(hr.label));
                    else if (hr.kind === 'toggle') body.append(this.boolRow(hr.label, hr.get(), (v) => hr.set(v)));
                    else body.append(this.selectRowLabeled(hr.label, hr.get() as string, hr.options.map((o) => [o, o] as const), (v) => hr.set(v)));
                }
            }
        };
        // ══ CHART-TYPE SDK SECTIONS — each registered type's declarative settings tab.
        //    visibility 'active' (default) shows the tab only while the style is active;
        //    'always' keeps it visible. Values persist under config.chartTypes[<id>] and
        //    are pushed to the `<id>-settings` channel by the renderer's applyConfig.
        //    placement 'after-symbol' puts the tab (and its subsections) right under
        //    Symbol; 'end' (default) keeps the historical position after the built-ins.
        const renderChartTypeSections = (placement: 'after-symbol' | 'end'): void => {
            for (const def of chartTypes()) {
                const typeSettings = def.settings;
                if (!typeSettings) continue;
                if ((typeSettings.placement ?? 'end') !== placement) continue;
                this.chartTypeSection(def.id, typeSettings, config, body);
            }
        };

        // 'symbol' rows FIRST — they must land before any host TAB marker, or the
        // split walker files them into that tab's pane instead of Symbol's.
        // Chart-type 'after-symbol' tabs precede host ones: an active style's own tab
        // sits DIRECTLY under Symbol.
        renderHostSections('symbol');
        renderChartTypeSections('after-symbol');
        renderHostSections('after-symbol');

        // ══ SCALES AND LINES — price scale + crosshair (the reference tab) ══
        body.append(this.section('Scales and lines'));
        body.append(this.sectionTitle('Price scale'));
        body.append(
            this.selectRowLabeled(
                'Mode',
                config.priceScale.log ? 'log' : config.priceScale.mode,
                [['price', 'Regular'], ['percent', 'Percent'], ['indexed', 'Indexed to 100'], ['log', 'Logarithmic']] as const,
                (v) => this.emit({ priceScale: v === 'log' ? { mode: 'price', log: true } : { mode: v, log: false } }),
            ),
        );
        body.append(this.boolRow('Invert scale', config.priceScale.invert, (v) => this.emit({ priceScale: { invert: v } })));
        body.append(this.separator());
        body.append(this.boolRow('Last Price Line', config.priceScale.currentPriceLine, (v) => this.emit({ priceScale: { currentPriceLine: v } })));
        body.append(this.boolRow('Last price label', config.priceScale.priceLabel, (v) => this.emit({ priceScale: { priceLabel: v } })));
        body.append(this.boolRow('Countdown to bar close', config.priceScale.countdown, (v) => this.emit({ priceScale: { countdown: v } })));
        body.append(this.boolRow('Axis labels', config.priceScale.labelsVisible, (v) => this.emit({ priceScale: { labelsVisible: v } })));
        body.append(this.colorRow('Scale border color', config.priceScale.borderColor, (v) => this.emit({ priceScale: { borderColor: v } })));
        body.append(this.sectionTitle('Crosshair'));
        body.append(this.colorRow('Color', config.crosshair.color, (v) => this.emit({ crosshair: { color: v } })));
        body.append(this.numberRow('Width', config.crosshair.width, 0.5, 8, 0.5, (v) => this.emit({ crosshair: { width: v } })));
        body.append(this.selectRowLabeled('Style', config.crosshair.style, [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] as const, (v) => this.emit({ crosshair: { style: v } })));

        // ══ CANVAS — background/text + grid (the reference tab) ══
        body.append(this.section('Canvas'));
        body.append(this.sectionTitle('Background & text'));
        body.append(this.colorRow('Background', config.layout.background, (v) => this.emit({ layout: { background: v } })));
        body.append(this.colorRow('Text color', config.layout.textColor, (v) => this.emit({ layout: { textColor: v } })));
        body.append(this.numberRow('Text size', config.layout.fontSize, 6, 32, 1, (v) => this.emit({ layout: { fontSize: v } })));
        body.append(this.colorRow('Pane separator color', config.panes.separatorColor, (v) => this.emit({ panes: { separatorColor: v } })));
        body.append(this.sectionTitle('Grid'));
        body.append(this.toggleRow('Vertical', config.grid.vertLines.visible, (v) => this.emit({ grid: { vertLines: { visible: v } } }), [
            this.swatch(config.grid.vertLines.color, (v) => this.emit({ grid: { vertLines: { color: v } } })),
        ]));
        body.append(this.toggleRow('Horizontal', config.grid.horzLines.visible, (v) => this.emit({ grid: { horzLines: { visible: v } } }), [
            this.swatch(config.grid.horzLines.color, (v) => this.emit({ grid: { horzLines: { color: v } } })),
        ]));
        if (this.themeControl) {
            const tc = this.themeControl;
            body.append(this.sectionTitle('Theme'));
            body.append(this.selectRow('Color theme', tc.current === 'dark' ? 'Dark' : 'Light', ['Dark', 'Light'], (v) => tc.onSelect(v === 'Dark' ? 'dark' : 'light')));
        }

        renderChartTypeSections('end');

        renderHostSections('end');

        // ── Split the linear sections into a left tab rail + one pane per section ──
        const shell = document.createElement('div');
        shell.style.cssText = 'display:flex;min-height:360px;max-height:calc(70vh - 100px);flex:1 1 auto;';
        const rail = document.createElement('div');
        rail.style.cssText = `flex:0 0 170px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid ${SETTINGS_BORDER};overflow-y:auto;`;
        const paneHost = document.createElement('div');
        paneHost.className = 'vela-sd-pane';
        paneHost.style.cssText = 'flex:1;overflow-y:auto;padding:6px 18px 14px;';

        const panes: Array<{ title: string; el: HTMLElement; tab: HTMLButtonElement; style?: string; visibility?: string }> = [];
        let current: HTMLElement | null = null;
        for (const child of [...body.children] as HTMLElement[]) {
            const title = child.dataset.sdTab;
            if (title !== undefined) {
                const el = document.createElement('div');
                el.style.display = 'none';
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.textContent = title;
                tab.className = 'vela-sd-tab' + (child.dataset.sdSub !== undefined ? ' vela-sd-tab-sub' : '');
                panes.push({ title, el, tab, style: child.dataset.sdStyle, visibility: child.dataset.sdVisibility });
                current = el;
                child.remove();
                continue;
            }
            if (current) current.appendChild(child);
        }
        // Chart-type tabs with visibility 'active' follow the Type select live.
        this.syncTypeTabs = (active: string): void => {
            let hidActive = false;
            panes.forEach((pn, idx) => {
                if (!pn.style) return;
                const show = pn.visibility === 'always' || pn.style === active || (active === 'heikinashi' && pn.style === 'heikinashi');
                pn.tab.style.display = show ? '' : 'none';
                if (!show && pn.el.style.display === 'block') hidActive = true;
                void idx;
            });
            if (hidActive) activate(0);
        };
        const activate = (idx: number): void => {
            panes.forEach((p, i) => {
                p.el.style.display = i === idx ? 'block' : 'none';
                p.tab.classList.toggle('on', i === idx);
            });
            this.activeSection = panes[idx]?.title ?? null;
        };
        panes.forEach((p, i) => {
            p.tab.addEventListener('click', () => activate(i));
            rail.appendChild(p.tab);
            paneHost.appendChild(p.el);
        });
        this.tabs = panes.map((p, i) => ({ title: p.title, show: () => activate(i) }));
        // No section asked for: land on the ACTIVE chart type's own tab when it has one
        // (the tab a user opening settings under that style is usually after; its
        // subsections stay rail entries) — Symbol otherwise.
        const wanted =
            section !== undefined
                ? panes.findIndex((p) => p.title.toLowerCase() === section.toLowerCase())
                : panes.findIndex((p) => p.style === config.series.style && !p.tab.classList.contains('vela-sd-tab-sub'));
        activate(wanted >= 0 ? wanted : 0);
        this.syncTypeTabs?.(config.series.style);

        shell.append(rail, paneHost);
        dlg.appendChild(shell);
        dlg.appendChild(this.footer(config));

        scrim.appendChild(dlg);
        this.container.appendChild(scrim);
        this.root = scrim;
        // Pane-wide label column — must run after mount so label clones can be measured
        // against the live dialog (detached/`display:none` trees report width 0).
        // Structured chart-type panes (instance strip / group TOC) own their layout and
        // tag their rows hosts instead; each host gets its own grid.
        for (const p of panes) {
            const hosts = [...p.el.querySelectorAll('[data-sd-rows-host]')] as HTMLElement[];
            if (hosts.length === 0) {
                this.layoutSettingsGrids(p.el, dlg);
                continue;
            }
            for (const h of hosts) this.layoutSettingsGrids(h, dlg);
        }
    }

    close(): void {
        closeColorPopover();
        closeWidthPopover();
        this.root?.remove();
        this.root = null;
        this.tabs = [];
    }

    destroy(): void {
        this.close();
        this.onChange = null;
        this.onImport = null;
        this.config = null;
    }

    /** Emit one chart-type SDK settings value (persisted under chartTypes[<id>]). */
    private emitType(typeId: string, key: string, value: unknown): void {
        this.emit({ chartTypes: { [typeId]: { [key]: value } } } as ConfigPatch);
    }

    private emit(patch: ConfigPatch): void {
        this.onChange?.(patch);
    }

    /** In-pane section title (the reference `set-section-title`). The generous top margin
     *  is what separates groups — whitespace, not rules. */
    private sectionTitle(text: string): HTMLElement {
        const el = document.createElement('div');
        el.className = 'vela-sd-sect';
        el.style.cssText = 'margin:24px 0 0;padding-bottom:8px;font-size:var(--vela-font-size-sm);font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vela-fg-muted);';
        el.textContent = text;
        return el;
    }

    /**
     * One chart type's settings tab (and its subsection tabs), appended to the linear
     * `body` for the pane splitter to file. One live values BAG serves the whole section
     * — instances and subsections share the per-type store, so a `when` gate anywhere
     * can reference a key edited anywhere else; every edit runs every registered
     * refresher.
     */
    private chartTypeSection(typeId: string, section: ChartTypeSettingsSection, config: ChartConfig, body: HTMLElement): void {
        const marker = this.section(section.title);
        marker.dataset.sdStyle = typeId;
        marker.dataset.sdVisibility = section.visibility ?? 'active';
        body.append(marker);

        const values = config.chartTypes[typeId] ?? {};
        const bag: Record<string, unknown> = {};
        const seedKey = (key: string, want: 'boolean' | 'number' | 'string', defval: unknown): void => {
            const v = values[key];
            bag[key] = typeof v === want ? v : defval;
        };
        const seed = (rows: readonly SettingsRowDescriptor[]): void => {
            for (const r of rows) {
                if (r.kind === 'heading' || r.kind === 'header') continue;
                if (r.kind === 'range') {
                    seedKey(r.minKey, 'number', r.defval);
                    seedKey(r.maxKey, 'number', r.defval);
                    continue;
                }
                seedKey(r.key, r.kind === 'toggle' ? 'boolean' : r.kind === 'number' ? 'number' : 'string', r.defval);
                if (r.kind === 'toggle') {
                    if (r.number) seedKey(r.number.key, 'number', r.number.defval);
                    for (const c of r.colors ?? []) seedKey(c.key, 'string', c.defval);
                    if (r.width) seedKey(r.width.key, 'number', r.width.defval);
                }
            }
        };
        if (section.rows) seed(section.rows);
        for (const inst of section.instances ?? []) seed(inst.rows);
        for (const sub of section.subsections ?? []) seed(sub.rows);
        // Instance / subsection presence keys may have no row of their own — absent means OFF.
        for (const inst of section.instances ?? []) {
            if (!inst.enableKey || inst.enableKey in bag) continue;
            bag[inst.enableKey] = values[inst.enableKey] === true;
        }
        for (const sub of section.subsections ?? []) {
            if (!sub.enableKey || sub.enableKey in bag) continue;
            bag[sub.enableKey] = values[sub.enableKey] === true;
        }

        const refreshers: Array<() => void> = [];
        const put = (key: string, v: unknown): void => {
            bag[key] = v;
            this.emitType(typeId, key, v);
            for (const r of refreshers) r();
        };

        if (section.instances && section.instances.length > 0) {
            body.append(this.instancesBlock(typeId, section.instances, bag, put, refreshers));
        } else if (section.rows) {
            this.flatTypeRows(section.rows, bag, put, refreshers, body);
        }

        for (const sub of section.subsections ?? []) {
            const subMarker = this.section(sub.title);
            subMarker.dataset.sdStyle = typeId;
            subMarker.dataset.sdVisibility = section.visibility ?? 'active';
            subMarker.dataset.sdSub = '1';
            body.append(subMarker);
            body.append(this.groupedRows(`${typeId}/${sub.title}`, sub.rows, bag, put, refreshers, sub.enableKey));
        }
        for (const r of refreshers) r();
    }

    /** The FLAT chart-type form: rows appended straight to the body (the pane grid wraps
     *  them), headings/headers as inline group titles, `when` gates refreshed live. */
    private flatTypeRows(
        rows: readonly SettingsRowDescriptor[],
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
        refreshers: Array<() => void>,
        body: HTMLElement,
    ): void {
        const entries: Array<{ el: HTMLElement; when?: SettingsRowWhen }> = [];
        for (const r of rows) {
            const el = r.kind === 'heading' || r.kind === 'header' ? this.sectionTitle(r.label) : this.typeRow(r, bag, put);
            entries.push({ el, when: r.when });
            body.append(el);
        }
        refreshers.push(() => {
            // A class, not inline display: the pane grid dissolves rows into
            // display:contents AFTER the first pass, which would wipe inline 'none'.
            for (const e of entries) e.el.classList.toggle('vela-sd-hide', !settingsRowVisible(e.when, bag));
        });
    }

    /** One value row for a chart-type descriptor, writing through `put`. */
    private typeRow(
        r: Exclude<SettingsRowDescriptor, { kind: 'heading' | 'header' }>,
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
    ): HTMLElement {
        if (r.kind === 'toggle') {
            const controls: HTMLElement[] = [];
            if (r.number) {
                const nr = r.number;
                const ni = document.createElement('input');
                ni.type = 'number';
                ni.className = 'vela-sd-number';
                ni.style.width = '56px';
                ni.value = String(typeof bag[nr.key] === 'number' ? bag[nr.key] : nr.defval);
                if (nr.min !== undefined) ni.min = String(nr.min);
                if (nr.max !== undefined) ni.max = String(nr.max);
                ni.step = String(nr.step ?? 1);
                ni.title = nr.label;
                ni.addEventListener('input', () => {
                    const n = Number(ni.value);
                    if (Number.isFinite(n)) put(nr.key, n);
                });
                controls.push(ni);
            }
            for (const c of r.colors ?? []) {
                const sw = this.swatch(bag[c.key] as string, (v) => put(c.key, v));
                sw.title = c.label;
                controls.push(sw);
            }
            if (r.width) {
                const w = r.width;
                let cur = typeof bag[w.key] === 'number' ? (bag[w.key] as number) : w.defval;
                const wf = widthField(this.theme, () => cur, (v) => {
                    cur = v;
                    put(w.key, v);
                });
                wf.title = w.label;
                controls.push(wf);
            }
            return this.toggleRow(r.label, bag[r.key] as boolean, (v) => put(r.key, v), controls);
        }
        if (r.kind === 'number') return this.numberRow(r.label, bag[r.key] as number, r.min ?? 0, r.max ?? 1_000_000, r.step ?? 1, (v) => put(r.key, v));
        if (r.kind === 'color') return this.colorRow(r.label, bag[r.key] as string, (v) => put(r.key, v));
        if (r.kind === 'range') return this.rangeRow(r, bag, put);
        return this.selectRowLabeled(r.label, bag[r.key] as string, normalizeSelectOptions(r.options), (v) => put(r.key, v));
    }

    /**
     * A MIN–MAX row: two number inputs on one row (stored under the descriptor's
     * `minKey`/`maxKey`). With a `placeholder`, an input at the DEFAULT value renders
     * empty showing it, and clearing an input stores the default back — the
     * placeholder names the unset state ('Off' for 0-disables bounds).
     */
    private rangeRow(
        r: Extract<SettingsRowDescriptor, { kind: 'range' }>,
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
    ): HTMLElement {
        const { wrap } = this.row(r.label);
        const input = (key: string, title: string): HTMLInputElement => {
            const ni = document.createElement('input');
            ni.type = 'number';
            ni.className = 'vela-sd-number';
            ni.min = String(r.min ?? 0);
            ni.max = String(r.max ?? 1_000_000);
            ni.step = String(r.step ?? 1);
            ni.title = title;
            const current = bag[key] as number;
            if (r.placeholder !== undefined) {
                ni.placeholder = r.placeholder;
                if (current !== r.defval) ni.value = String(current);
            } else {
                ni.value = String(current);
            }
            // 'change' (commit), not 'input': an empty field means "default" only once
            // the user is done, never while they are mid-edit.
            ni.addEventListener('change', () => {
                const raw = ni.value.trim() === '' ? r.defval : Number(ni.value);
                const v = Number.isFinite(raw) ? Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, raw)) : r.defval;
                ni.value = r.placeholder !== undefined && v === r.defval ? '' : String(v);
                put(key, v);
            });
            return ni;
        };
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';
        const dash = document.createElement('span');
        dash.textContent = '–';
        dash.style.cssText = 'color:var(--vela-fg-muted);';
        box.append(input(r.minKey, `${r.label} — min`), dash, input(r.maxKey, `${r.label} — max`));
        wrap.appendChild(box);
        return wrap;
    }

    /**
     * The INSTANCE STRIP block: a tab per present instance (label, `×` on the active
     * removable one), a dashed `+` while an instance is still absent, and one
     * grouped-rows content per instance below — only the active tab's content shows.
     * Presence is the boolean at each instance's `enableKey`; the strip rebuilds on
     * every section edit, so gates elsewhere stay coherent.
     */
    private instancesBlock(
        typeId: string,
        instances: readonly ChartTypeSettingsInstance[],
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
        refreshers: Array<() => void>,
    ): HTMLElement {
        const wrap = document.createElement('div');
        const strip = document.createElement('div');
        strip.className = 'vela-sd-itabs';
        // A lone always-present instance has nothing to switch or add — sections that
        // go structured purely for the group TOC get no one-tab strip.
        if (instances.length > 1 || instances[0]?.enableKey !== undefined) wrap.append(strip);
        const contents = instances.map((inst, i) => {
            const content = this.groupedRows(`${typeId}/#${i}`, inst.rows, bag, put, refreshers);
            wrap.append(content);
            return content;
        });

        const present = (inst: ChartTypeSettingsInstance): boolean => !inst.enableKey || bag[inst.enableKey] === true;
        const refresh = (): void => {
            let active = this.typeActiveInstance.get(typeId) ?? 0;
            if (!present(instances[active] ?? instances[0]!)) active = 0;
            this.typeActiveInstance.set(typeId, active);

            strip.replaceChildren();
            instances.forEach((inst, i) => {
                if (!present(inst)) return;
                const tab = document.createElement('button');
                tab.type = 'button';
                tab.className = 'vela-sd-itab' + (i === active ? ' on' : '');
                const lbl = document.createElement('span');
                lbl.textContent = inst.label;
                tab.append(lbl);
                if (i === active && inst.enableKey) {
                    const x = document.createElement('span');
                    x.className = 'vela-sd-ix';
                    x.textContent = '✕';
                    x.title = `Remove ${inst.label}`;
                    x.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.typeActiveInstance.set(typeId, 0);
                        put(inst.enableKey!, false); // put() re-runs every refresher, this one included
                    });
                    tab.append(x);
                }
                tab.addEventListener('click', () => {
                    this.typeActiveInstance.set(typeId, i);
                    refresh();
                });
                strip.append(tab);
            });
            const absent = instances.findIndex((inst) => !present(inst));
            if (absent >= 0) {
                const add = document.createElement('button');
                add.type = 'button';
                add.className = 'vela-sd-itab vela-sd-itab-add';
                add.textContent = '+';
                add.title = `Add ${instances[absent]!.label}`;
                add.addEventListener('click', () => {
                    this.typeActiveInstance.set(typeId, absent);
                    put(instances[absent]!.enableKey!, true);
                });
                strip.append(add);
            }
            contents.forEach((c, i) => c.classList.toggle('vela-sd-hide', i !== active));
        };
        refreshers.push(refresh);
        return wrap;
    }

    /**
     * A GROUPED rows pane: a TOC column of the group labels (from `heading` rows) and
     * ONE rows host holding every row — the active group's rows show, the rest hide.
     * Rows BEFORE the first heading are the always block, visible above every group.
     * `header` rows stay in the rows column as in-group subgroup titles (not TOC
     * entries). A group whose value rows are all gated out (or whose heading's own
     * `when` fails) leaves the TOC; the whole TOC hides when no group is live. The
     * rows host is tagged for `layoutSettingsGrids`, keeping one shared label column
     * across all groups.
     *
     * `enableKey` (optional): while that bag boolean is false, every row except the one
     * whose key matches is soft-disabled (visible but grayed / non-interactive) so the
     * pane stays browseable with the feature off.
     */
    private groupedRows(
        paneKey: string,
        rows: readonly SettingsRowDescriptor[],
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
        refreshers: Array<() => void>,
        enableKey?: string,
    ): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'vela-sd-struct';
        const toc = document.createElement('div');
        toc.className = 'vela-sd-toc';
        const rowsHost = document.createElement('div');
        rowsHost.dataset.sdRowsHost = '1';
        rowsHost.style.cssText = 'flex:1 1 auto;min-width:0;';
        wrap.append(toc, rowsHost);

        const entries: Array<{ el: HTMLElement; when?: SettingsRowWhen; group: number; key?: string; header?: boolean }> = [];
        const groups: string[] = [];
        const groupWhens: Array<SettingsRowWhen | undefined> = [];
        let g = -1; // -1 = the always block before the first heading
        for (const r of rows) {
            if (r.kind === 'heading') {
                g = groups.length;
                groups.push(r.label);
                groupWhens.push(r.when);
                continue; // headings live in the TOC, not the rows column
            }
            if (r.kind === 'header') {
                entries.push({ el: this.sectionTitle(r.label), when: r.when, group: g, header: true });
                rowsHost.append(entries[entries.length - 1]!.el);
                continue;
            }
            const el = this.typeRow(r, bag, put);
            const key = r.kind === 'range' ? undefined : r.key;
            entries.push({ el, when: r.when, group: g, key });
            rowsHost.append(el);
        }

        const refresh = (): void => {
            // Headers don't keep a TOC group alive — only value rows do.
            const live = groups.map((_, gi) =>
                settingsRowVisible(groupWhens[gi], bag)
                && entries.some((e) => e.group === gi && !e.header && settingsRowVisible(e.when, bag)));
            let activeIdx = groups.indexOf(this.typeActiveGroup.get(paneKey) ?? '');
            if (activeIdx < 0 || !live[activeIdx]) activeIdx = live.findIndex(Boolean);
            if (activeIdx >= 0) this.typeActiveGroup.set(paneKey, groups[activeIdx]!);

            toc.replaceChildren();
            groups.forEach((label, gi) => {
                if (!live[gi]) return;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'vela-sd-toc-btn' + (gi === activeIdx ? ' on' : '');
                b.textContent = label;
                b.addEventListener('click', () => {
                    this.typeActiveGroup.set(paneKey, label);
                    refresh();
                });
                toc.append(b);
            });
            const anyGroup = live.some(Boolean);
            toc.classList.toggle('vela-sd-hide', !anyGroup);
            wrap.classList.toggle('no-toc', !anyGroup);

            const enabled = !enableKey || bag[enableKey] === true;
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i]!;
                let visible = (e.group === -1 || e.group === activeIdx) && settingsRowVisible(e.when, bag);
                // A header with no visible content under it (until the next header /
                // group end) collapses so empty subgroups don't leave orphan titles.
                if (visible && e.header) {
                    let hasContent = false;
                    for (let j = i + 1; j < entries.length; j++) {
                        const n = entries[j]!;
                        if (n.group !== e.group || n.header) break;
                        if (settingsRowVisible(n.when, bag)) { hasContent = true; break; }
                    }
                    visible = hasContent;
                }
                e.el.classList.toggle('vela-sd-hide', !visible);
                // Soft-disable everything except the master toggle while the feature is off.
                e.el.classList.toggle('vela-sd-soft', visible && !enabled && e.key !== enableKey);
            }
        };
        refreshers.push(refresh);
        return wrap;
    }

    /** Vertical breathing space between row clusters — grouping reads from whitespace,
     *  so no drawn rule. */
    private separator(): HTMLElement {
        const el = document.createElement('div');
        el.className = 'vela-sd-sep';
        el.style.cssText = 'height:14px;';
        return el;
    }

    /**
     * One pane-wide control column (section-agnostic), sized to the longest setting
     * title — same idea as the indicator settings dialog's `minmax(..., auto)` label
     * track, but shared across every section in the tab.
     *
     * `measureHost` must be a visible, in-document ancestor (the dialog): panes are
     * `display:none` until selected, which would zero layout measurements.
     */
    private layoutSettingsGrids(pane: HTMLElement, measureHost: HTMLElement): void {
        if (pane.childElementCount === 0) return;
        const rows = [...pane.querySelectorAll('.vela-sd-row')] as HTMLElement[];

        // Clone labels into a visible host so hidden price-style groups still contribute
        // (switching Type must not jump the column) and spanning bool/section rows can't
        // inflate the track.
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;display:flex;flex-direction:column;font:13px var(--vela-font);pointer-events:none;';
        measureHost.appendChild(probe);
        let widest = 0;
        for (const row of rows) {
            const cell = row.children[0];
            if (!cell) continue;
            const clone = cell.cloneNode(true) as HTMLElement;
            probe.appendChild(clone);
            widest = Math.max(widest, clone.getBoundingClientRect().width);
        }
        probe.remove();

        // A pane of only spanning rows (toggles, section titles) has no label column to
        // measure — it still gets the grid, so its rows share the same 16px rhythm.
        const labelTrack = widest > 0 ? `${Math.ceil(widest)}px` : 'max-content';
        const grid = document.createElement('div');
        grid.style.cssText =
            `display:grid;grid-template-columns:${labelTrack} max-content;align-items:center;column-gap:12px;row-gap:16px;`;
        while (pane.firstChild) grid.appendChild(pane.firstChild);
        pane.appendChild(grid);
        this.prepareGridItems(grid);
    }

    /** Mark rows/titles/bools so they participate in the pane grid; `display:contents`
     *  groups dissolve so their children land on the same tracks. */
    private prepareGridItems(container: HTMLElement): void {
        for (const kid of [...container.children] as HTMLElement[]) {
            if (kid.dataset.sdGroup !== undefined) {
                this.prepareGridItems(kid);
                continue;
            }
            if (kid.classList.contains('vela-sd-row')) {
                kid.style.display = 'contents';
            } else if (
                kid.classList.contains('vela-sd-bool')
                || kid.classList.contains('vela-sd-sect')
                || kid.classList.contains('vela-sd-sep')
            ) {
                kid.style.gridColumn = '1 / -1';
            }
        }
    }

    /** A bare color swatch input (for toggle-row right groups / swatch pairs). */
    private swatch(value: string, onChange: (v: string) => void): HTMLElement {
        let current = value;
        return colorField(this.theme, () => current, (v) => { current = v; onChange(v); });
    }

    /** A label row with arbitrary controls in the shared control column (no toggle). */
    private rowWith(label: string, controls: HTMLElement[]): HTMLElement {
        const { wrap } = this.row(label);
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';
        for (const c of controls) box.appendChild(c);
        wrap.appendChild(box);
        return wrap;
    }

    private section(title: string): HTMLElement {
        // Tab MARKER — the shell splits the linear build into panes at these.
        const el = document.createElement('div');
        el.dataset.sdTab = title;
        el.style.display = 'none';
        return el;
    }

    /** A display:contents wrapper grouping one price style's rows, so toggling it
     *  (contents ⇄ none) shows/hides the set without disturbing the body flex layout. */
    private group(): HTMLElement {
        const el = document.createElement('div');
        el.dataset.sdGroup = '';
        el.style.cssText = 'display:contents;';
        return el;
    }

    private row(label: string): { wrap: HTMLDivElement } {
        // A DIV, not a <label>: a label forwards a click anywhere on the row to its embedded
        // control (opening a color picker from the row's empty space) — only the control
        // itself should respond. `layoutSettingsGrids` later sets `display:contents` so the
        // label + control participate in the pane's shared grid.
        const wrap = document.createElement('div');
        wrap.className = 'vela-sd-row';
        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'opacity:0.85;white-space:nowrap;';
        wrap.appendChild(lbl);
        return { wrap };
    }

    private colorRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
        const { wrap } = this.row(label);
        let current = value;
        wrap.appendChild(colorField(this.theme, () => current, (v) => { current = v; onChange(v); }));
        return wrap;
    }

    /** A toggle row: the checkbox sits to the LEFT of its label (never in the control area). */
    private boolRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
        return this.toggleRow(label, value, onChange, []);
    }

    /** An enable row: checkbox + label in the label column, dependent controls in the
     *  shared control column; the control group dims and ignores input while the toggle
     *  is off. With no controls it reads like a plain toggle row (full-width in the grid). */
    private toggleRow(label: string, value: boolean, onToggle: (v: boolean) => void, controls: HTMLElement[]): HTMLElement {
        const wrap = document.createElement('div');
        // No cursor on the row itself: only the checkbox is clickable, so a row-wide
        // pointer would promise a click target that isn't there.
        const cb = document.createElement('button');
        cb.type = 'button';
        cb.className = 'vela-sd-check' + (value ? ' on' : '');
        cb.innerHTML = iconAt('check', 11);
        let checked = value;
        const cbToggle = (): boolean => {
            checked = !checked;
            cb.classList.toggle('on', checked);
            return checked;
        };
        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'opacity:0.85;white-space:nowrap;';
        if (controls.length === 0) {
            wrap.className = 'vela-sd-bool';
            wrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-height:22px;';
            wrap.append(cb, lbl);
            cb.addEventListener('click', () => onToggle(cbToggle()));
            return wrap;
        }
        wrap.className = 'vela-sd-row';
        const left = document.createElement('div');
        left.style.cssText = 'display:flex;align-items:center;gap:8px;';
        left.append(cb, lbl);
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;align-items:center;gap:6px;';
        for (const c of controls) box.appendChild(c);
        const syncDim = (on: boolean): void => {
            box.style.opacity = on ? '1' : '0.4';
            box.style.pointerEvents = on ? '' : 'none';
        };
        syncDim(value);
        cb.addEventListener('click', () => { const v = cbToggle(); onToggle(v); syncDim(v); });
        wrap.append(left, box);
        return wrap;
    }

    private numberRow(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
        const { wrap } = this.row(label);
        const ni = document.createElement('input');
        ni.type = 'number';
        ni.value = String(value);
        ni.min = String(min);
        ni.max = String(max);
        ni.step = String(step);
        ni.className = 'vela-sd-number';
        ni.addEventListener('input', () => {
            const n = Number(ni.value);
            if (Number.isFinite(n)) onChange(n);
        });
        wrap.appendChild(ni);
        return wrap;
    }

    /** Inline Auto/Manual row (Resolution, Text size): a mode dropdown + a value input greyed out in Auto. */
    private autoManualRow(label: string, isAuto: boolean, value: number, min: number, max: number, unit: string, onMode: (auto: boolean) => void, onValue: (v: number) => void): HTMLElement {
        const { wrap } = this.row(label);
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';
        const sel = document.createElement('select');
        sel.className = 'vela-sd-select';
        for (const [val, lbl] of AUTO_MANUAL_OPTS) {
            const o = document.createElement('option');
            o.value = val;
            o.textContent = lbl;
            if ((val === 'auto') === isAuto) o.selected = true;
            sel.appendChild(o);
        }
        const ni = document.createElement('input');
        ni.type = 'number';
        ni.min = String(min);
        ni.max = String(max);
        ni.step = '1';
        ni.value = String(value);
        ni.className = 'vela-sd-number';
        const unitLbl = document.createElement('span');
        unitLbl.textContent = unit;
        unitLbl.style.cssText = 'opacity:0.6;';
        const syncDisabled = (auto: boolean): void => {
            ni.disabled = auto;
            ni.style.opacity = auto ? '0.4' : '1';
        };
        syncDisabled(isAuto);
        sel.addEventListener('change', () => { const auto = sel.value === 'auto'; onMode(auto); syncDisabled(auto); });
        ni.addEventListener('input', () => { const n = Number(ni.value); if (Number.isFinite(n)) onValue(n); });
        box.append(sel, ni, unitLbl);
        wrap.appendChild(box);
        return wrap;
    }

    /** A row whose control area holds several inline controls (e.g. show + color + width). */
    private inlineRow(label: string, controls: HTMLElement[]): HTMLElement {
        const { wrap } = this.row(label);
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;align-items:center;gap:6px;flex:0 0 auto;';
        for (const c of controls) box.appendChild(c);
        wrap.appendChild(box);
        return wrap;
    }

    /** A small dimmed hint span (e.g. the ≥ / ≤ between filter inputs). */
    private hint(text: string): HTMLElement {
        const s = document.createElement('span');
        s.textContent = text;
        s.style.cssText = 'opacity:0.5;font-size:12px;';
        return s;
    }

    /** A bare color input (for inline groups). */
    private colorInput(value: string, onChange: (v: string) => void): HTMLElement {
        const ci = document.createElement('input');
        ci.type = 'color';
        ci.value = toHex6(value);
        ci.style.cssText = 'cursor:pointer;width:34px;height:22px;border:none;background:transparent;padding:0;flex:0 0 auto;';
        ci.addEventListener('input', () => onChange(ci.value));
        return ci;
    }

    /** A bare compact number input (for inline groups). */
    private numberInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
        const ni = document.createElement('input');
        ni.type = 'number';
        ni.value = String(value);
        ni.min = String(min);
        ni.max = String(max);
        ni.step = String(step);
        ni.className = 'vela-sd-number';
        ni.style.flex = '0 0 auto';
        ni.addEventListener('input', () => {
            const n = Number(ni.value);
            if (Number.isFinite(n)) onChange(n);
        });
        return ni;
    }

    /** A small in-group heading (lighter than a top-level section divider). */
    private subheading(text: string): HTMLElement {
        const el = document.createElement('div');
        el.textContent = text;
        el.style.cssText = 'margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;opacity:0.45;';
        return el;
    }

    /** A dropdown whose option values differ from their display labels. */
    private selectRowLabeled(label: string, value: string, options: readonly (readonly [string, string])[], onChange: (v: string) => void): HTMLElement {
        const { wrap } = this.row(label);
        const sel = document.createElement('select');
        sel.className = 'vela-sd-select';
        sel.style.cssText = 'max-width:200px;flex:0 0 auto;';
        for (const [val, lbl] of options) {
            const o = document.createElement('option');
            o.value = val;
            o.textContent = lbl;
            if (val === value) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => onChange(sel.value));
        wrap.appendChild(sel);
        return wrap;
    }

    private selectRow(label: string, value: string, options: string[], onChange: (v: string) => void): HTMLElement {
        const { wrap } = this.row(label);
        const sel = document.createElement('select');
        sel.className = 'vela-sd-select';
        sel.style.cssText = 'max-width:200px;flex:0 0 auto;';
        for (const opt of options) {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        }
        sel.addEventListener('change', () => onChange(sel.value));
        wrap.appendChild(sel);
        return wrap;
    }

    /** Footer with the full config as JSON — the export/import (templating) surface. */
    private footer(_config: ChartConfig): HTMLElement {
        // Reference footer: actions only (Reset defaults, left-aligned). The JSON
        // export/import lives on the public API (getConfig/applyConfig), not in the UI.
        const foot = document.createElement('div');
        foot.style.cssText = `border-top:1px solid ${SETTINGS_BORDER};padding:10px 14px;display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:0 0 auto;`;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = 'Reset defaults';
        resetBtn.className = 'vela-sd-btn';
        resetBtn.addEventListener('click', () => this.onReset?.());
        foot.appendChild(resetBtn);
        return foot;
    }

    private button(label: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = `cursor:pointer;flex:1 1 auto;${this.ctrlStyle()}padding:5px 8px;font-weight:600;`;
        b.addEventListener('click', onClick);
        return b;
    }

    private ctrlStyle(): string {
        return `background:var(--vela-surface-sunken);border:1px solid ${SETTINGS_BORDER};color:${SETTINGS_TEXT};border-radius:var(--vela-radius-sm);padding:3px 6px;font-size:var(--vela-font-size-md);font-family:inherit;outline:none;`;
    }
}

const AUTO_MANUAL_OPTS: readonly (readonly [string, string])[] = [['auto', 'Auto'], ['manual', 'Manual']];

/** Normalize a select descriptor's options to `[value, label]` pairs. */
function normalizeSelectOptions(options: readonly SettingsSelectOption[]): readonly (readonly [string, string])[] {
    return options.map((o) => (typeof o === 'string' ? [o, o] as const : o));
}

const FONT_FAMILIES = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Georgia', 'Courier New', '-apple-system, Segoe UI, sans-serif'];
const LINE_STYLES = ['solid', 'dashed', 'dotted'];
/** The shared zone catalog as labeled options, with the current value guaranteed
 *  present (so an externally-set custom zone still shows selected). */
function timezoneOptions(current: string): readonly (readonly [string, string])[] {
    const options = TIMEZONES.map((t) => [t.value, tzMenuLabel(t.value, t.label)] as const);
    const normalized = normalizeTimezone(current);
    if (TIMEZONES.some((t) => t.value === normalized)) return options;
    return [[normalized, tzMenuLabel(normalized, normalized)] as const, ...options];
}

