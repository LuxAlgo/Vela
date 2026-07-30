import type { InputSchema, InputValue, SymbolPickerFn } from '../../core/model/inputs';
import type { VelaTheme, MoveTarget } from '../../core/options';
import { isDarkColor, toHex6 } from '../../core/color';
import { iconAt } from '../../core/icons';
import { applyChromeTokens } from './theme-tokens';
import { makeDialogDraggable } from './dialogDragging';

/** A pane as the legend move UI sees it (id + label + vertical bounds, top-to-bottom order). */
export interface LegendPaneView {
    id: string;
    kind: 'price' | 'study';
    label: string;
    top: number;
    height: number;
}

/** Host hook that lets the legend move/merge an indicator (present iff pane management is supported). */
export interface LegendMoveApi {
    panes(): LegendPaneView[];
    move(id: string, target: MoveTarget): void;
}

/** Emitted when the user edits an input in the in-chart settings dialog. */
export interface InputsUIChange {
    indicatorId: string;
    key: string;
    value: InputValue;
}

interface LegendRow {
    id: string;
    title: string;
    inputs: InputSchema[];
    values: Record<string, InputValue>;
    el: HTMLElement;
    titleEl: HTMLElement;
    statusEl: HTMLElement;
    paneId: string;
    hidden: boolean;
    eyeEl: HTMLButtonElement | null;
    /** Wraps the eye/gear/✕ controls; only shown while the row is selected (outline visible). */
    controlsEl: HTMLElement;
    native: boolean;
}

const SOURCES = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];
/** Keyframes for the legend-row status affordances (spinner + live pulse), injected once into the document. */
const STATUS_KEYFRAMES =
    '@keyframes vela-ind-spin{to{transform:rotate(360deg)}}@keyframes vela-ind-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}';

/** Legend glyph size — the row's own font belongs to the indicator title beside them. */
const LEGEND_ICON_PX = 13;
const EYE_SVG = iconAt('eye', LEGEND_ICON_PX);
const EYE_OFF_SVG = iconAt('eye-off', LEGEND_ICON_PX);

/**
 * Chart-style inputs UI built on top of lightweight-charts (which has no
 * legend/settings chrome). Renders a per-indicator legend (title + gear + remove)
 * as a DOM overlay on the chart container, and an auto-generated settings dialog
 * from each indicator's `InputSchema[]`. Edits are reported via `setOnChange` and
 * the ✕ remove via `setOnRemove`; the core re-runs / tears down the indicator.
 *
 * Legends are grouped by pane: when a `paneBoundsOf` resolver is supplied, each
 * pane gets its own legend container positioned at the top of that pane (so a
 * study's legend sits in its pane, not the price pane). Without the resolver every
 * legend stacks at the top of the container.
 */
export class InputsUI {
    private readonly legends = new Map<string, HTMLElement>(); // paneId → legend container
    private readonly rows = new Map<string, LegendRow>();
    private dialog: HTMLElement | null = null;
    private backdrop: HTMLElement | null = null;
    private openId: string | null = null;
    /** The legend row the user has clicked to select (gets a neutral outline); null when none. */
    private selectedId: string | null = null;
    /** Values captured when the dialog opened, so Cancel can revert live edits. */
    private snapshot: Record<string, InputValue> | null = null;
    private onChange: ((c: InputsUIChange) => void) | null = null;
    private onRemove: ((id: string) => void) | null = null;
    private onToggleVisible: ((id: string, visible: boolean) => void) | null = null;
    /** Host symbol picker for `input.symbol`; when set the control opens the host's ticker UI. */
    private symbolPicker: SymbolPickerFn | null = null;
    /** Pane move/merge hook — when set, rows get a "Move to" menu + become drag-to-pane sources. */
    private moveApi: LegendMoveApi | null = null;
    /** Open "Move to" menu (kept so it can be torn down). */
    private moveMenu: HTMLElement | null = null;
    /** Collapsed panes → the master indicator id to keep visible (others hidden in the strip). */
    private paneCollapse = new Map<string, string | null>();
    /** Esc-to-close for the settings modal (bound so focus can sit anywhere). */
    private readonly onDialogKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.closeDialog();
        }
    };
    /** Clear the selection outline when the user clicks anywhere that isn't one of our legend rows. */
    private readonly onDocClick = (e: MouseEvent): void => {
        if (!this.selectedId) return;
        const target = e.target as Node | null;
        if (target) {
            for (const row of this.rows.values()) if (row.el.contains(target)) return;
        }
        this.clearSelection();
    };

    /** Where the MODAL settings dialog mounts (default: the container). Multi-chart
     *  shells point this at their root so the dialog centers globally — the inline
     *  pane-anchored rows always stay in the container. */
    private dialogHost: HTMLElement | null = null;

    setDialogHost(host: HTMLElement | null): void {
        this.dialogHost = host;
        if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    }

    constructor(
        private readonly container: HTMLElement,
        private theme: VelaTheme,
        private readonly paneBoundsOf?: (paneId: string) => { top: number; height: number },
    ) {
        if (!container.style.position) container.style.position = 'relative';
        if (typeof document !== 'undefined') document.addEventListener('click', this.onDocClick);
    }

    setOnChange(cb: (c: InputsUIChange) => void): void {
        this.onChange = cb;
    }

    /** Report a ✕ legend click so the core can tear down that indicator. */
    setOnRemove(cb: (id: string) => void): void {
        this.onRemove = cb;
    }

    /**
     * Report an eye legend click so the core can hide/show that indicator. Setting this also
     * enables the eye control on every row (gated, so a renderer that can't suspend an indicator
     * — i.e. never calls this — simply shows no eye).
     */
    setOnToggleVisible(cb: (id: string, visible: boolean) => void): void {
        this.onToggleVisible = cb;
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
    }

    /** Provide (or clear) the host symbol picker that `input.symbol` opens on activation. */
    setSymbolPicker(picker: SymbolPickerFn | null): void {
        this.symbolPicker = picker;
    }

    /** Enable legend-driven move/merge (a "Move to" menu + drag-to-pane). Null disables it. */
    setMoveApi(api: LegendMoveApi | null): void {
        this.moveApi = api;
    }

    /** Reposition the per-pane legend containers after a layout change. */
    reposition(): void {
        for (const [paneId, lg] of this.legends) this.positionLegend(lg, paneId);
    }

    // ── legend move/merge (menu + drag) ─────────────────────────────────────

    /** Open the "Move to" menu for a row, anchored under its move button. */
    private openMoveMenu(id: string, anchor: HTMLElement): void {
        this.closeMoveMenu();
        const api = this.moveApi;
        if (!api) return;
        const row = this.rows.get(id);
        const currentPane = row?.paneId ?? 'price';
        const panes = api.panes();
        const menu = document.createElement('div');
        menu.style.cssText = `position:fixed;z-index:var(--vela-z-tooltip);min-width:150px;padding:4px;border-radius:var(--vela-radius-md);background:var(--vela-surface-elev);color:${this.theme.textColor};border:1px solid var(--vela-border);box-shadow:var(--vela-shadow);font-size:var(--vela-font-size-md);`;
        applyChromeTokens(menu, this.theme);
        const items: Array<{ label: string; target: MoveTarget }> = [];
        for (const p of panes) {
            if (p.id === currentPane) continue;
            items.push({ label: `Move to ${p.label}`, target: p.kind === 'price' ? 'price' : { pane: p.id } });
        }
        // Offer only moves that actually change something:
        //  • the sole indicator of a study pane owns it already — a "new pane" beside its own
        //    pane just recreates the same layout (the emptied pane dissolves), so skip both;
        //  • panes never sit above the price pane, so "New pane above" is meaningless there.
        const soleInStudyPane = currentPane !== 'price'
            && [...this.rows.values()].filter((r) => r.paneId === currentPane).length <= 1;
        if (!soleInStudyPane) {
            if (currentPane !== 'price') items.push({ label: 'New pane above', target: { newPane: { before: currentPane } } });
            items.push({ label: 'New pane below', target: { newPane: { after: currentPane } } });
        }
        for (const it of items) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = it.label;
            b.className = 'vela-ind-menuitem';
            b.style.cssText = 'display:block;width:100%;text-align:left;padding:6px 10px;border:none;border-radius:var(--vela-radius-sm);color:inherit;cursor:pointer;white-space:nowrap;';
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeMoveMenu();
                api.move(id, it.target);
            });
            menu.appendChild(b);
        }
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        // Clamp within the viewport so a bottom/right-edge row's menu stays visible.
        const mw = menu.offsetWidth || 160;
        const mh = menu.offsetHeight || 80;
        menu.style.left = `${Math.min(r.left, window.innerWidth - mw - 6)}px`;
        menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - mh - 6)}px`;
        this.moveMenu = menu;
        // Close on the next outside click (deferred so this same click doesn't immediately close it).
        setTimeout(() => {
            if (typeof document !== 'undefined') document.addEventListener('pointerdown', this.onMoveMenuOutside, true);
        }, 0);
    }

    private readonly onMoveMenuOutside = (e: Event): void => {
        if (this.moveMenu && !this.moveMenu.contains(e.target as Node)) this.closeMoveMenu();
    };

    private closeMoveMenu(): void {
        if (typeof document !== 'undefined') document.removeEventListener('pointerdown', this.onMoveMenuOutside, true);
        this.moveMenu?.remove();
        this.moveMenu = null;
    }

    /** Move a legend row to another pane (indicator merged/moved), tidying an emptied container. */
    setPane(id: string, paneId: string): void {
        const row = this.rows.get(id);
        if (!row || row.paneId === paneId) return;
        const prev = row.paneId;
        row.paneId = paneId;
        this.attach(this.legendFor(paneId), row.el, row.native);
        if (prev !== 'price') {
            const lg = this.legends.get(prev);
            if (lg && lg.childElementCount === 0) { lg.remove(); this.legends.delete(prev); }
        }
    }

    private legendFor(paneId: string): HTMLElement {
        let lg = this.legends.get(paneId);
        if (!lg) {
            lg = document.createElement('div');
            // Tag with the pane id so a host app can locate each pane's legend (and thus
            // its on-screen bounds) — e.g. to re-anchor its own per-pane overlays.
            lg.dataset.velaPane = paneId;
            lg.style.cssText =
                'position:absolute;left:10px;z-index:5;display:flex;flex-direction:column;align-items:flex-start;gap:3px;pointer-events:none;font:12px -apple-system,Segoe UI,sans-serif;';
            this.positionLegend(lg, paneId);
            this.container.appendChild(lg);
            this.legends.set(paneId, lg);
        }
        return lg;
    }

    private positionLegend(lg: HTMLElement, paneId: string): void {
        const bounds = this.paneBoundsOf ? this.paneBoundsOf(paneId) : { top: 0, height: Infinity };
        // A pane hidden by a maximize elsewhere collapses to ~0 height — hide its legend entirely
        // (a collapsed strip keeps a small height, so its title still shows).
        lg.style.display = bounds.height < 4 ? 'none' : '';
        // A collapsed pane is a legend-only strip: show just its master indicator's row. Restore
        // hidden rows to 'flex' (their intended layout — set in the row's cssText), NOT '' which
        // would revert them to block and break the inline button row (hide/show, settings, …).
        const collapsed = this.paneCollapse.has(paneId);
        const masterId = this.paneCollapse.get(paneId) ?? null;
        for (const row of this.rows.values()) {
            if (row.paneId !== paneId) continue;
            row.el.style.display = collapsed && row.id !== masterId ? 'none' : 'flex';
        }
        // Expanded panes inset the legend from the top; a collapsed strip is too short for that —
        // center the single master row in it so its hover controls (hide/show, settings, …) stay
        // fully inside the strip instead of spilling onto the pane separator / axis below.
        let top = bounds.top + 8;
        if (collapsed && Number.isFinite(bounds.height)) {
            const rowH = lg.offsetHeight || 20;
            top = bounds.top + Math.max(1, Math.round((bounds.height - rowH) / 2));
        }
        lg.style.top = `${top}px`;
    }

    /** Set which panes are collapsed and, for each, the master indicator to keep in its strip. */
    setCollapsedPanes(map: Map<string, string | null>): void {
        this.paneCollapse = map;
    }

    /** Create or update an indicator's legend row (in the legend for its pane). */
    upsert(id: string, title: string, inputs: InputSchema[], values: Record<string, InputValue>, paneId = 'price', opts: { native?: boolean; beta?: boolean } = {}): void {
        const existing = this.rows.get(id);
        if (existing) {
            existing.title = title;
            existing.inputs = inputs;
            existing.values = { ...values };
            existing.titleEl.textContent = title;
            if (existing.paneId !== paneId) { // re-routed to a different pane
                existing.paneId = paneId;
                this.attach(this.legendFor(paneId), existing.el, existing.native);
            }
            return;
        }
        const el = document.createElement('div');
        // Solid chart-background fill so the label stays readable over candles; hovering
        // reveals the outline and controls, and leaving hides them again unless selected.
        el.style.cssText = `pointer-events:auto;display:flex;align-items:center;gap:6px;background:${this.theme.background};border-radius:4px;padding:2px 7px;color:${this.theme.textColor};user-select:none;-webkit-user-select:none;`;
        el.addEventListener('mouseenter', () => this.setRowHighlighted(id, true));
        el.addEventListener('mouseleave', () => { if (this.selectedId !== id) this.setRowHighlighted(id, false); });
        // Left-click the row (but not one of its control buttons) selects the indicator,
        // outlining it with the same neutral border as the settings inputs; a double-click
        // opens its settings dialog. Clicks that land on the eye/gear/✕ buttons keep their
        // own behavior and never toggle selection.
        el.addEventListener('click', (e) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
            this.selectRow(id);
        });
        el.addEventListener('dblclick', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            this.openDialog(id);
        });
        // Moving an indicator to another pane is done through the row's "Move to" menu (below);
        // there is intentionally no drag-from-legend gesture (the object tree owns drag-and-drop).
        // Middle-click (mouse button 3) anywhere on the row removes the indicator — a fast
        // alternative to the ✕. Suppress the default middle-button autoscroll on press.
        el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
        el.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            e.preventDefault();
            this.onRemove?.(id);
        });
        // Status indicator (left of the title): a spinner while fetching, a pulse while live, hidden when idle.
        const statusEl = document.createElement('span');
        statusEl.style.cssText = 'display:none;box-sizing:border-box;flex:none;';
        el.appendChild(statusEl);
        // Title (+ optional "beta" exponent) wrapped so the superscript stays glued to the label and
        // survives title-text updates (which only touch the inner span).
        const titleWrap = document.createElement('span');
        titleWrap.style.cssText = 'white-space:nowrap;';
        const titleEl = document.createElement('span');
        titleEl.textContent = title;
        // Every indicator title reads in the chrome text color: where a study is computed
        // (core vs script) is an implementation detail, not something to color-code.
        titleEl.style.cssText = 'font-weight:600;';
        titleWrap.appendChild(titleEl);
        if (opts.beta) {
            const beta = document.createElement('sup');
            beta.textContent = 'beta';
            beta.style.cssText = 'font-size:8px;font-weight:700;opacity:0.7;margin-left:1px;letter-spacing:0.2px;';
            titleWrap.appendChild(beta);
        }
        el.appendChild(titleWrap);
        // Hide/show (eye) — revealed on hover/selection like the other controls, but ALSO kept
        // visible while the indicator is hidden (so its "show" toggle stays reachable without
        // hovering). It sits outside `controlsEl` so it can outlive the collapse. Only present when
        // the renderer can actually suspend an indicator (it wired setOnToggleVisible).
        let eyeEl: HTMLButtonElement | null = null;
        if (this.onToggleVisible) {
            const eye = document.createElement('button');
            eye.type = 'button';
            eye.title = 'Hide';
            eye.innerHTML = EYE_SVG;
            eye.style.cssText = `cursor:pointer;display:none;align-items:center;background:transparent;border:none;color:${this.theme.textColor};opacity:0.6;line-height:0;padding:0 1px;`;
            eye.addEventListener('mouseenter', () => (eye.style.opacity = '1'));
            eye.addEventListener('mouseleave', () => (eye.style.opacity = '0.6'));
            eye.addEventListener('click', () => {
                const row = this.rows.get(id);
                this.onToggleVisible?.(id, Boolean(row?.hidden)); // currently hidden ⇒ request show, else hide
            });
            el.appendChild(eye);
            eyeEl = eye;
        }
        // Settings (gear) + remove (✕) live in their own container, revealed on hover or selection.
        const controlsEl = document.createElement('span');
        controlsEl.style.cssText = 'display:none;align-items:center;gap:6px;';
        if (inputs.length > 0) {
            const gear = document.createElement('button');
            gear.type = 'button';
            gear.title = 'Settings';
            gear.textContent = '⚙';
            gear.style.cssText = `cursor:pointer;background:transparent;border:none;color:${this.theme.textColor};opacity:0.65;font-size:13px;line-height:1;padding:0 2px;`;
            gear.addEventListener('mouseenter', () => (gear.style.opacity = '1'));
            gear.addEventListener('mouseleave', () => (gear.style.opacity = '0.65'));
            gear.addEventListener('click', () => this.openDialog(id));
            controlsEl.appendChild(gear);
        }
        // Move to — opens a small pane menu (Main chart / New pane above·below / existing panes).
        // Present only when the host wired a move API (i.e. the renderer supports pane management).
        if (this.moveApi) {
            const mv = document.createElement('button');
            mv.type = 'button';
            mv.title = 'Move to pane';
            mv.innerHTML = iconAt('move', LEGEND_ICON_PX);
            mv.style.cssText = `cursor:pointer;display:inline-flex;align-items:center;background:transparent;border:none;color:${this.theme.textColor};opacity:0.65;line-height:0;padding:0 1px;`;
            mv.addEventListener('mouseenter', () => (mv.style.opacity = '1'));
            mv.addEventListener('mouseleave', () => (mv.style.opacity = '0.65'));
            mv.addEventListener('click', (e) => { e.stopPropagation(); this.openMoveMenu(id, mv); });
            controlsEl.appendChild(mv);
        }
        // Remove (✕) — a built-in control to drop the indicator from the chart.
        const close = document.createElement('button');
        close.type = 'button';
        close.title = 'Remove indicator';
        close.textContent = '✕';
        close.className = 'vela-ind-close';
        close.style.cssText = `cursor:pointer;background:transparent;border:none;color:${this.theme.textColor};font-size:var(--vela-font-size-sm);line-height:1;padding:0 1px;`;
        close.addEventListener('click', () => this.onRemove?.(id));
        controlsEl.appendChild(close);
        el.appendChild(controlsEl);

        this.attach(this.legendFor(paneId), el, !!opts.native);
        this.rows.set(id, { id, title, inputs, values: { ...values }, el, titleEl, statusEl, paneId, hidden: false, eyeEl, controlsEl, native: !!opts.native });
    }

    /** Place a row in its pane's legend — native rows PREPEND (pinned to the top), Pine rows append. */
    private attach(container: HTMLElement, el: HTMLElement, native: boolean): void {
        if (native) container.prepend(el);
        else container.appendChild(el);
    }

    /** Reflect programmatic input changes (so a re-opened dialog shows current values). */
    setValues(id: string, values: Record<string, InputValue>): void {
        const row = this.rows.get(id);
        if (row) row.values = { ...row.values, ...values };
    }

    /**
     * Reflect an indicator's live status in its legend row: `'loading'` shows a spinner (a fetch is
     * in flight), `'live'` a pulsing dot (live-updating), `'idle'` nothing. Rendered left of the title.
     */
    setStatus(id: string, status: 'idle' | 'loading' | 'live'): void {
        const row = this.rows.get(id);
        if (!row) return;
        const el = row.statusEl;
        if (status === 'idle') {
            el.style.display = 'none';
            el.style.animation = 'none';
            return;
        }
        this.ensureStatusKeyframes();
        if (status === 'loading') {
            el.style.cssText =
                `display:inline-block;box-sizing:border-box;flex:none;width:11px;height:11px;border-radius:50%;` +
                `border:2px solid var(--vela-border-strong);border-top-color:var(--vela-fg-bright);` +
                `animation:vela-ind-spin .7s linear infinite;`;
        } else {
            // live — a pulsing filled dot
            el.style.cssText =
                `display:inline-block;box-sizing:border-box;flex:none;width:8px;height:8px;border-radius:50%;` +
                `background:${this.theme.upColor};animation:vela-ind-pulse 1.2s ease-in-out infinite;`;
        }
    }

    /** Inject the status keyframes once (idempotent). */
    private ensureStatusKeyframes(): void {
        if (typeof document === 'undefined' || document.getElementById('vela-ind-status-kf')) return;
        const style = document.createElement('style');
        style.id = 'vela-ind-status-kf';
        style.textContent = STATUS_KEYFRAMES;
        document.head.appendChild(style);
    }

    /** Mark a row hidden/shown — swaps the eye glyph and dims the row; does NOT remove it. */
    setVisible(id: string, visible: boolean): void {
        const row = this.rows.get(id);
        if (!row) return;
        row.hidden = !visible;
        row.el.style.opacity = visible ? '1' : '0.5';
        if (row.eyeEl) {
            row.eyeEl.innerHTML = visible ? EYE_SVG : EYE_OFF_SVG;
            row.eyeEl.title = visible ? 'Hide' : 'Show';
            // A hidden indicator keeps its eye visible even when idle; a shown one follows the
            // other controls (visible only while hovered/selected — i.e. its container is open).
            row.eyeEl.style.display = !visible || row.controlsEl.style.display !== 'none' ? 'inline-flex' : 'none';
        }
    }

    /**
     * Select a legend row (outlining it) and clear any previous selection, so at most one
     * indicator is highlighted at a time. Re-clicking the already-selected row is a no-op.
     */
    private selectRow(id: string): void {
        if (this.selectedId === id) return;
        this.clearSelection();
        this.selectedId = id;
        this.setRowHighlighted(id, true);
    }

    /**
     * Show or hide a row's outline and eye/gear/✕ controls together — driven by both hover and
     * selection, so an idle (unhovered, unselected) row shows just its title. Exception: a hidden
     * indicator keeps its eye visible even when idle, so it can be un-hidden without hovering.
     */
    private setRowHighlighted(id: string, highlighted: boolean): void {
        const row = this.rows.get(id);
        if (!row) return;
        row.el.style.boxShadow = highlighted ? `inset 0 0 0 1px ${this.neutralBorder()}` : 'none';
        row.controlsEl.style.display = highlighted ? 'inline-flex' : 'none';
        if (row.eyeEl) row.eyeEl.style.display = highlighted || row.hidden ? 'inline-flex' : 'none';
    }

    /** Drop the current selection outline, if any. */
    private clearSelection(): void {
        if (!this.selectedId) return;
        this.setRowHighlighted(this.selectedId, false);
        this.selectedId = null;
    }

    remove(id: string): void {
        const row = this.rows.get(id);
        row?.el.remove();
        this.rows.delete(id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.openId === id) this.closeDialog();
        // Drop an emptied non-price pane legend container (the pane itself is gone too).
        if (row && row.paneId !== 'price') {
            const lg = this.legends.get(row.paneId);
            if (lg && lg.childElementCount === 0) { lg.remove(); this.legends.delete(row.paneId); }
        }
    }

    destroy(): void {
        this.closeDialog();
        this.closeMoveMenu();
        for (const lg of this.legends.values()) lg.remove();
        this.legends.clear();
        this.rows.clear();
        this.selectedId = null;
        if (typeof document !== 'undefined') document.removeEventListener('click', this.onDocClick);
    }

    /** True when an indicator's settings dialog is currently open. */
    isDialogOpen(): boolean {
        return this.dialog !== null;
    }

    /**
     * Close the open settings dialog (if any), keeping any live edits — the same as **Ok** or ×.
     * Public so the host can dismiss it when it opens a competing dialog of its own.
     */
    closeOpenDialog(): void {
        this.closeDialog();
    }

    /**
     * Open the indicator's settings as a centered modal over the chart — a themed,
     * dependency-free port of the app's tabbed script-settings dialog: a header with the
     * indicator title, an "Inputs" tab, a scrollable body that groups inputs by `group=`
     * (section headers) and packs `inline=` inputs onto one row, and a sticky footer.
     *
     * Edits commit LIVE (each change re-runs the indicator), matching the current
     * behavior; the footer's **Cancel** reverts to the values captured on open, while
     * **Ok** / × / click-outside / Esc keep them.
     */
    private openDialog(id: string): void {
        this.closeDialog();
        const row = this.rows.get(id);
        if (!row || row.inputs.length === 0) return;
        this.openId = id;
        this.snapshot = { ...row.values };
        ensureDialogStyles();
        const t = this.theme;
        const font = t.fontFamily || '-apple-system,Segoe UI,sans-serif';
        const border = this.neutralBorder();
        const fg = this.strongText();
        // Drives native-control rendering (the date field's calendar icon + the <select> dropdown
        // popup) so they match the dialog: on dark themes the icon is light and the option list is
        // dark with light text, instead of a white popup with invisible white text.
        const scheme = this.isDarkTheme() ? 'dark' : 'light';

        // Backdrop — centers the card and captures outside clicks. Transparent (no scrim): the
        // settings dialog leaves the chart visible for live editing; the symbol-search modal is
        // the one that dims behind it.
        const backdrop = document.createElement('div');
        backdrop.className = 'vela-ind-dialog-backdrop';
        backdrop.style.cssText = 'position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:transparent;pointer-events:auto;';
        // Clicking the backdrop (outside the card) is a click "off the legend": close the dialog and
        // drop the selection outline. The document click handler can't do this itself because this
        // pointerdown removes the backdrop before the click event resolves.
        backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) { this.closeDialog(); this.clearSelection(); } });

        // Card.
        const card = document.createElement('div');
        card.className = 'vela-ind-dialog';
        // Shrink-to-fit width (capped), mirroring the reference dialog's `w-fit sm:max-w-2xl`:
        // the card is only as wide as the widest input row needs — no fixed width stretching the
        // full-width text area — while the cap + min keep it a sensible size.
        card.style.cssText = `display:flex;flex-direction:column;width:fit-content;min-width:min(360px,90%);max-width:min(640px,94%);max-height:82%;background:${t.background};border:1px solid ${border};border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow-dialog);color:${fg};color-scheme:${scheme};font:13px ${font};overflow:hidden;`;
        applyChromeTokens(card, t);
        // Keystrokes (typing in a field) must not reach the chart; let Esc bubble to the
        // document handler so it closes even when focus sits in an input.
        card.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

        // ── Header ──
        const header = document.createElement('div');
        header.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 20px 12px;flex:0 0 auto;';
        const hTitle = document.createElement('span');
        hTitle.textContent = row.title;
        hTitle.style.cssText = 'font-weight:600;font-size:16px;line-height:1.3;';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `cursor:pointer;background:transparent;border:none;color:${fg};opacity:0.7;font-size:20px;line-height:1;padding:0 2px;flex:0 0 auto;`;
        closeBtn.addEventListener('mouseenter', () => (closeBtn.style.opacity = '1'));
        closeBtn.addEventListener('mouseleave', () => (closeBtn.style.opacity = '0.7'));
        closeBtn.addEventListener('click', () => this.closeDialog());
        header.append(hTitle, closeBtn);
        card.appendChild(header);
        makeDialogDraggable(card, header, { closeSelector: 'button' });

        // ── Tab strip (Inputs) — full-width underline with the active tab underlined. ──
        const tabs = document.createElement('div');
        tabs.style.cssText = `display:flex;gap:16px;padding:0 20px;border-bottom:1px solid ${border};flex:0 0 auto;`;
        const tab = document.createElement('div');
        tab.textContent = 'Inputs';
        tab.style.cssText = `padding:8px 2px;margin-bottom:-1px;border-bottom:2px solid ${fg};font-weight:600;font-size:13px;`;
        tabs.appendChild(tab);
        card.appendChild(tabs);

        // ── Body (scrollable) — one grid per `group=` section. ──
        const body = document.createElement('div');
        body.style.cssText = 'padding:14px 20px 6px;overflow-y:auto;flex:1 1 auto;display:flex;flex-direction:column;gap:24px;';
        for (const group of groupInputs(row.inputs)) {
            const section = document.createElement('div');
            section.style.cssText = 'display:flex;flex-direction:column;gap:14px;';
            if (group.name) {
                const gh = document.createElement('div');
                gh.textContent = group.name;
                gh.style.cssText = 'font-size:var(--vela-font-size-sm);font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--vela-fg-muted);';
                section.appendChild(gh);
            }
            const grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:minmax(140px,auto) auto auto 1fr;align-items:center;column-gap:12px;row-gap:22px;';
            for (const inputRow of group.rows) this.buildInputRow(grid, inputRow, row);
            section.appendChild(grid);
            body.appendChild(section);
        }
        card.appendChild(body);

        // ── Footer — Cancel reverts live edits, Ok keeps them. ──
        const footer = document.createElement('div');
        footer.style.cssText = `display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid ${border};flex:0 0 auto;`;
        footer.append(
            this.dialogButton('Cancel', false, () => this.revertAndClose()),
            this.dialogButton('Ok', true, () => this.closeDialog()),
        );
        card.appendChild(footer);

        backdrop.appendChild(card);
        (this.dialogHost ?? this.container).appendChild(backdrop);
        this.dialog = card;
        this.backdrop = backdrop;
        document.addEventListener('keydown', this.onDialogKey);
    }

    private closeDialog(): void {
        document.removeEventListener('keydown', this.onDialogKey);
        this.backdrop?.remove();
        this.backdrop = null;
        this.dialog = null;
        this.openId = null;
        this.snapshot = null;
    }

    /** Restore every input to its open-time value (re-running the indicator), then close. */
    private revertAndClose(): void {
        const row = this.openId ? this.rows.get(this.openId) : null;
        const snap = this.snapshot;
        if (row && snap) {
            for (const inp of row.inputs) {
                const snapped = snap[inp.key];
                const before: InputValue = snapped !== undefined ? snapped : inp.defval;
                if (row.values[inp.key] !== before) {
                    row.values[inp.key] = before;
                    this.onChange?.({ indicatorId: row.id, key: inp.key, value: before });
                }
            }
        }
        this.closeDialog();
    }

    /** One settings row (or several `inline=` inputs) placed into a section's grid. */
    private buildInputRow(grid: HTMLElement, decls: InputSchema[], row: LegendRow): void {
        const idOf = (inp: InputSchema): string => `vela-inp-${row.id}-${inp.key}`;

        // INLINE — multiple inputs on one line, each with its own title (bool toggles left).
        if (decls.length > 1) {
            const cell = document.createElement('div');
            cell.style.cssText = 'grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:12px;';
            for (const d of decls) {
                const fit = d.type === 'color' || d.type === 'bool';
                const toggleFirst = d.type === 'bool';
                const id = idOf(d);
                const item = document.createElement('div');
                item.style.cssText = `display:flex;align-items:center;gap:6px;${toggleFirst ? 'flex-direction:row-reverse;' : ''}`;
                const name = nameOf(d);
                if (name) {
                    const lbl = document.createElement('label');
                    lbl.htmlFor = id;
                    lbl.textContent = name;
                    lbl.style.cssText = `font-size:13px;opacity:0.9;${toggleFirst ? 'cursor:pointer;' : ''}`;
                    item.appendChild(lbl);
                }
                const cw = document.createElement('div');
                cw.style.cssText = fit ? '' : 'width:110px;';
                cw.appendChild(this.buildControl(row, d, id));
                item.appendChild(cw);
                cell.appendChild(item);
            }
            const lastTip = [...decls].reverse().find((d) => d.tooltip)?.tooltip;
            if (lastTip) cell.appendChild(this.infoButton(lastTip));
            grid.appendChild(cell);
            return;
        }

        const lead = decls[0]!;
        const id = idOf(lead);

        // BOOL — toggle sits to the LEFT of its title (the label wraps it so the whole label toggles).
        if (lead.type === 'bool') {
            const cell = document.createElement('div');
            cell.style.cssText = 'grid-column:1 / 4;display:flex;align-items:center;gap:8px;';
            const lbl = document.createElement('label');
            lbl.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;';
            lbl.appendChild(this.buildControl(row, lead, id));
            lbl.appendChild(document.createTextNode(nameOf(lead)));
            cell.appendChild(lbl);
            if (lead.tooltip) cell.appendChild(this.infoButton(lead.tooltip));
            grid.appendChild(cell);
            grid.appendChild(document.createElement('div')); // col-4 slack
            return;
        }

        // TEXT AREA — centered title (+ info) on its own line, full-width textarea below.
        if (lead.type === 'text_area') {
            const cell = document.createElement('div');
            cell.style.cssText = 'grid-column:1 / -1;display:flex;flex-direction:column;gap:8px;';
            const head = document.createElement('div');
            head.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;';
            const lbl = document.createElement('label');
            lbl.htmlFor = id;
            lbl.textContent = nameOf(lead);
            lbl.style.cssText = 'font-size:13px;';
            head.appendChild(lbl);
            if (lead.tooltip) head.appendChild(this.infoButton(lead.tooltip));
            cell.appendChild(head);
            cell.appendChild(this.buildControl(row, lead, id));
            grid.appendChild(cell);
            return;
        }

        // DEFAULT — [ label | control (+ info) | slack ].
        const label = document.createElement('label');
        label.htmlFor = id;
        label.textContent = nameOf(lead);
        label.style.cssText = 'font-size:13px;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const controlCell = document.createElement('div');
        controlCell.style.cssText = 'grid-column:span 2;display:flex;align-items:center;gap:8px;';
        // Multi-widget controls (session/time) and the color swatch size to content rather than the 140px field width.
        const fit = lead.type === 'color' || lead.type === 'session' || lead.type === 'time';
        const cw = document.createElement('div');
        cw.style.cssText = fit ? '' : 'width:140px;';
        cw.appendChild(this.buildControl(row, lead, id));
        controlCell.appendChild(cw);
        if (lead.tooltip) controlCell.appendChild(this.infoButton(lead.tooltip));
        grid.appendChild(label);
        grid.appendChild(controlCell);
        grid.appendChild(document.createElement('div')); // col-4 slack
    }

    /** Build the typed control for one input, committing edits live via `onChange`. */
    private buildControl(row: LegendRow, inp: InputSchema, id: string): HTMLElement {
        const current = row.values[inp.key] ?? inp.defval;
        const emit = (value: InputValue): void => {
            row.values[inp.key] = value;
            this.onChange?.({ indicatorId: row.id, key: inp.key, value });
        };
        const ctrl = this.ctrlStyle();

        if (inp.type === 'bool') return this.buildToggle(id, Boolean(current), emit);
        if (inp.options && inp.options.length > 0) return this.select(id, inp.options.map(String), String(current), `${ctrl}cursor:pointer;`, emit);
        if (inp.type === 'source') return this.select(id, SOURCES, String(current), `${ctrl}cursor:pointer;`, emit);
        if (inp.type === 'color') {
            const ci = document.createElement('input');
            ci.type = 'color';
            ci.id = id;
            ci.value = toHex6(String(current));
            ci.style.cssText = `flex:0 0 auto;box-sizing:border-box;width:32px;height:32px;padding:2px;border:1px solid ${this.neutralBorder()};border-radius:0;background:transparent;cursor:pointer;`;
            ci.addEventListener('input', () => emit(ci.value));
            return ci;
        }
        if (inp.type === 'symbol') return this.buildSymbol(id, String(current), emit);
        if (inp.type === 'timeframe') return this.selectPairs(id, TIMEFRAME_OPTIONS, String(current), `${ctrl}cursor:pointer;`, emit);
        if (inp.type === 'session') return this.buildSession(id, String(current), emit);
        if (inp.type === 'time') return this.buildTime(id, Number(current) || 0, emit);
        if (inp.type === 'text_area') return this.buildTextArea(id, String(current), emit);
        // int / float / price → numeric spinner (price behaves like a free float).
        if (inp.type === 'int' || inp.type === 'float' || inp.type === 'price') {
            const ni = document.createElement('input');
            ni.type = 'number';
            ni.id = id;
            ni.value = String(current);
            if (inp.min !== undefined) ni.min = String(inp.min);
            if (inp.max !== undefined) ni.max = String(inp.max);
            ni.step = String(inp.step ?? (inp.type === 'int' ? 1 : 0.1));
            ni.style.cssText = ctrl;
            let last = String(current);
            const commit = (): void => {
                let n = Number(ni.value);
                if (!Number.isFinite(n)) { ni.value = last; return; }
                if (inp.min !== undefined) n = Math.max(inp.min, n);
                if (inp.max !== undefined) n = Math.min(inp.max, n);
                if (inp.type === 'int') n = Math.round(n);
                ni.value = String(n);
                if (String(n) !== last) { last = String(n); emit(n); }
            };
            ni.addEventListener('blur', commit);
            ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ni.blur(); } });
            return ni;
        }
        // string / other → free text, commit on blur / Enter.
        return this.buildTextField(id, String(current), emit);
    }

    /** A plain text field that commits on blur / Enter (shared by string inputs and the pickerless symbol field). */
    private buildTextField(id: string, current: string, emit: (v: InputValue) => void): HTMLInputElement {
        const ti = document.createElement('input');
        ti.type = 'text';
        ti.id = id;
        ti.value = current;
        ti.style.cssText = this.ctrlStyle();
        let last = current;
        ti.addEventListener('blur', () => { if (ti.value !== last) { last = ti.value; emit(ti.value); } });
        ti.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ti.blur(); } });
        return ti;
    }

    /** A square check-toggle (filled + check when on) — replaces the raw checkbox. */
    private buildToggle(id: string, checked: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
        const t = this.theme;
        const border = this.neutralBorder();
        const fill = this.strongText();
        const b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.setAttribute('role', 'switch');
        b.innerHTML = CHECK_SVG;
        b.style.cssText = `width:20px;height:20px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:1px solid ${border};border-radius:5px;cursor:pointer;padding:0;transition:background .12s ease,border-color .12s ease;`;
        let on = checked;
        const paint = (v: boolean): void => {
            b.setAttribute('aria-checked', v ? 'true' : 'false');
            b.style.background = v ? fill : 'transparent';
            b.style.borderColor = v ? fill : border;
            b.style.color = v ? t.background : 'transparent';
        };
        paint(checked);
        b.addEventListener('click', () => { on = !on; paint(on); onChange(on); });
        return b;
    }

    /** A hoverable ⓘ affordance carrying an input's `tooltip` (native title). */
    private infoButton(tooltip: string): HTMLElement {
        const b = document.createElement('span');
        b.textContent = 'i';
        b.title = tooltip;
        b.className = 'vela-ind-hint';
        b.style.cssText = 'flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;font-weight:600;font-size:11px;font-family:inherit;line-height:1;cursor:help;user-select:none;';
        return b;
    }

    /** A dropdown over plain string options (value === label) — a thin case of {@link selectPairs}. */
    private select(id: string, options: string[], current: string, style: string, emit: (v: InputValue) => void): HTMLElement {
        return this.selectPairs(id, options.map((o) => ({ value: o, label: o })), current, style, emit);
    }

    /** A dropdown whose visible labels differ from the committed values (label ≠ value pairs). */
    private selectPairs(id: string, pairs: readonly { value: string; label: string }[], current: string, style: string, onChange: (v: string) => void): HTMLElement {
        const sel = document.createElement('select');
        sel.id = id;
        sel.style.cssText = style;
        // Surface an unknown committed value as a disabled entry so the trigger reflects what's set.
        if (current !== '' && !pairs.some((p) => p.value === current)) {
            const o = document.createElement('option');
            o.value = current;
            o.textContent = current;
            o.selected = true;
            o.disabled = true;
            sel.appendChild(o);
        }
        for (const p of pairs) {
            const o = document.createElement('option');
            o.value = p.value;
            o.textContent = p.label;
            if (p.value === current) o.selected = true;
            sel.appendChild(o);
        }
        this.styleSelect(sel);
        sel.addEventListener('change', () => onChange(sel.value));
        return this.wrapSelectChevron(sel);
    }

    /** Wrap a `<select>` with an inset chevron — native arrows can't be repositioned reliably. */
    private wrapSelectChevron(sel: HTMLSelectElement): HTMLElement {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:100%;';
        sel.style.paddingRight = '28px';
        const chevron = document.createElement('span');
        chevron.innerHTML = SELECT_CHEVRON_SVG;
        chevron.style.cssText = `position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;display:flex;align-items:center;color:${this.strongText()};opacity:0.85;line-height:0;`;
        wrap.append(sel, chevron);
        return wrap;
    }

    /** `input.session` → two HH:MM dropdowns committing a `HHMM-HHMM` session string. */
    private buildSession(id: string, current: string, emit: (v: InputValue) => void): HTMLElement {
        const [start, end] = sessionToTimes(current);
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
        let from = start;
        let to = end;
        const commit = (): void => emit(timesToSession(from, to));
        const startSel = this.timeSelect(id, from, 86, (v) => { from = v; commit(); });
        const endSel = this.timeSelect(`${id}-end`, to, 86, (v) => { to = v; commit(); });
        wrap.append(startSel, endSel);
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
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.id = id;
        dateInput.value = date;
        dateInput.style.cssText = `${this.ctrlStyle()}width:auto;cursor:pointer;`;
        dateInput.addEventListener('change', () => { date = dateInput.value; commit(); });
        const timeSel = this.timeSelect(`${id}-time`, time, 86, (v) => { time = v; commit(); });
        wrap.append(dateInput, timeSel);
        return wrap;
    }

    /** `input.text_area` → a multi-line textarea, committed on blur. */
    private buildTextArea(id: string, current: string, emit: (v: InputValue) => void): HTMLTextAreaElement {
        const ta = document.createElement('textarea');
        ta.id = id;
        ta.value = current;
        ta.rows = 3;
        ta.style.cssText = `${this.ctrlStyle()}width:100%;height:auto;min-height:64px;padding:8px;resize:vertical;font-family:inherit;line-height:1.4;`;
        let last = current;
        ta.addEventListener('blur', () => { if (ta.value !== last) { last = ta.value; emit(ta.value); } });
        return ta;
    }

    /** A fixed-width HH:MM dropdown (30-minute steps) used by the session + time controls. */
    private timeSelect(id: string, current: string, width: number, onChange: (v: string) => void): HTMLElement {
        return this.selectPairs(id, TIME_OPTIONS, current, `${this.ctrlStyle()}width:${width}px;cursor:pointer;`, onChange);
    }

    /**
     * `input.symbol` → a field that opens the host's ticker-selection UI when a picker is wired
     * (the chosen symbol is written back), else a plain text field (type the ticker).
     */
    private buildSymbol(id: string, current: string, emit: (v: InputValue) => void): HTMLElement {
        const picker = this.symbolPicker;
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
        return `width:100%;box-sizing:border-box;height:32px;background:transparent;border:1px solid ${this.neutralBorder()};color:${this.strongText()};border-radius:6px;padding:0 8px;font-size:13px;font-family:inherit;outline:none;`;
    }

    /** Whether the active theme is dark (drives the dialog's `color-scheme`). */
    private isDarkTheme(): boolean {
        return isDarkColor(this.theme.background);
    }

    /** Neutral field/separator border — the shared chrome border token. */
    private neutralBorder(): string {
        return 'var(--vela-border)';
    }

    /** Strong foreground for field text, labels and the primary button. */
    private strongText(): string {
        return 'var(--vela-fg-bright)';
    }

    /**
     * Paint a `<select>` + its `<option>`s so the native dropdown popup matches the dialog: the
     * option list's background is the dialog color and its text is the strong foreground. `color-scheme`
     * alone doesn't theme the popup in every embedded browser (some render it white with white text —
     * invisible), so the colors are set explicitly here.
     */
    private styleSelect(sel: HTMLSelectElement): void {
        const bg = this.theme.background;
        const fg = this.strongText();
        sel.style.backgroundColor = bg;
        for (const o of Array.from(sel.options)) {
            o.style.backgroundColor = bg;
            o.style.color = fg;
        }
    }

    private dialogButton(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        // Primary = filled inverse chip; Cancel = ghost (no border, muted text, subtle hover
        // fill). Both hover states are in the scoped stylesheet.
        b.className = primary ? 'vela-ind-btn vela-ind-btn-primary' : 'vela-ind-btn';
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

const CHECK_SVG = iconAt('check', 12);
const SELECT_CHEVRON_SVG = iconAt('chevron-down', 16);

const DIALOG_STYLE_ID = 'vela-ind-dialog-styles';

/** Inject the scoped styles inline cssText can't reach (color-swatch, focus ring, scrollbar). */
function ensureDialogStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(DIALOG_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = DIALOG_STYLE_ID;
    s.textContent = `
.vela-ind-dialog input[type=color]{-webkit-appearance:none;appearance:none;}
.vela-ind-dialog input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
.vela-ind-dialog input[type=color]::-webkit-color-swatch{border:none;border-radius:4px;}
.vela-ind-dialog input[type=color]::-moz-color-swatch{border:none;border-radius:4px;}
.vela-ind-dialog input[type=text],.vela-ind-dialog input[type=number],.vela-ind-dialog select{transition:border-color .12s ease,box-shadow .12s ease;}
.vela-ind-dialog select{-webkit-appearance:none;appearance:none;}
.vela-ind-dialog input[type=text]:focus,.vela-ind-dialog input[type=number]:focus,.vela-ind-dialog select:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}
.vela-ind-dialog ::-webkit-scrollbar{width:9px;}
.vela-ind-dialog ::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}
.vela-ind-dialog ::-webkit-scrollbar-track{background:transparent;}
.vela-ind-hint{background:var(--vela-hover);color:var(--vela-fg-muted);transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-ind-hint:hover{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-ind-close{opacity:0.55;transition:opacity var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-ind-close:hover{opacity:1;color:var(--vela-danger) !important;}
.vela-ind-menuitem{background:transparent;transition:background var(--vela-dur-fast) ease;}
.vela-ind-menuitem:hover{background:var(--vela-hover-strong);}
.vela-ind-btn{cursor:pointer;padding:7px 14px;border-radius:var(--vela-radius-md);border:1px solid transparent;background:transparent;color:var(--vela-fg-muted);font-weight:600;font-size:13px;font-family:inherit;transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease,opacity var(--vela-dur-fast) ease;}
.vela-ind-btn:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-ind-btn-primary{padding:7px 16px;border-color:var(--vela-selected-bg);background:var(--vela-selected-bg);color:var(--vela-selected-fg);}
.vela-ind-btn-primary:hover{background:var(--vela-selected-bg);color:var(--vela-selected-fg);opacity:0.85;}`;
    document.head.appendChild(s);
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
