import type { AxisLongPressEvent, CrosshairEvent, DataWindowReadout, IChartRenderer, LegendActionView, LegendCalloutView, RendererCapabilities } from './ports/IChartRenderer';
import type { Unsubscribe } from './util/types';
import type { SymbolPickerFn } from './model/inputs';

/**
 * The public control surface for the active renderer — `chart.renderer`. A thin
 * facade over the renderer port: get/set/inspect render features without exposing
 * the internal orchestration methods (`setBars`, `mountIndicator`, …). A key the
 * active renderer doesn't support warns in the console and is ignored — the chart
 * is never touched.
 */
export class RendererControl {
    constructor(private readonly renderer: IChartRenderer) {}

    /** The active renderer's identity, e.g. `'native'` or `'lwc'`. */
    get name(): string {
        return this.renderer.name;
    }

    /** What the active renderer can draw (drives graceful degradation). */
    get capabilities(): RendererCapabilities {
        return this.renderer.capabilities;
    }

    /** Whether the active renderer supports a feature — use to show/hide a UI control. */
    supports(feature: string): boolean {
        return this.renderer.features.includes(feature);
    }

    /** Read a feature's current value (`undefined` if unsupported). */
    get(feature: string): unknown {
        return this.renderer.readFeature(feature);
    }

    /**
     * Set one feature (`set('glow', 0.6)`) or several at once
     * (`set({ logScale: true, upColor: '#fff' })`). A key the active renderer does
     * not support emits a console warning and is ignored, with no effect on the UI.
     */
    set(feature: string | Record<string, unknown>, value?: unknown): this {
        const entries: [string, unknown][] = typeof feature === 'string' ? [[feature, value]] : Object.entries(feature);
        for (const [key, val] of entries) {
            if (this.renderer.features.includes(key)) this.renderer.applyFeature(key, val);
            else console.warn(`[vela] renderer "${this.renderer.name}" has no feature "${key}" — set ignored.`);
        }
        return this;
    }

    /**
     * Wire the legend rows' HOST-CONTRIBUTED actions (the shells route the plugin
     * registry through this; see `registerLegendAction`). Silent on a renderer without
     * the seam — contributed legend actions simply never show there, same graceful
     * degradation as the sync ghost crosshair.
     */
    setLegendActions(provider: ((indicatorId: string) => LegendActionView[]) | null): void {
        this.renderer.setLegendActions?.(provider);
    }

    /**
     * Wire the legend rows' HOST-CONTRIBUTED callout bubbles (the shells route the
     * plugin registry through this; see `registerLegendCallout`). Silent on a renderer
     * without the seam — contributed callouts simply never show there, same graceful
     * degradation as {@link setLegendActions}.
     */
    setLegendCallouts(provider: ((indicatorId: string) => LegendCalloutView[]) | null): void {
        this.renderer.setLegendCallouts?.(provider);
    }

    /**
     * Replace the indicator legend's fold toggle with a host action (or restore it with
     * `null`) — multi-chart shells point the chip at their indicator overview instead of
     * unfolding rows in place. Silent no-op on a renderer without a foldable legend.
     */
    setLegendOverviewAction(action: (() => void) | null): this {
        this.renderer.setLegendOverviewAction?.(action);
        return this;
    }

    /** Whether the active renderer can open a per-indicator settings dialog. */
    get supportsIndicatorSettings(): boolean {
        return typeof this.renderer.openIndicatorSettings === 'function';
    }

    /**
     * Open one indicator's settings dialog — the programmatic twin of the legend gear
     * (see {@link supportsIndicatorSettings}). Silent no-op without the seam or for an
     * unknown id.
     */
    openIndicatorSettings(indicatorId: string): this {
        this.renderer.openIndicatorSettings?.(indicatorId);
        return this;
    }

    /**
     * Export the current chart as a PNG data URL, or null if the active renderer
     * doesn't support it (warns). DOM overlays (tables, legend) are not included.
     */
    screenshot(): string | null {
        if (typeof this.renderer.screenshot === 'function') return this.renderer.screenshot();
        console.warn(`[vela] renderer "${this.renderer.name}" does not support screenshot().`);
        return null;
    }

    /**
     * Raster of the current chart onto a canvas (same pixels as {@link screenshot}),
     * or null if the renderer has no canvas export. Silent — a host compositing
     * several charts skips a renderer that cannot contribute.
     */
    screenshotCanvas(): HTMLCanvasElement | null {
        if (typeof this.renderer.screenshotCanvas === 'function') return this.renderer.screenshotCanvas();
        return null;
    }

    /**
     * The active renderer's full cosmetic config as a serializable, versioned JSON
     * document — persist it (templates, saved settings) and feed it back to
     * `applyConfig`. Returns null if the renderer has no rich config (warns).
     */
    getConfig(): unknown {
        if (typeof this.renderer.getConfig === 'function') return this.renderer.getConfig();
        console.warn(`[vela] renderer "${this.renderer.name}" does not support getConfig().`);
        return null;
    }

    /**
     * Apply a (possibly partial) config document from `getConfig()` — load a template
     * or restore saved settings. Malformed/unknown fields are ignored; no indicator
     * re-run. No-ops with a warning if the renderer has no rich config.
     */
    applyConfig(config: unknown): this {
        if (typeof this.renderer.applyConfig === 'function') this.renderer.applyConfig(config);
        else console.warn(`[vela] renderer "${this.renderer.name}" does not support applyConfig().`);
        return this;
    }

    /**
     * Subscribe to cosmetic-config changes (`applyConfig` — the in-chart settings dialog
     * commits through it). Host chrome that mirrors a config value (a bottom-bar timezone)
     * re-pulls {@link get}/{@link getConfig} here. Silent no-op unsubscribe on a renderer
     * without a rich config.
     */
    onConfigChanged(cb: () => void): Unsubscribe {
        return this.renderer.onConfigChanged?.(cb) ?? (() => undefined);
    }

    /**
     * Subscribe to crosshair movement — `time`/`price` under the cursor, per-series values,
     * and the hovered bar's OHLC (null fields when the cursor leaves the chart). This is the
     * public seam host chrome (status lines, data windows) builds on.
     */
    onCrosshairMove(cb: (e: CrosshairEvent) => void): Unsubscribe {
        return this.renderer.onCrosshairMove(cb);
    }

    /** Touch long-press on a price or time axis strip — silent no-op without the seam. */
    onAxisLongPress(cb: (e: AxisLongPressEvent) => void): Unsubscribe {
        return this.renderer.onAxisLongPress?.(cb) ?? (() => undefined);
    }

    /**
     * The current data-window readout — the hovered bar's date/time and OHLCV plus every
     * indicator's value there, each already formatted on its pane's scale (the latest bar when
     * the cursor is off the plot). Pair it with {@link onCrosshairMove} to drive a data-window
     * panel. Null on a renderer that doesn't provide the readout.
     */
    dataWindowReadout(): DataWindowReadout | null {
        return this.renderer.getDataWindowReadout?.() ?? null;
    }

    /**
     * Wire (or clear with `null`) the host's symbol picker for the settings dialog's `input.symbol`
     * control — the host opens its own ticker-selection UI and reports the chosen symbol back.
     * No-ops with a warning if the active renderer doesn't support it (only the native renderer does).
     */
    setSymbolPicker(picker: SymbolPickerFn | null): this {
        if (typeof this.renderer.setSymbolPicker === 'function') this.renderer.setSymbolPicker(picker);
        else console.warn(`[vela] renderer "${this.renderer.name}" does not support setSymbolPicker().`);
        return this;
    }

    /**
     * Move keyboard focus back onto the chart's interactive surface — call after a host
     * control (a shared toolbar button) stole focus, so chart/drawing shortcuts keep
     * working. Silent no-op on a renderer without a focusable surface.
     */
    focus(): this {
        this.renderer.focus?.();
        return this;
    }

    /** Whether the active renderer can display an EXTERNAL (synced) crosshair. */
    get supportsExternalCrosshair(): boolean {
        return typeof this.renderer.setExternalCrosshair === 'function';
    }

    /**
     * Show (or clear, with `null`) a data-space ghost crosshair driven from OUTSIDE
     * this chart — the multi-chart crosshair-sync seam. Silent no-op on a renderer
     * without the capability (see {@link supportsExternalCrosshair}).
     */
    setExternalCrosshair(time: number | null, price: number | null = null): this {
        this.renderer.setExternalCrosshair?.(time, price);
        return this;
    }

    /**
     * Close any in-chart dialogs the active renderer owns (indicator settings, chart-settings
     * gear) — for keeping host dialogs mutually exclusive with the renderer's. Silent no-op if
     * the renderer has no such dialogs; safe to call speculatively.
     */
    closeDialogs(): this {
        this.renderer.closeDialogs?.();
        return this;
    }

    /**
     * Open (or toggle) the renderer's in-chart settings dialog — silent no-op without one.
     * Pass a section title (e.g. `'Canvas'`) to land on that tab; an unknown one opens the
     * dialog on its first tab, and with a section an open dialog switches tab instead of closing.
     */
    openSettings(section?: string): this {
        this.renderer.openSettingsDialog?.(section);
        return this;
    }

    /** Contribute host settings tabs (callback rows) to the renderer's settings dialog —
     *  e.g. the widget's Status line toggles. Silent no-op without a dialog. */
    setSettingsSections(sections: ReadonlyArray<{ title: string; rows: readonly unknown[]; id?: string }>): this {
        this.renderer.setSettingsSections?.(sections);
        return this;
    }

    /**
     * Set the settings-dialog visibility policy: `hidden` lists setting ids to hide —
     * a tab (`'canvas'`), a group (`'canvas.grid'`), or a single row
     * (`'canvas.grid.vertical'`); an id hides its whole subtree, and a tab with nothing
     * left disappears from the rail. Presentation-only: hidden values keep being stored
     * and applied (e.g. hide `'advanced'` while forcing the widget's `bars` option).
     * Seeded from `VelaOptions.settings`; silent no-op without a settings dialog.
     */
    setSettingsVisibility(policy: { hidden?: readonly string[] }): this {
        this.renderer.setSettingsVisibility?.(policy);
        return this;
    }

    /** Every addressable setting id of this chart (built-in tabs/groups/rows, chart-type
     *  sections, host sections) — enumerate these to build a `hidden` list instead of
     *  reading contributor source. Empty on a renderer without a settings dialog. */
    listSettingsIds(): string[] {
        return this.renderer.listSettingsIds?.() ?? [];
    }

    /** Tell the renderer's own chrome which size class the host shell is in —
     *  `'mobile'` switches its dialogs/toolbars to the touch-first presentation.
     *  Silent no-op on a renderer without adaptive chrome. */
    setLayoutMode(mode: 'mobile' | 'desktop'): this {
        this.renderer.setLayoutMode?.(mode);
        return this;
    }
}
