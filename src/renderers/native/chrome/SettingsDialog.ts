import type { VelaTheme, ThemeName } from '../../../core/options';
import type { ChartConfig } from '../core/chartConfig';
import {
    chartType,
    chartTypes,
    normalizeSettingsRow,
    settingsRowValueKeys,
    settingsRowVisible,
    type ChartTypeSettingsInstance,
    type ChartTypeSettingsSection,
    type SettingsInlineControl,
    type SettingsRowDescriptor,
    type SettingsRowWhen,
    type SettingsSelectOption,
    type SettingsValueRow,
} from '../../../chart-types/registry';
import { iconAt } from '../../../core/icons';
import { TIMEZONES, tzMenuLabel, normalizeTimezone } from '../../../core/timezones';
import { closeOpenPopovers } from '../../../ui/components/popover';
import { closeWidthPopover } from '../../../ui/components/glyph-select';
import { Dialog } from '../../../ui/components/dialog';
import { overlayScrollbarCss } from '../../../ui/styles';
import {
    fieldGrid,
    fieldRow,
    fieldSection,
    fieldSeparator,
    buildFieldControl,
} from '../../../ui/components/field';
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
const SD_STYLE_REV = '5';

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
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(SD_STYLE_ID) as HTMLStyleElement | null;
    if (existing?.dataset.rev === SD_STYLE_REV) return;
    const st = existing ?? document.createElement('style');
    st.id = SD_STYLE_ID;
    st.dataset.rev = SD_STYLE_REV;
    st.textContent = `
${overlayScrollbarCss('.vela-sd-pane')}
/* Tab rail / footer button / header close: base styles live HERE, not inline on the
   elements — inline declarations always beat stylesheet :hover rules, which is exactly
   what killed these hovers before. Active tab state is the .on class,
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
/* ── mobile presentation (.vela-sd-mobile on the scrim; structural sizes are inline in open()) ──
   The tab rail becomes a burger-opened overlay sidebar; the group TOC becomes a sticky
   row of horizontally scrollable tabs; the instance strip scrolls instead of wrapping;
   controls grow to touch size and labels may wrap (the grid gives them a flexible track). */
.vela-sd-mobile .vela-sd-burger{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;color:var(--vela-fg);line-height:0;width:36px;height:36px;border-radius:var(--vela-radius-sm);margin-right:2px;}
.vela-sd-mobile .vela-sd-burger:active{background:var(--vela-hover);}
.vela-sd-mobile .vela-sd-railscrim{position:absolute;inset:0;z-index:2;background:var(--vela-backdrop);display:none;}
.vela-sd-mobile .vela-sd-railscrim.open{display:block;}
.vela-sd-mobile .vela-sd-rail{position:absolute;left:0;top:0;bottom:0;z-index:3;width:min(240px,80%);box-sizing:border-box;background:var(--vela-surface);border-right:1px solid var(--vela-border);box-shadow:var(--vela-shadow-dialog);transform:translateX(-105%);transition:transform var(--vela-dur-med) var(--vela-ease);}
.vela-sd-mobile .vela-sd-rail.open{transform:translateX(0);}
.vela-sd-mobile .vela-sd-tab{padding:12px;}
.vela-sd-mobile .vela-sd-struct{flex-direction:column;padding-top:8px;}
.vela-sd-mobile .vela-sd-toc{position:sticky;top:0;z-index:1;background:var(--vela-surface);flex-direction:row;overflow-x:auto;scrollbar-width:none;min-width:0;width:100%;box-sizing:border-box;gap:4px;padding:2px 0 8px;}
.vela-sd-mobile .vela-sd-toc::-webkit-scrollbar{display:none;}
.vela-sd-mobile .vela-sd-toc-btn{flex:none;padding:8px 12px;font-size:13px;}
.vela-sd-mobile .vela-sd-struct>[data-sd-rows-host]{border-left:none;padding-left:0;width:100%;}
.vela-sd-mobile .vela-sd-itabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;}
.vela-sd-mobile .vela-sd-itabs::-webkit-scrollbar{display:none;}
.vela-sd-mobile .vela-sd-itab{height:36px;flex:none;}
.vela-sd-mobile .vela-switch{width:22px;height:22px;}
.vela-sd-mobile .vela-select-trigger,.vela-sd-mobile .vela-num input,.vela-sd-mobile .vela-width-field{height:34px;}
.vela-sd-mobile .vela-sd-close{width:40px;height:40px;}
.vela-sd-mobile .vela-sd-btn{height:38px;}
.vela-sd-mobile .vela-sd-row span,.vela-sd-mobile .vela-sd-bool span,.vela-sd-mobile .vela-field-label{white-space:normal !important;}
`;
    if (!existing) document.head.appendChild(st);
}

export class SettingsDialog {
    private root: HTMLElement | null = null;
    private ui: Dialog | null = null;
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
    /** Mobile chrome: fullscreen card, burger-opened section sidebar, TOC as top tabs. */
    private mobileLayout = false;

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
        this.reopenIfLive();
    }

    /** The host shell's chrome size class — mobile presents the dialog fullscreen with
     *  the tab rail behind a burger sidebar and the TOC as top tabs. An open dialog
     *  re-presents in place, on the same tab. */
    setLayoutMode(mode: 'mobile' | 'desktop'): void {
        const mobile = mode === 'mobile';
        if (mobile === this.mobileLayout) return;
        this.mobileLayout = mobile;
        this.reopenIfLive();
    }

    /** Rebuild an open dialog in place (theme swap, layout-mode flip) on the same tab. */
    private reopenIfLive(): void {
        if (!this.root) return;
        const cfg = this.config;
        const oc = this.onChange;
        const oi = this.onImport;
        const orst = this.onReset;
        const section = this.activeSection;
        this.close();
        if (cfg && oc) this.open(cfg, oc, oi ?? undefined, orst ?? undefined, section ?? undefined);
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
        const mobile = this.mobileLayout;
        let toggleRail: ((open?: boolean) => void) | null = null;
        let burger: HTMLButtonElement | undefined;
        if (mobile) {
            burger = document.createElement('button');
            burger.type = 'button';
            burger.className = 'vela-sd-burger';
            burger.innerHTML = iconAt('burger', 16);
            burger.title = 'Sections';
            burger.addEventListener('click', () => toggleRail?.());
        }

        const body = document.createElement('div');
        body.style.cssText = 'display:flex;flex-direction:column;gap:0;';

        // ══ SYMBOL — chart type + per-style cosmetics + time zone (the reference tab) ══
        body.append(this.section('Symbol'));
        body.append(this.sectionTitle('Chart type'));
        const groups: Partial<Record<string, HTMLElement>> = {};
        const showActive = (style: string): void => {
            const active = style === 'heikinashi' ? 'candles' : style; // heikin-ashi is candle-drawn
            // Gate via the !important class, not inline display: the field-grid pass
            // rewrites every group's display to 'contents' AFTER this visibility pass.
            for (const key of priceStyleIds()) {
                groups[key]?.classList.toggle('vela-sd-hide', key !== active);
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
        shell.style.cssText = mobile
            ? 'display:flex;min-height:0;flex:1 1 auto;position:relative;overflow:hidden;'
            : 'display:flex;min-height:360px;max-height:calc(70vh - 100px);flex:1 1 auto;';
        const rail = document.createElement('div');
        rail.className = 'vela-sd-rail';
        // Mobile: the class rules turn the rail into the slide-in sidebar; the inline
        // styles here carry only its inner layout. Desktop keeps the fixed column.
        rail.style.cssText = mobile
            ? 'display:flex;flex-direction:column;gap:2px;padding:10px 8px;overflow-y:auto;'
            : `flex:0 0 170px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid ${SETTINGS_BORDER};overflow-y:auto;`;
        let railScrim: HTMLElement | null = null;
        if (mobile) {
            railScrim = document.createElement('div');
            railScrim.className = 'vela-sd-railscrim';
            railScrim.addEventListener('click', () => toggleRail?.());
            toggleRail = (open?: boolean) => {
                const on = open ?? !rail.classList.contains('open');
                rail.classList.toggle('open', on);
                railScrim?.classList.toggle('open', on);
            };
        }
        const paneHost = document.createElement('div');
        paneHost.className = 'vela-sd-pane';
        // overflow-anchor off: Chrome's scroll anchoring can jump this scroller when a
        // body-portaled popover (select list, color picker) is swapped in one gesture.
        paneHost.style.cssText = mobile ? 'flex:1;min-width:0;overflow-y:auto;overflow-anchor:none;padding:6px 14px calc(14px + env(safe-area-inset-bottom, 0px));' : 'flex:1;overflow-y:auto;overflow-anchor:none;padding:6px 18px 14px;';

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
        const ui = new Dialog({
            host: this.container,
            title: 'Chart settings',
            // Non-modal: a live-edit dialog must leave the page interactive — a modal
            // machine locks pointer events on the whole body, killing the chart, the
            // legend, and the body-portaled popovers (color picker, select lists).
            modal: false,
            contained: true,
            align: 'top',
            draggable: !mobile,
            flush: true,
            className: 'vela-dialog--settings',
            headerStart: burger,
            closeOnBackdrop: true,
            footer: (foot) => {
                foot.style.cssText = `padding:10px 14px;display:flex;align-items:center;justify-content:flex-start;gap:8px;`;
                const resetBtn = document.createElement('button');
                resetBtn.type = 'button';
                resetBtn.textContent = 'Reset defaults';
                resetBtn.className = 'vela-sd-btn';
                resetBtn.addEventListener('click', () => this.onReset?.());
                foot.appendChild(resetBtn);
            },
            onOpenChange: (open) => { if (!open) this.close(); },
        });
        if (mobile) ui.positioner.classList.add('vela-sd-mobile');
        ui.positioner.style.paddingTop = mobile ? '0' : '8vh';

        const activate = (idx: number): void => {
            panes.forEach((p, i) => {
                p.el.style.display = i === idx ? 'block' : 'none';
                p.tab.classList.toggle('on', i === idx);
            });
            this.activeSection = panes[idx]?.title ?? null;
            if (mobile) {
                ui.titleEl.textContent = panes[idx]?.title ?? 'Chart settings';
                toggleRail?.(false);
            }
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
        if (railScrim) shell.append(railScrim);
        ui.body.appendChild(shell);
        this.root = ui.positioner;
        this.ui = ui;
        ui.show();
        // Structured chart-type panes (instance strip / group TOC) own their layout and
        // tag their rows hosts instead; each host gets its own field grid.
        for (const p of panes) {
            const hosts = [...p.el.querySelectorAll('[data-sd-rows-host]')] as HTMLElement[];
            if (hosts.length === 0) {
                this.layoutSettingsGrids(p.el);
                continue;
            }
            for (const h of hosts) this.layoutSettingsGrids(h);
        }
    }

    close(): void {
        closeOpenPopovers();
        closeWidthPopover();
        const ui = this.ui;
        this.ui = null;
        this.root = null;
        this.tabs = [];
        ui?.destroy();
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

    /** In-pane section title. The generous top margin is what separates groups. */
    private sectionTitle(text: string): HTMLElement {
        return fieldSection(text);
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
        // One generic walk over EVERY key a row stores (registry-enumerated) — no
        // kind-specific seeding to keep in sync with the descriptor union.
        const seed = (rows: readonly SettingsRowDescriptor[]): void => {
            for (const r of rows) {
                for (const k of settingsRowValueKeys(r)) {
                    const v = values[k.key];
                    bag[k.key] = typeof v === k.type ? v : k.defval;
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
            // 'grouped' promotes the flat rows to the structured pane's group-TOC
            // presentation (the TOC column right of the tab rail) — same rows, no strip.
            if (section.layout === 'grouped') body.append(this.groupedRows(`${typeId}/rows`, section.rows, bag, put, refreshers));
            else this.flatTypeRows(section.rows, bag, put, refreshers, body);
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
            const el = r.kind === 'heading' || r.kind === 'header' ? this.sectionTitle(r.label) : this.typeRow(r, bag, put, refreshers);
            entries.push({ el, when: r.when });
            body.append(el);
        }
        refreshers.push(() => {
            // A class, not inline display: the pane grid dissolves rows into
            // display:contents AFTER the first pass, which would wipe inline 'none'.
            for (const e of entries) e.el.classList.toggle('vela-sd-hide', !settingsRowVisible(e.when, bag));
        });
    }

    /**
     * One value row for a chart-type descriptor, writing through `put`. EVERY kind is
     * first reduced to the canonical composite shape ({@link normalizeSettingsRow}) and
     * rendered by the ONE path: optional leading toggle, then the ordered inline
     * controls in the control column. A control carrying its own `when` registers a
     * visibility refresher — it appears and disappears live as the bag changes,
     * independent of the row's gate — and is exempt from the toggle-off dim (it may
     * exist FOR the off state).
     */
    private typeRow(
        r: SettingsValueRow,
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
        refreshers: Array<() => void>,
    ): HTMLElement {
        const n = normalizeSettingsRow(r);
        const controls: HTMLElement[] = [];
        for (const c of n.controls) {
            const el = this.inlineControl(c, bag, put, n.toggle !== undefined);
            // Keyed controls re-read the bag on every refresh ('vela-sync') — several
            // `when`-gated rows may share one key (a per-mode row set over one stored
            // state), and the hidden twins must not go stale when the visible one edits.
            if (c.kind !== 'hint') refreshers.push(() => el.dispatchEvent(new Event('vela-sync')));
            if (c.kind !== 'hint' && c.when) {
                el.dataset.sdSelfGated = '1';
                const when = c.when;
                refreshers.push(() => {
                    el.style.display = settingsRowVisible(when, bag) ? '' : 'none';
                });
            }
            controls.push(el);
        }
        if (n.toggle) {
            const t = n.toggle;
            const el = this.toggleRow(n.label, bag[t.key] as boolean, (v) => put(t.key, v), controls, () => bag[t.key] === true);
            refreshers.push(() => el.dispatchEvent(new Event('vela-sync')));
            return el;
        }
        return this.rowWith(n.label, controls);
    }

    /**
     * Build ONE inline control from its descriptor — the factory behind the composite
     * row path. `compact` narrows number inputs on toggle rows (80px) while standalone
     * rows keep the 100px kit column.
     */
    private inlineControl(
        c: SettingsInlineControl,
        bag: Record<string, unknown>,
        put: (key: string, v: unknown) => void,
        compact: boolean,
    ): HTMLElement {
        if (c.kind === 'hint') {
            const s = document.createElement('span');
            s.textContent = c.text;
            s.style.cssText = 'color:var(--vela-fg-muted);';
            return s;
        }
        if (c.kind === 'color') {
            return buildFieldControl({
                kind: 'color',
                theme: this.theme,
                get: () => bag[c.key] as string,
                onChange: (v) => put(c.key, v),
                title: c.label,
            }).el;
        }
        if (c.kind === 'width') {
            const def = typeof bag[c.key] === 'number' ? (bag[c.key] as number) : c.defval;
            return buildFieldControl({
                kind: 'width',
                theme: this.theme,
                get: () => (typeof bag[c.key] === 'number' ? (bag[c.key] as number) : def),
                onChange: (v) => put(c.key, v),
                title: c.label,
            }).el;
        }
        if (c.kind === 'select') {
            const def = typeof bag[c.key] === 'string' ? (bag[c.key] as string) : c.defval;
            return buildFieldControl({
                kind: 'select',
                options: normalizeSelectOptions(c.options).map(([value, label]) => ({ value, label })),
                value: def,
                fill: false,
                theme: this.theme,
                title: c.label,
                onChange: (v) => put(c.key, v),
                sync: () => (typeof bag[c.key] === 'string' ? (bag[c.key] as string) : c.defval),
            }).el;
        }
        const def = typeof bag[c.key] === 'number' ? (bag[c.key] as number) : c.defval;
        return buildFieldControl({
            kind: 'number',
            value: def,
            min: c.min,
            max: c.max,
            step: c.step ?? 1,
            fill: false,
            commit: 'live',
            clamp: c.placeholder !== undefined,
            steppers: true,
            compact,
            title: c.label,
            placeholder: c.placeholder,
            emptyValue: c.placeholder !== undefined ? c.defval : undefined,
            onChange: (v) => put(c.key, v),
            sync: () => (typeof bag[c.key] === 'number' ? (bag[c.key] as number) : c.defval),
        }).el;
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
            const el = this.typeRow(r, bag, put, refreshers);
            // The key an `enableKey` soft-disable matches: the row's boolean toggle
            // (composite rows carry it under `toggle`), else the row's own value key.
            const key = r.kind === 'row' ? r.toggle?.key : r.kind === 'range' ? undefined : r.key;
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

    /** Vertical breathing space between row clusters — grouping reads from whitespace. */
    private separator(): HTMLElement {
        return fieldSeparator();
    }

    /** Wrap a pane (or a structured rows host) in the shared field grid. */
    private layoutSettingsGrids(pane: HTMLElement): void {
        if (pane.childElementCount === 0) return;
        const grid = fieldGrid({ variant: 'settings', mobile: this.mobileLayout });
        while (pane.firstChild) grid.appendChild(pane.firstChild);
        pane.appendChild(grid);
        for (const kid of [...grid.children] as HTMLElement[]) {
            if (kid.dataset.sdGroup !== undefined) this.flattenGroup(kid, grid);
        }
    }

    /** `display:contents` groups dissolve so their children land on the pane grid. */
    private flattenGroup(group: HTMLElement, grid: HTMLElement): void {
        group.style.display = 'contents';
        for (const kid of [...group.children] as HTMLElement[]) {
            if (kid.dataset.sdGroup !== undefined) this.flattenGroup(kid, grid);
        }
    }

    /** A bare color swatch (toggle-row right groups / swatch pairs). */
    private swatch(value: string, onChange: (v: string) => void, get?: () => string): HTMLElement {
        let current = value;
        return buildFieldControl({
            kind: 'color',
            theme: this.theme,
            get: () => (get ? get() : current),
            onChange: (v) => { current = v; onChange(v); },
        }).el;
    }

    /** A label row with arbitrary controls in the shared control column (no toggle). */
    private rowWith(label: string, controls: HTMLElement[]): HTMLElement {
        return fieldRow({ label, labelSize: 'sm', control: controls, className: 'vela-sd-row' });
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

    private colorRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
        let current = value;
        return fieldRow({
            label,
            labelSize: 'sm',
            fit: true,
            className: 'vela-sd-row',
            control: buildFieldControl({
                kind: 'color',
                theme: this.theme,
                get: () => current,
                onChange: (v) => { current = v; onChange(v); },
            }).el,
        });
    }

    /** A toggle row: the checkbox sits to the LEFT of its label (never in the control area). */
    private boolRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
        return this.toggleRow(label, value, onChange, []);
    }

    /** An enable row: checkbox + label in the label column, dependent controls in the
     *  shared control column; the control group dims and ignores input while the toggle
     *  is off. With `get`, the row re-reads its state on a 'vela-sync' event. */
    private toggleRow(label: string, value: boolean, onToggle: (v: boolean) => void, controls: HTMLElement[], get?: () => boolean): HTMLElement {
        return fieldRow({
            label,
            labelSize: 'sm',
            bool: controls.length === 0,
            toggle: { checked: value, onChange: onToggle, get },
            control: controls,
            className: controls.length === 0 ? 'vela-sd-bool' : 'vela-sd-row',
        });
    }

    private numberRow(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
        return fieldRow({
            label,
            labelSize: 'sm',
            className: 'vela-sd-row',
            control: buildFieldControl({
                kind: 'number',
                value,
                min,
                max,
                step,
                fill: false,
                commit: 'live',
                steppers: true,
                onChange,
            }).el,
        });
    }

    /** A dropdown whose option values differ from their display labels. */
    private selectRowLabeled(label: string, value: string, options: readonly (readonly [string, string])[], onChange: (v: string) => void): HTMLElement {
        return fieldRow({
            label,
            labelSize: 'sm',
            className: 'vela-sd-row',
            control: buildFieldControl({
                kind: 'select',
                options: options.map(([v, l]) => ({ value: v, label: l })),
                value,
                fill: false,
                theme: this.theme,
                onChange,
            }).el,
        });
    }

    private selectRow(label: string, value: string, options: string[], onChange: (v: string) => void): HTMLElement {
        return this.selectRowLabeled(label, value, options.map((o) => [o, o] as const), onChange);
    }
}

/** Normalize a select descriptor's options to `[value, label]` pairs. */
function normalizeSelectOptions(options: readonly SettingsSelectOption[]): readonly (readonly [string, string])[] {
    return options.map((o) => (typeof o === 'string' ? [o, o] as const : o));
}

/** The shared zone catalog as labeled options, with the current value guaranteed
 *  present (so an externally-set custom zone still shows selected). */
function timezoneOptions(current: string): readonly (readonly [string, string])[] {
    const options = TIMEZONES.map((t) => [t.value, tzMenuLabel(t.value, t.label)] as const);
    const normalized = normalizeTimezone(current);
    if (TIMEZONES.some((t) => t.value === normalized)) return options;
    return [[normalized, tzMenuLabel(normalized, normalized)] as const, ...options];
}

