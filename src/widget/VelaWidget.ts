// DEPRECATED — `VelaWidget` is now a thin wrapper over `VelaWorkspace` pinned to the
// single-cell layout (`layout: false`), kept one deprecation cycle so existing hosts
// migrate on their own schedule. It will be removed in a future release; new code
// should construct the workspace directly:
//
//     new VelaWorkspace(container, { ...chartAndShellOptions, layout: false })
//
// Dropped with the old implementation (no longer supported here):
// - `urlState` (the `?symbol=…&interval=…` mirror) — accepted, ignored, warned about.
// - The pre-unified THREE-KEY persistence migration (`<key>` + `:config` +
//   `:drawings`). Unified-format documents (every save since the format landed)
//   restore unchanged — the widget always persisted the workspace document with a
//   single `c1` cell, and that is exactly what the workspace reads back.
import { VelaWorkspace } from '../workspace/VelaWorkspace';
import type { Vela } from '../Vela';
import type { VelaOptions, VelaTheme, ThemeName, MarketSession } from '../core/options';
import type { WorkspaceState } from '../state/document';
import type { VelaShellOptions } from './shell-options';
import type { WidgetContext } from './contributions';
import type { WidgetHistory } from './history';
import type { KeymapManager } from '../ui/keymap';
import type { RangePreset } from './bottombar';

export interface VelaWidgetOptions extends VelaOptions, VelaShellOptions {
    /** @deprecated No longer supported — the option is ignored (a console warning
     *  says so). Mirror `getState()` into your own URL scheme if you need links. */
    urlState?: boolean;
}

let deprecationWarned = false;

/**
 * @deprecated Use {@link VelaWorkspace} with `layout: false` — the same chart, the
 * same options, the same persisted state (pass `persist: 'vela-widget'` to keep
 * reading this class's storage key). This wrapper delegates everything and will be
 * removed in a future release.
 */
export class VelaWidget {
    private readonly ws: VelaWorkspace;

    constructor(container: HTMLElement | string, opts: VelaWidgetOptions) {
        if (!deprecationWarned) {
            deprecationWarned = true;
            console.warn(
                '[vela] VelaWidget is deprecated and will be removed in a future release. ' +
                    "Use `new VelaWorkspace(container, { ...options, layout: false })` — pass `persist: 'vela-widget'` to keep the same stored state. " +
                    (opts.urlState ? 'The `urlState` option is no longer supported and was ignored.' : ''),
            );
        }
        const { urlState: _urlState, height: _height, persist, ...rest } = opts;
        this.ws = new VelaWorkspace(container, {
            ...rest,
            layout: false,
            // The widget's historical storage key — existing persisted state restores.
            persist: persist === true ? 'vela-widget' : persist,
        });
    }

    /** The shell root element (the workspace root; carries `vela-widget` as an alias). */
    get root(): HTMLElement {
        this.ws.root.classList.add('vela-widget');
        return this.ws.root;
    }

    get keymap(): KeymapManager {
        return this.ws.keymap;
    }

    /** The chart's unified undo timeline — resolve it fresh, never cache it. */
    get history(): WidgetHistory {
        return this.ws.active.history;
    }

    /** The inner headless chart. */
    get chart(): Vela {
        return this.ws.chart;
    }

    /** A fresh contribution context (the workspace's is a superset of the widget's). */
    context(): WidgetContext {
        return this.ws.context();
    }

    refreshActions(): void {
        this.ws.refreshActions();
    }

    setSymbol(symbol: string): void {
        this.ws.active.setSymbol(symbol);
    }

    setTimeframe(timeframe: string): void {
        this.ws.active.setTimeframe(timeframe);
    }

    setSession(session: MarketSession): void {
        this.ws.active.setSession(session);
    }

    setPriceStyle(style: string): void {
        this.ws.active.setPriceStyle(style);
    }

    setWatermarkVisible(visible: boolean): void {
        this.ws.active.setWatermarkVisible(visible);
    }

    setIndicatorTitlesVisible(visible: boolean): void {
        this.ws.active.setIndicatorTitlesVisible(visible);
    }

    setIndicatorValuesVisible(visible: boolean): void {
        this.ws.active.setIndicatorValuesVisible(visible);
    }

    setTheme(theme: ThemeName | VelaTheme): void {
        this.ws.setTheme(theme);
    }

    setTimezone(zone: string): void {
        this.ws.setTimezone(zone);
    }

    applyRange(preset: RangePreset): void {
        this.ws.active.applyRange(preset);
    }

    /** The unified state document (`layout: '1'`, one cell). */
    getState(): WorkspaceState {
        return this.ws.getState();
    }

    /** Restore a state document IN PLACE — the chart instance survives. */
    applyState(state: unknown): void {
        this.ws.applyState(state);
    }

    /** Subscribe to `state:changed` (the only widget event — unknown names no-op). */
    on(event: 'state:changed', handler: () => void): () => void {
        if (event !== 'state:changed') return () => undefined;
        return this.ws.on('state:changed', handler);
    }

    destroy(): void {
        this.ws.destroy();
    }
}
