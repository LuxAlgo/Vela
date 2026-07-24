import type { VelaTheme } from '../../../core/options';
import type { ChartConfig } from '../core/chartConfig';
import { chartType, chartTypes } from '../../../chart-types/registry';
import { colorField, closeColorPopover } from './ColorField';
import { priceStyleIds } from '../core/chartConfig';

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
 * dependency-free and themed to match the chart, mirroring `InputsUI`/`DataWindow`.
 */

/** A host-contributed settings row: callback-based (the host owns the state). */
export type HostSettingsRow =
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

/** The reference control styles (checkbox, selects/inputs, swatches, scrollbars). */
function ensureControlStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(SD_STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = SD_STYLE_ID;
    st.textContent = `
.vela-sd-check{width:18px;height:18px;flex:none;display:inline-flex;align-items:center;justify-content:center;padding:0;border:1px solid #34353b;border-radius:5px;background:transparent;color:transparent;cursor:pointer;}
.vela-sd-check:hover{border-color:#868a96;}
.vela-sd-check.on{background:#ffffff;border-color:#ffffff;color:#16181d;}
.vela-sd-check svg{display:block;}
.vela-sd-select,.vela-sd-number{height:28px;background:#151619;border:1px solid #2a2b30;border-radius:4px;color:#d1d4dc;padding:0 8px;font-size:13px;outline:none;font-family:inherit;}
.vela-sd-select:hover,.vela-sd-number:hover{border-color:#34353b;}
.vela-sd-number{width:64px;}
.vela-sd-color{width:32px;height:26px;padding:0;border:1px solid #2a2b30;border-radius:4px;background:transparent;cursor:pointer;-webkit-appearance:none;appearance:none;}
.vela-sd-color::-webkit-color-swatch-wrapper{padding:2px;}
.vela-sd-color::-webkit-color-swatch{border:none;border-radius:2px;}
.vela-sd-pane::-webkit-scrollbar{width:8px;}
.vela-sd-pane::-webkit-scrollbar-thumb{background:rgba(209,212,220,0.25);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}
.vela-sd-pane::-webkit-scrollbar-track{background:transparent;}
.vela-sd-toggle{position:relative;width:38px;height:22px;border-radius:11px;background:#1c1d20;border:1px solid #2a2b30;cursor:pointer;flex:none;padding:0;}
.vela-sd-toggle::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#868a96;transition:transform .16s ease,background .16s ease;}
.vela-sd-toggle.on{background:rgba(255,255,255,0.08);border-color:#ffffff;}
.vela-sd-toggle.on::after{transform:translateX(16px);background:#ffffff;}
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

    /** Host-app sections (e.g. the widget's Status line tab) — re-shown on next open. */
    setHostSections(sections: HostSettingsSection[]): void {
        this.hostSections = sections;
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
            this.close();
            if (cfg && oc) this.open(cfg, oc, oi ?? undefined);
        }
    }

    isOpen(): boolean {
        return this.root !== null;
    }

    /** Toggle the dialog; `config` is the current resolved config to seed controls. */
    toggle(config: ChartConfig, onChange: (patch: ConfigPatch) => void, onImport?: (json: unknown) => void, onReset?: () => void): void {
        if (this.root) this.close();
        else this.open(config, onChange, onImport, onReset);
    }

    open(config: ChartConfig, onChange: (patch: ConfigPatch) => void, onImport?: (json: unknown) => void, onReset?: () => void): void {
        this.close();
        this.config = config;
        this.onChange = onChange;
        this.onImport = onImport ?? null;
        this.onReset = onReset ?? null;
        const t = this.theme;

        // Scrim + centered box — the reference settings-dialog shell (top-aligned modal,
        // left tab rail, scrollable pane, footer). Section markers emitted by `section()`
        // are post-processed into tabs below.
        ensureControlStyles();
        const scrim = document.createElement('div');
        scrim.style.cssText = 'position:absolute;inset:0;z-index:21;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.45);padding-top:8vh;pointer-events:auto;';
        scrim.addEventListener('mousedown', (e) => {
            if (e.target === scrim) this.close();
        });

        const dlg = document.createElement('div');
        dlg.style.cssText = `width:min(720px,94vw);max-height:70vh;display:flex;flex-direction:column;background:${t.background};border:1px solid ${withAlpha(t.textColor, 0.16)};border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:${t.textColor};font:13px -apple-system,Segoe UI,sans-serif;overflow:hidden;`;

        const header = document.createElement('div');
        header.style.cssText = `display:flex;justify-content:space-between;align-items:center;padding:9px 9px 9px 16px;border-bottom:1px solid ${t.borderColor};flex:0 0 auto;user-select:none;`;
        const hTitle = document.createElement('span');
        hTitle.textContent = 'Chart settings';
        hTitle.style.cssText = 'font-size:17px;font-weight:600;letter-spacing:0.2px;';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close';
        closeBtn.style.cssText = `cursor:pointer;background:transparent;border:none;color:${withAlpha(t.textColor, 0.65)};font-size:15px;line-height:1;width:30px;height:30px;border-radius:4px;`;
        closeBtn.addEventListener('click', () => this.close());
        header.append(hTitle, closeBtn);
        header.style.cursor = 'move';
        {
            let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
            header.addEventListener('pointerdown', (e) => {
                if (e.target === closeBtn) return;
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
        showActive(config.series.style);

        body.append(this.sectionTitle('Time zone'));
        body.append(this.selectRow('Time zone', config.timeScale.timezone, timezoneOptions(config.timeScale.timezone), (v) => this.emit({ timeScale: { timezone: v } })));

        // ══ HOST SECTIONS — tabs contributed by the embedding app (widget Status line…) ══
        const renderHostSections = (placement: 'after-symbol' | 'end' | 'symbol'): void => {
            for (const hs of this.hostSections) {
                if ((hs.placement ?? 'after-symbol') !== placement) continue;
                // 'symbol' inlines rows into the CURRENT pane (a section title, no tab).
                body.append(placement === 'symbol' ? this.sectionTitle(hs.title) : this.section(hs.title));
                for (const hr of hs.rows) {
                    if (hr.kind === 'toggle') body.append(this.boolRow(hr.label, hr.get(), (v) => hr.set(v)));
                    else body.append(this.selectRowLabeled(hr.label, hr.get() as string, hr.options.map((o) => [o, o] as const), (v) => hr.set(v)));
                }
            }
        };
        // 'symbol' rows FIRST — they must land before any host TAB marker, or the
        // split walker files them into that tab's pane instead of Symbol's.
        renderHostSections('symbol');
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

        // ══ CHART-TYPE SDK SECTIONS — each registered type's declarative settings tab.
        //    visibility 'active' (default) shows the tab only while the style is active;
        //    'always' keeps it visible. Values persist under config.chartTypes[<id>] and
        //    are pushed to the `<id>-settings` channel by the renderer's applyConfig.
        for (const def of chartTypes()) {
            const section = def.settings;
            if (!section) continue;
            const marker = this.section(section.title);
            marker.dataset.sdStyle = def.id;
            marker.dataset.sdVisibility = section.visibility ?? 'active';
            body.append(marker);
            const values = config.chartTypes[def.id] ?? {};
            for (const r of section.rows) {
                const current = values[r.key];
                if (r.kind === 'toggle') {
                    body.append(this.boolRow(r.label, typeof current === 'boolean' ? current : r.defval, (v) => this.emitType(def.id, r.key, v)));
                } else if (r.kind === 'number') {
                    body.append(this.numberRow(r.label, typeof current === 'number' ? current : r.defval, r.min ?? 0, r.max ?? 1_000_000, r.step ?? 1, (v) => this.emitType(def.id, r.key, v)));
                } else if (r.kind === 'color') {
                    body.append(this.colorRow(r.label, typeof current === 'string' ? current : r.defval, (v) => this.emitType(def.id, r.key, v)));
                } else {
                    body.append(this.selectRow(r.label, typeof current === 'string' ? current : r.defval, [...r.options], (v) => this.emitType(def.id, r.key, v)));
                }
            }
        }

        renderHostSections('end');

        // ── Split the linear sections into a left tab rail + one pane per section ──
        const shell = document.createElement('div');
        shell.style.cssText = 'display:flex;min-height:360px;max-height:calc(70vh - 100px);flex:1 1 auto;';
        const rail = document.createElement('div');
        rail.style.cssText = `flex:0 0 170px;display:flex;flex-direction:column;gap:2px;padding:10px 8px;border-right:1px solid ${t.borderColor};overflow-y:auto;`;
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
                tab.style.cssText = `text-align:left;padding:9px 12px;background:transparent;border:none;border-radius:6px;color:${withAlpha(t.textColor, 0.62)};font:600 13px inherit;font-family:inherit;cursor:pointer;`;
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
                p.tab.style.background = i === idx ? withAlpha(t.textColor, 0.07) : 'transparent';
                p.tab.style.color = i === idx ? t.textColor : withAlpha(t.textColor, 0.62);
            });
        };
        panes.forEach((p, i) => {
            p.tab.addEventListener('click', () => activate(i));
            rail.appendChild(p.tab);
            paneHost.appendChild(p.el);
        });
        activate(0);
        this.syncTypeTabs?.(config.series.style);

        shell.append(rail, paneHost);
        dlg.appendChild(shell);
        dlg.appendChild(this.footer(config));

        scrim.appendChild(dlg);
        this.container.appendChild(scrim);
        this.root = scrim;
    }

    close(): void {
        closeColorPopover();
        this.root?.remove();
        this.root = null;
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

    /** In-pane section title (the reference `set-section-title`). */
    private sectionTitle(text: string): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = `margin:14px 0 2px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${withAlpha(this.theme.textColor, 0.55)};`;
        el.textContent = text;
        return el;
    }

    /** Thin horizontal rule between row clusters (the reference `set-separator`). */
    private separator(): HTMLElement {
        const el = document.createElement('div');
        el.style.cssText = `height:1px;margin:8px 0;background:${withAlpha(this.theme.textColor, 0.1)};`;
        return el;
    }

    /** A bare color swatch input (for toggle-row right groups / swatch pairs). */
    private swatch(value: string, onChange: (v: string) => void): HTMLElement {
        let current = value;
        return colorField(this.theme, () => current, (v) => { current = v; onChange(v); });
    }

    /** A label row with arbitrary right-aligned controls (no toggle). */
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
        el.style.cssText = 'display:contents;';
        return el;
    }

    private row(label: string): { wrap: HTMLLabelElement } {
        const wrap = document.createElement('label');
        wrap.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:24px;padding:8px 0;border-bottom:1px solid ${withAlpha(this.theme.textColor, 0.07)};`;
        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
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

    /** An enable row: checkbox + label on the left, dependent controls right-aligned;
     *  the control group dims and ignores input while the toggle is off. With no
     *  controls it reads like a plain toggle row. */
    private toggleRow(label: string, value: boolean, onToggle: (v: boolean) => void, controls: HTMLElement[]): HTMLElement {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:8px;min-height:22px;cursor:pointer;';
        const cb = document.createElement('button');
        cb.type = 'button';
        cb.className = 'vela-sd-check' + (value ? ' on' : '');
        cb.innerHTML = '<svg viewBox="0 0 10 8" width="10" height="8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m1 4 2.6 2.6L9 1"/></svg>';
        let checked = value;
        const cbToggle = (): boolean => {
            checked = !checked;
            cb.classList.toggle('on', checked);
            return checked;
        };
        const lbl = document.createElement('span');
        lbl.textContent = label;
        lbl.style.cssText = 'opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        wrap.append(cb, lbl);
        if (controls.length === 0) {
            cb.addEventListener('click', () => onToggle(cbToggle()));
            return wrap;
        }
        const box = document.createElement('div');
        box.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;flex:0 0 auto;';
        for (const c of controls) box.appendChild(c);
        const syncDim = (on: boolean): void => {
            box.style.opacity = on ? '1' : '0.4';
            box.style.pointerEvents = on ? '' : 'none';
        };
        syncDim(value);
        cb.addEventListener('click', () => { const v = cbToggle(); onToggle(v); syncDim(v); });
        wrap.appendChild(box);
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
        sel.style.cssText = 'max-width:180px;flex:0 0 auto;';
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
        sel.style.cssText = 'max-width:180px;flex:0 0 auto;';
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
        const t = this.theme;
        // Reference footer: actions only (Reset defaults, left-aligned). The JSON
        // export/import lives on the public API (getConfig/applyConfig), not in the UI.
        const foot = document.createElement('div');
        foot.style.cssText = `border-top:1px solid ${t.borderColor};padding:10px 14px;display:flex;align-items:center;justify-content:flex-start;gap:8px;flex:0 0 auto;`;
        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = 'Reset defaults';
        resetBtn.style.cssText = `height:30px;padding:0 14px;font-size:12px;color:${t.textColor};background:#1c1d20;border:1px solid ${t.borderColor};border-radius:6px;cursor:pointer;font-family:inherit;`;
        resetBtn.addEventListener('mouseenter', () => (resetBtn.style.borderColor = '#34353b'));
        resetBtn.addEventListener('mouseleave', () => (resetBtn.style.borderColor = t.borderColor));
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
        const t = this.theme;
        return `background:${withAlpha(t.textColor, 0.08)};border:1px solid ${t.borderColor};color:${t.textColor};border-radius:4px;padding:3px 6px;font:12px inherit;outline:none;`;
    }
}

const AUTO_MANUAL_OPTS: readonly (readonly [string, string])[] = [['auto', 'Auto'], ['manual', 'Manual']];

const FONT_FAMILIES = ['sans-serif', 'serif', 'monospace', 'Arial', 'Helvetica', 'Georgia', 'Courier New', '-apple-system, Segoe UI, sans-serif'];
const LINE_STYLES = ['solid', 'dashed', 'dotted'];
const COMMON_ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Kolkata', 'Australia/Sydney'];

/** Curated zone list with the current value guaranteed present (so it shows selected). */
function timezoneOptions(current: string): string[] {
    return COMMON_ZONES.includes(current) ? COMMON_ZONES : [current, ...COMMON_ZONES];
}

function toHex6(color: string): string {
    const m = /^#([0-9a-fA-F]{6})/.exec(color.trim());
    if (m) return `#${m[1]}`;
    // rgb()/rgba() → hex (color inputs only accept #rrggbb)
    const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
    if (rgb) {
        const h = (n: string): string => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
        return `#${h(rgb[1] ?? '0')}${h(rgb[2] ?? '0')}${h(rgb[3] ?? '0')}`;
    }
    return '#888888';
}

function withAlpha(color: string, alpha: number): string {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(color.trim());
    if (!m) return color;
    const r = parseInt(m[1] ?? '0', 16);
    const g = parseInt(m[2] ?? '0', 16);
    const b = parseInt(m[3] ?? '0', 16);
    return `rgba(${r},${g},${b},${alpha})`;
}
