import type { CrosshairEvent, IChartRenderer, RendererCapabilities } from './ports/IChartRenderer';
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
     * Export the current chart as a PNG data URL, or null if the active renderer
     * doesn't support it (warns). DOM overlays (tables, legend) are not included.
     */
    screenshot(): string | null {
        if (typeof this.renderer.screenshot === 'function') return this.renderer.screenshot();
        console.warn(`[vela] renderer "${this.renderer.name}" does not support screenshot().`);
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
     * Subscribe to crosshair movement — `time`/`price` under the cursor, per-series values,
     * and the hovered bar's OHLC (null fields when the cursor leaves the chart). This is the
     * public seam host chrome (status lines, data windows) builds on.
     */
    onCrosshairMove(cb: (e: CrosshairEvent) => void): Unsubscribe {
        return this.renderer.onCrosshairMove(cb);
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
     * Close any in-chart dialogs the active renderer owns (indicator settings, chart-settings
     * gear) — for keeping host dialogs mutually exclusive with the renderer's. Silent no-op if
     * the renderer has no such dialogs; safe to call speculatively.
     */
    closeDialogs(): this {
        this.renderer.closeDialogs?.();
        return this;
    }

    /** Open (or toggle) the renderer's in-chart settings dialog — silent no-op without one. */
    openSettings(): this {
        this.renderer.openSettingsDialog?.();
        return this;
    }

    /** Contribute host settings tabs (callback rows) to the renderer's settings dialog —
     *  e.g. the widget's Status line toggles. Silent no-op without a dialog. */
    setSettingsSections(sections: ReadonlyArray<{ title: string; rows: readonly unknown[] }>): this {
        this.renderer.setSettingsSections?.(sections);
        return this;
    }
}
