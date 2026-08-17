import type { InputSchema, InputValue, SymbolPickerFn } from '../../core/model/inputs';
import type { LegendActionView } from '../../core/ports/IChartRenderer';
import type { VelaTheme, MoveTarget } from '../../core/options';
import { withAlpha } from '../../core/color';
import { iconAt } from '../../core/icons';
import { applyChromeTokens } from './theme-tokens';
import { attachChromeTooltip } from './chrome-tooltip';
import { Menu, type MenuItemDescriptor } from '../../ui/components/menu';
import {
    IndicatorInputsDialog,
    ensureDialogStyles,
    type InputsUIChange,
} from './IndicatorInputsDialog';
export type { InputsUIChange } from './IndicatorInputsDialog';
export {
    nameOf,
    INPUT_DIALOG_GAP_PX,
    inputDialogBodyStyle,
    DEFAULT_INPUT_TAB,
    tabInputs,
    normalizeDateInput,
    normalizeTimeInput,
    type InputTab,
} from './IndicatorInputsDialog';

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

/** One plot's current value as shown beside the legend title (pre-formatted, plot-colored). */
export interface LegendPlotValue {
    value: string;
    color: string;
}

interface LegendRow {
    id: string;
    /** Legend chip text (may be a compact shorttitle). */
    title: string;
    /** Settings-dialog header; falls back to {@link title} when unset. */
    settingsTitle: string;
    inputs: InputSchema[];
    values: Record<string, InputValue>;
    el: HTMLElement;
    titleEl: HTMLElement;
    statusEl: HTMLElement;
    /** The plot-values readout beside the title (one colored span per drawable plot). */
    valuesEl: HTMLElement;
    /** Latest plot values pushed by the renderer (kept so visibility toggles re-render). */
    plotValues: LegendPlotValue[];
    /** Cheap change key of {@link plotValues} — skips DOM writes on unchanged frames. */
    plotValuesKey: string;
    /** Per-row override from the row's context menu; null ⇒ follow the chart-wide setting. */
    showValues: boolean | null;
    /** Hovered/selected (outline + controls visible) — the values readout yields to the controls. */
    highlighted: boolean;
    paneId: string;
    hidden: boolean;
    eyeEl: HTMLButtonElement | null;
    /** Wraps the eye/gear/✕ controls; revealed on title hover / selection (eye alone
     *  also stays out while the indicator is hidden). */
    controlsEl: HTMLElement;
    /** Host-contributed action buttons (inside `controlsEl`, before ✕) — rebuilt on demand. */
    extrasEl: HTMLElement;
    native: boolean;
}

/** Keyframes for the legend-row live pulse, injected once into the document (the load
 *  dots animate through the Web Animations API and need no stylesheet). */
const STATUS_KEYFRAMES =
    '@keyframes vela-ind-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.6)}}';

/** Legend glyph size — the row's own font belongs to the indicator title beside them. */
const LEGEND_ICON_PX = 16;
/** Equal hit target for every legend-row action (eye / gear / move / extras / ✕). Compact
 *  enough to sit on the title's line box so revealing the cluster does not grow the chip. */
const LEGEND_CTL_PX = 18;
const LEGEND_ROW_PAD_Y = 2;
const LEGEND_ROW_PAD_X = 6;
/** Space between the indicator title and the plot-values readout to its right. */
const LEGEND_TITLE_VALUES_GAP_PX = 6;
/** Space between the title and the loading/live status (the values gap plus a little
 *  air — 4px dots flush against 12px type read as glued on). */
const LEGEND_TITLE_STATUS_GAP_PX = 8;
/** Uniform space: title → first action icon, and between every action icon. */
const LEGEND_ACTION_GAP_PX = 6;
const LEGEND_CTL_CSS =
    `cursor:pointer;display:inline-flex;align-items:center;justify-content:center;` +
    `border:none;line-height:0;padding:0;` +
    `width:${LEGEND_CTL_PX}px;height:${LEGEND_CTL_PX}px;border-radius:3px;box-sizing:border-box;flex:none;`;
const LEGEND_ROW_MIN_H = LEGEND_CTL_PX + LEGEND_ROW_PAD_Y * 2;
const EYE_SVG = iconAt('eye', LEGEND_ICON_PX);
const EYE_OFF_SVG = iconAt('eye-off', LEGEND_ICON_PX);
const GEAR_SVG = iconAt('gear', LEGEND_ICON_PX);
const CLOSE_SVG = iconAt('close', LEGEND_ICON_PX);
const FOLD_SVG = iconAt('chevron-up', LEGEND_ICON_PX);
const UNFOLD_SVG = iconAt('chevron-down', LEGEND_ICON_PX);
const OVERVIEW_SVG = iconAt('objects', LEGEND_ICON_PX);

/**
 * Per-indicator legend chrome (title + gear + remove) as a DOM overlay on the
 * chart container. The settings dialog lives in {@link IndicatorInputsDialog}.
 * Edits are reported via `setOnChange` and the ✕ remove via `setOnRemove`.
 *
 * Legends are grouped by pane: when a `paneBoundsOf` resolver is supplied, each
 * pane gets its own legend container positioned at the top of that pane (so a
 * study's legend sits in its pane, not the price pane). Without the resolver every
 * legend stacks at the top of the container.
 */
export class InputsUI {
    private readonly legends = new Map<string, HTMLElement>(); // paneId → legend container
    private readonly rows = new Map<string, LegendRow>();
    private readonly inputsDialog: IndicatorInputsDialog;
    /** The legend row the user has clicked to select (gets a neutral outline); null when none. */
    private selectedId: string | null = null;
    private onChange: ((c: InputsUIChange) => void) | null = null;
    private onRemove: ((id: string) => void) | null = null;
    private onToggleVisible: ((id: string, visible: boolean) => void) | null = null;
    /** Host symbol picker for `input.symbol`; when set the control opens the host's ticker UI. */
    private symbolPicker: SymbolPickerFn | null = null;
    /** Mobile chrome: the inputs dialog opens fullscreen and the legends render compact. */
    private mobileLayout = false;
    /** Pane move/merge hook — when set, rows get a "Move to" menu + become drag-to-pane sources. */
    private moveApi: LegendMoveApi | null = null;
    /** Host-contributed legend actions, resolved PER ROW at render time (see setLegendActions). */
    private legendActions: ((indicatorId: string) => LegendActionView[]) | null = null;
    /** Chrome-tooltip disposers, per row id — a tip open at removal must not outlive its row. */
    private readonly rowTips = new Map<string, Array<() => void>>();
    /** Same, for the contributed extras only (rebuilt independently by setLegendActions). */
    private readonly extrasTips = new Map<string, Array<() => void>>();
    /** Open "Move to" menu (kept so it can be torn down). */
    private moveMenu: Menu | null = null;
    private moveTargets: MoveTarget[] = [];
    private moveMenuId: string | null = null;
    /** Collapsed panes → the master indicator id to keep visible (others hidden in the strip). */
    private paneCollapse = new Map<string, string | null>();
    /** The user folded the indicator legend away behind the chevron — CHART-WIDE: every
     *  pane's rows hide (a pane-collapse strip keeps its master label, its only marker),
     *  unlike {@link paneCollapse} which collapses one pane to a strip. */
    private legendFolded = false;
    /** Titles switched off entirely (a settings toggle): every pane's legend container
     *  hides — rows, fold chevron and all — unlike the fold, which leaves its chip. */
    private titlesVisible = true;
    /** Plot values shown beside the titles chart-wide (a settings toggle); a row's own
     *  context-menu choice ({@link LegendRow.showValues}) overrides it per indicator. */
    private valuesVisible = true;
    /** Open legend-row context menu (kept so it can be torn down). */
    private rowMenu: Menu | null = null;
    private rowMenuId: string | null = null;
    /** The single fold toggle, on the price-pane legend: a bordered ^ chevron under the
     *  rows, or the bordered "˅ N" chip (N counts every pane's indicators) when folded. */
    private foldToggle: HTMLButtonElement | null = null;
    /** Host-provided replacement for the fold toggle (multi-chart shells route it to
     *  their indicator overview, e.g. an object tree). While set, the legend stays
     *  folded and the chip runs this instead of unfolding inline. */
    private overviewAction: (() => void) | null = null;
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
        ensureDialogStyles();
        this.inputsDialog = new IndicatorInputsDialog({
            container,
            theme: () => this.theme,
            mobile: () => this.mobileLayout,
            dialogHost: () => this.dialogHost,
            symbolPicker: () => this.symbolPicker,
            onChange: (c) => this.onChange?.(c),
            onBackdropClose: () => this.clearSelection(),
        });
    }

    /** The host shell's chrome size class — mobile makes the inputs dialog fullscreen
     *  (an open dialog re-presents on the flip) and folds the legend behind its chip by
     *  default (a phone-width plot has no room for the rows). */
    setLayoutMode(mode: 'mobile' | 'desktop'): void {
        const mobile = mode === 'mobile';
        if (mobile === this.mobileLayout) return;
        this.mobileLayout = mobile;
        // The fold resets to the mode's presentation default on a flip — it is chrome
        // presentation, not user state (an overview override keeps it folded either way).
        if (this.overviewAction === null) this.legendFolded = mobile;
        this.syncFoldToggle();
        if (this.inputsDialog.openId !== null) {
            const id = this.inputsDialog.openId;
            this.closeOpenDialog();
            this.openDialog(id);
        }
    }

    /** Replace the fold toggle's behavior with a HOST action (or restore it with null):
     *  the chip stays — objects icon + indicator count — but a press runs the action
     *  (a multi-chart shell opens its indicator overview) instead of unfolding the rows,
     *  which stay hidden while the override is in force. */
    setLegendOverviewAction(action: (() => void) | null): void {
        if (action === this.overviewAction) return;
        this.overviewAction = action;
        this.legendFolded = action !== null ? true : this.mobileLayout;
        this.syncFoldToggle();
    }

    /** Open the settings dialog of one indicator (the legend gear's programmatic twin) —
     *  no-op for an unknown id. */
    openSettingsFor(id: string): void {
        if (this.rows.has(id)) this.openDialog(id);
    }

    /** Attach a themed chrome tooltip to a control, recording its disposer under `id`. */
    private tip(store: Map<string, Array<() => void>>, id: string, anchor: HTMLElement, text: string | (() => string), wrap = false): void {
        const list = store.get(id) ?? [];
        list.push(attachChromeTooltip(anchor, { host: this.container, theme: () => this.theme, text: typeof text === 'function' ? text : () => text, wrap }));
        store.set(id, list);
    }

    private disposeTips(store: Map<string, Array<() => void>>, id: string): void {
        for (const dispose of store.get(id) ?? []) dispose();
        store.delete(id);
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
        // Legend containers carry the CHART theme tokens (not the wrapper's stable chrome
        // surface): row fills and action-button hovers sit on the plot background, which can
        // diverge from the app chrome when the host edits layout.background.
        for (const lg of this.legends.values()) applyChromeTokens(lg, theme);
        // Rows carry the chart background as an INLINE fill (translucent when idle, solid
        // when open) — repaint them, or a `layout.background` edit leaves stale chips
        // floating over the plot. "Open" is what setRowHighlighted made visible.
        for (const row of this.rows.values()) {
            row.el.style.background = row.highlighted ? theme.background : this.idleRowFill();
            row.el.style.color = theme.textColor;
        }
        if (this.foldToggle) this.syncFoldToggle(); // rebuild so fill + ink follow the new theme
    }

    /** Provide (or clear) the host symbol picker that `input.symbol` opens on activation. */
    setSymbolPicker(picker: SymbolPickerFn | null): void {
        this.symbolPicker = picker;
    }

    /** Enable legend-driven move/merge (a "Move to" menu + drag-to-pane). Null disables it. */
    setMoveApi(api: LegendMoveApi | null): void {
        this.moveApi = api;
    }

    /**
     * Wire the host-contributed row actions. Re-calling replaces the provider and
     * re-projects the rows already on screen (a late `registerLegendAction` appears after
     * the shell's `refreshActions()`, same as every other contribution).
     */
    setLegendActions(provider: ((indicatorId: string) => LegendActionView[]) | null): void {
        this.legendActions = provider;
        for (const row of this.rows.values()) this.renderExtras(row.id, row.extrasEl);
    }

    /** (Re)build one row's contributed buttons. Same look, reveal and tooltips as the built-ins. */
    private renderExtras(id: string, extrasEl: HTMLElement): void {
        this.disposeTips(this.extrasTips, id);
        extrasEl.replaceChildren();
        for (const action of this.legendActions?.(id) ?? []) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', action.tooltip);
            this.tip(this.extrasTips, id, btn, action.tooltip);
            btn.innerHTML = iconAt(action.icon, LEGEND_ICON_PX);
            btn.className = 'vela-ind-ctl';
            btn.dataset.legendAction = action.id;
            btn.style.cssText = LEGEND_CTL_CSS;
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // selecting the row is not the intent
                action.run();
            });
            extrasEl.appendChild(btn);
        }
    }

    /** Reposition the per-pane legend containers after a layout change. */
    reposition(): void {
        for (const [paneId, lg] of this.legends) this.positionLegend(lg, paneId);
    }

    /** Show/hide the indicator titles chart-wide (the settings dialog's Indicators toggle). */
    setTitlesVisible(visible: boolean): void {
        if (this.titlesVisible === visible) return;
        this.titlesVisible = visible;
        this.reposition(); // positionLegend applies the flag per pane
    }

    /**
     * Show/hide the plot values chart-wide (the settings dialog's Indicators → Values
     * toggle). "All" is meant literally: per-row context-menu overrides are cleared, so
     * every legend follows the new state.
     */
    setValuesVisible(visible: boolean): void {
        this.valuesVisible = visible;
        for (const row of this.rows.values()) {
            row.showValues = null;
            this.renderRowValues(row);
        }
    }

    /**
     * Push the current plot values of every indicator at once (the renderer calls this per
     * paint). Rows absent from the map (e.g. a hidden indicator) show no values. Cheap on
     * unchanged frames: each row diffs against its last rendered values before touching DOM.
     */
    setPlotValues(values: ReadonlyMap<string, LegendPlotValue[]>): void {
        for (const row of this.rows.values()) {
            const next = values.get(row.id) ?? [];
            const key = next.map((v) => `${v.value}|${v.color}`).join('\u0000');
            if (key === row.plotValuesKey) continue;
            row.plotValues = next;
            row.plotValuesKey = key;
            this.renderRowValues(row);
        }
    }

    /** Whether a row currently shows its values: its own override, else the chart-wide flag. */
    private rowValuesShown(row: LegendRow): boolean {
        return row.showValues ?? this.valuesVisible;
    }

    /** (Re)build one row's values readout from its stored plot values + visibility. A
     *  highlighted (hovered/selected) row shows only the title + controls — no values. */
    private renderRowValues(row: LegendRow): void {
        if (!this.rowValuesShown(row) || row.plotValues.length === 0 || row.highlighted) {
            row.valuesEl.style.display = 'none';
            row.valuesEl.replaceChildren();
            return;
        }
        row.valuesEl.style.display = 'inline-flex';
        row.valuesEl.replaceChildren();
        for (const v of row.plotValues) {
            const span = document.createElement('span');
            span.textContent = v.value;
            span.style.color = v.color;
            row.valuesEl.appendChild(span);
        }
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
        this.moveTargets = items.map((it) => it.target);
        this.moveMenuId = id;
        const descriptors: MenuItemDescriptor[] = items.map((it, i) => ({ id: String(i), label: it.label }));
        if (!this.moveMenu) {
            this.moveMenu = new Menu({
                host: this.container,
                items: descriptors,
                placement: 'bottom-start',
                onSelect: (itemId) => {
                    const target = this.moveTargets[Number(itemId)];
                    const rowId = this.moveMenuId;
                    if (target && rowId) api.move(rowId, target);
                },
            });
        } else {
            this.moveMenu.setItems(descriptors);
        }
        const r = anchor.getBoundingClientRect();
        this.moveMenu.openAt(r.left, r.bottom + 4);
    }

    private closeMoveMenu(): void {
        this.moveMenu?.close();
    }

    // ── legend row context menu (right-click) ───────────────────────────────

    /** Open the row's action menu at the pointer. One entry today: the values toggle. */
    private openRowMenu(id: string, x: number, y: number): void {
        this.closeRowMenu();
        this.closeMoveMenu();
        const row = this.rows.get(id);
        if (!row) return;
        this.rowMenuId = id;
        const items: MenuItemDescriptor[] = [{
            id: 'values',
            label: 'Indicator values',
            checked: this.rowValuesShown(row),
        }];
        if (!this.rowMenu) {
            this.rowMenu = new Menu({
                host: this.container,
                items,
                placement: 'bottom-start',
                onSelect: (itemId) => {
                    if (itemId !== 'values' || !this.rowMenuId) return;
                    const target = this.rows.get(this.rowMenuId);
                    if (!target) return;
                    target.showValues = !this.rowValuesShown(target);
                    this.renderRowValues(target);
                },
            });
        } else {
            this.rowMenu.setItems(items);
        }
        this.rowMenu.openAt(x, y);
    }

    private closeRowMenu(): void {
        this.rowMenu?.close();
    }

    /** Move a legend row to another pane (indicator merged/moved), tidying an emptied container. */
    setPane(id: string, paneId: string): void {
        const row = this.rows.get(id);
        if (!row || row.paneId === paneId) return;
        const prev = row.paneId;
        row.paneId = paneId;
        this.attach(this.legendFor(paneId), row.el, row.native);
        this.syncFoldToggle(); // a moved row must follow the fold state in its new pane
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
                'position:absolute;left:10px;z-index:5;display:flex;flex-direction:column;align-items:flex-start;gap:0;pointer-events:none;font:12px -apple-system,Segoe UI,sans-serif;';
            // Chart-theme tokens so action-button hovers wash against the plot surface the
            // rows sit on (the wrapper beneath may carry the host's stable chrome surface).
            applyChromeTokens(lg, this.theme);
            this.positionLegend(lg, paneId);
            this.container.appendChild(lg);
            this.legends.set(paneId, lg);
        }
        return lg;
    }

    private positionLegend(lg: HTMLElement, paneId: string): void {
        const bounds = this.paneBoundsOf ? this.paneBoundsOf(paneId) : { top: 0, height: Infinity };
        // A pane hidden by a maximize elsewhere collapses to ~0 height — hide its legend entirely
        // (a collapsed strip keeps a small height, so its title still shows). Titles switched
        // off (the settings toggle) hide every pane's container the same way. Restore to 'flex'
        // (the container's intended layout — set in its cssText), NOT '' which would revert it
        // to block: block children stretch to the widest row, fusing the chips into one slab.
        lg.style.display = bounds.height < 4 || !this.titlesVisible ? 'none' : 'flex';
        // A collapsed pane is a legend-only strip: show just its master indicator's row. Restore
        // hidden rows to 'flex' (their intended layout — set in the row's cssText), NOT '' which
        // would revert them to block and break the inline button row (hide/show, settings, …).
        // A FOLDED legend (the chevron under the price-pane rows) hides every pane's rows —
        // study panes included — leaving only the bordered "˅ N" chip; a strip keeps its
        // master label, since that label is the strip's only marker.
        const collapsed = this.paneCollapse.has(paneId);
        const masterId = this.paneCollapse.get(paneId) ?? null;
        for (const row of this.rows.values()) {
            if (row.paneId !== paneId) continue;
            row.el.style.display = (collapsed ? row.id !== masterId : this.legendFolded) ? 'none' : 'flex';
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

    /**
     * Keep the fold toggle in step with the indicator count: with 2+ indicators anywhere
     * on the chart, a bordered ^ chevron sits under the price-pane rows (click folds every
     * pane's rows away — study panes included — leaving a bordered "˅ N" chip that unfolds
     * them); with fewer, the toggle disappears and a fold in force is undone. Re-appended
     * last so {@link attach}'s prepend/append never leaves it above a row.
     */
    private syncFoldToggle(): void {
        const count = this.rows.size;
        // Desktop earns the chevron at 2+ rows; mobile folds even a lone row behind the
        // chip (the legend is collapsed by default there), and a host overview override
        // needs the chip from the first row — it is the list's only entry point.
        const minRows = this.overviewAction !== null || this.mobileLayout ? 1 : 2;
        if (count < minRows) {
            const wasFolded = this.legendFolded;
            // Never strand a surviving row hidden behind a toggle that just disappeared;
            // with no rows at all the fold keeps its default for the next indicator.
            if (count > 0) this.legendFolded = false;
            if (this.foldToggle) {
                this.foldToggle.remove();
                this.foldToggle = null;
                this.disposeTips(this.rowTips, 'fold');
            }
            if (wasFolded && count > 0) this.reposition(); // unhide the surviving row(s)
            return;
        }
        let btn = this.foldToggle;
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vela-ind-fold';
            this.tip(this.rowTips, 'fold', btn, () => (this.overviewAction !== null ? 'Indicators' : this.legendFolded ? 'Show indicator legend' : 'Hide indicator legend'));
            btn.addEventListener('click', () => {
                if (this.overviewAction !== null) {
                    this.overviewAction();
                    return;
                }
                this.legendFolded = !this.legendFolded;
                this.syncFoldToggle();
            });
            this.foldToggle = btn;
        }
        const folded = this.legendFolded;
        btn.setAttribute('aria-label', this.overviewAction !== null ? 'Indicators' : folded ? 'Show indicator legend' : 'Hide indicator legend');
        // Bordered chip in both states; folded shows chevron then the count to its right
        // (reference: "˅ 12"), expanded is just the up chevron that folds the list away.
        // Fill AND ink follow the LIVE plot theme (same as legend rows) — chrome tokens
        // track the app surface, so a white plot on a dark app would otherwise put a
        // near-white count on a white chip. Extra margin-top clears the last indicator
        // title; the legend column's own 3px gap is too tight under a bordered chip.
        const ink = this.theme.textColor;
        btn.style.cssText = `pointer-events:auto;display:inline-flex;align-items:center;gap:4px;background:${this.theme.background};color:${ink};border:1px solid ${this.theme.borderColor};border-radius:4px;padding:2px 6px;margin-top:6px;cursor:pointer;font:inherit;line-height:0;`;
        btn.replaceChildren();
        const icon = document.createElement('span');
        // Slightly muted against the count — currentColor rides the button's ink.
        icon.style.cssText = 'display:inline-flex;align-items:center;line-height:0;opacity:0.7;';
        // The overview override wears the list glyph — the chip opens the host's
        // indicator overview rather than unfolding rows in place.
        icon.innerHTML = this.overviewAction !== null ? OVERVIEW_SVG : folded ? UNFOLD_SVG : FOLD_SVG;
        btn.appendChild(icon);
        if (folded) {
            const label = document.createElement('span');
            label.textContent = String(count);
            label.style.cssText = `font-weight:600;line-height:normal;font-size:12px;color:${ink};`;
            btn.appendChild(label);
        }
        // The toggle lives on the PRICE pane's legend (created on demand — the price pane
        // may carry no indicator itself while study panes do).
        this.legendFor('price').appendChild(btn);
        this.reposition(); // every pane's rows follow the fold, not just the price pane's
    }

    /** Create or update an indicator's legend row (in the legend for its pane). */
    upsert(id: string, title: string, inputs: InputSchema[], values: Record<string, InputValue>, paneId = 'price', opts: { native?: boolean; beta?: boolean; settingsTitle?: string } = {}): void {
        const settingsTitle = opts.settingsTitle ?? title;
        const existing = this.rows.get(id);
        if (existing) {
            existing.title = title;
            existing.settingsTitle = settingsTitle;
            existing.inputs = inputs;
            existing.values = { ...values };
            existing.titleEl.textContent = title;
            if (existing.paneId !== paneId) { // re-routed to a different pane
                existing.paneId = paneId;
                this.attach(this.legendFor(paneId), existing.el, existing.native);
                this.syncFoldToggle(); // a re-routed row must follow the fold state in its new pane
            }
            return;
        }
        // The row's control buttons draw their states from the shared scoped sheet, which must
        // therefore exist as soon as a legend row does — not only once a dialog has opened.
        ensureDialogStyles();
        const el = document.createElement('div');
        // Idle rows are translucent chips sized by their title (status dot and controls are
        // hidden) — enough wash to keep the label legible when candles reach it, without a
        // solid block over the plot. Hovering/selecting fills the chip with the solid chart
        // background so the revealed outline and controls stay readable (see setRowHighlighted).
        // Symmetric horizontal padding keeps the title clear of the hover outline; the
        // negative left margin cancels the left padding so the title's left edge still shares
        // the statusline avatar's left edge (both sit at the legend column's left:10px).
        // min-height matches the action hit targets so revealing them never grows the chip
        // vertically (which would shove the rows below).
        el.style.cssText =
            `pointer-events:auto;display:flex;align-items:center;` +
            `background:${this.idleRowFill()};border-radius:4px;` +
            `padding:${LEGEND_ROW_PAD_Y}px ${LEGEND_ROW_PAD_X}px;margin-left:-${LEGEND_ROW_PAD_X}px;` +
            `min-height:${LEGEND_ROW_MIN_H}px;box-sizing:border-box;` +
            `color:${this.theme.textColor};user-select:none;-webkit-user-select:none;`;
        // Reveal actions only from the TITLE (not the plot-values readout). Leave still
        // closes on the whole row so the pointer can move title → buttons without flicker.
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
        // Right-click opens the row's own action menu — swallowed here so the host's
        // chart-body context menu (bound higher up the tree) doesn't open over it.
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openRowMenu(id, e.clientX, e.clientY);
        });
        // Status indicator (right of the title): pulsing load dots while fetching, a
        // pulse while live, hidden when idle. Lives next to the title — not the row's
        // far end — so the dots stay a title companion even before values arrive.
        const statusEl = document.createElement('span');
        statusEl.style.cssText = 'display:none;box-sizing:border-box;flex:none;';
        // Title (+ optional "beta" exponent) wrapped so the superscript stays glued to the label and
        // survives title-text updates (which only touch the inner span).
        const titleWrap = document.createElement('span');
        titleWrap.style.cssText = 'white-space:nowrap;';
        titleWrap.addEventListener('mouseenter', () => this.setRowHighlighted(id, true));
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
        el.appendChild(statusEl);
        // Plot values readout, right of the title — filled by setPlotValues, hidden until
        // values arrive (or while the values toggle is off for this row).
        const valuesEl = document.createElement('span');
        valuesEl.style.cssText =
            `display:none;align-items:center;gap:5px;margin-left:${LEGEND_TITLE_VALUES_GAP_PX}px;` +
            `white-space:nowrap;font-variant-numeric:tabular-nums;`;
        el.appendChild(valuesEl);
        // Action cluster (eye / gear / move / extras / ✕) — one tight row of equal hit targets.
        // Revealed on hover/selection; a hidden indicator keeps its eye reachable without hover.
        const controlsEl = document.createElement('span');
        controlsEl.style.cssText =
            `display:none;align-items:center;gap:${LEGEND_ACTION_GAP_PX}px;flex:none;margin-left:${LEGEND_ACTION_GAP_PX}px;`;
        let eyeEl: HTMLButtonElement | null = null;
        if (this.onToggleVisible) {
            const eye = document.createElement('button');
            eye.type = 'button';
            eye.setAttribute('aria-label', 'Hide');
            this.tip(this.rowTips, id, eye, () => (this.rows.get(id)?.hidden ? 'Show' : 'Hide'));
            eye.innerHTML = EYE_SVG;
            eye.className = 'vela-ind-ctl';
            eye.style.cssText = LEGEND_CTL_CSS;
            eye.addEventListener('click', () => {
                const row = this.rows.get(id);
                this.onToggleVisible?.(id, Boolean(row?.hidden)); // currently hidden ⇒ request show, else hide
            });
            controlsEl.appendChild(eye);
            eyeEl = eye;
        }
        if (inputs.length > 0) {
            const gear = document.createElement('button');
            gear.type = 'button';
            gear.setAttribute('aria-label', 'Settings');
            this.tip(this.rowTips, id, gear, 'Settings');
            gear.innerHTML = GEAR_SVG;
            gear.className = 'vela-ind-ctl';
            gear.style.cssText = LEGEND_CTL_CSS;
            gear.addEventListener('click', () => this.openDialog(id));
            controlsEl.appendChild(gear);
        }
        // Move to — opens a small pane menu (Main chart / New pane above·below / existing panes).
        // Present only when the host wired a move API (i.e. the renderer supports pane management).
        if (this.moveApi) {
            const mv = document.createElement('button');
            mv.type = 'button';
            mv.setAttribute('aria-label', 'Move to pane');
            this.tip(this.rowTips, id, mv, 'Move to pane');
            mv.innerHTML = iconAt('move', LEGEND_ICON_PX);
            mv.className = 'vela-ind-ctl';
            mv.style.cssText = LEGEND_CTL_CSS;
            mv.addEventListener('click', (e) => { e.stopPropagation(); this.openMoveMenu(id, mv); });
            controlsEl.appendChild(mv);
        }
        // Host-contributed actions (registerLegendAction) — between the built-ins and ✕.
        const extrasEl = document.createElement('span');
        extrasEl.style.cssText = 'display:contents;';
        this.renderExtras(id, extrasEl);
        controlsEl.appendChild(extrasEl);
        // Remove (✕) — a built-in control to drop the indicator from the chart.
        const close = document.createElement('button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Remove indicator');
        this.tip(this.rowTips, id, close, 'Remove indicator');
        close.innerHTML = CLOSE_SVG;
        close.className = 'vela-ind-close';
        close.style.cssText = LEGEND_CTL_CSS;
        close.addEventListener('click', () => this.onRemove?.(id));
        controlsEl.appendChild(close);
        el.appendChild(controlsEl);

        this.attach(this.legendFor(paneId), el, !!opts.native);
        this.rows.set(id, { id, title, settingsTitle, inputs, values: { ...values }, el, titleEl, statusEl, valuesEl, plotValues: [], plotValuesKey: '', showValues: null, highlighted: false, paneId, hidden: false, eyeEl, controlsEl, extrasEl, native: !!opts.native });
        this.syncFoldToggle(); // 2+ indicators grow the fold chevron; a folded legend hides the new row too
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
     * Reflect an indicator's live status in its legend row: `'loading'` shows three pulsing
     * dots (a fetch is in flight — the same load affordance as the chart's own bar-load dots,
     * at legend scale), `'live'` a pulsing dot, `'idle'` nothing. Rendered just right of the title.
     */
    setStatus(id: string, status: 'idle' | 'loading' | 'live'): void {
        const row = this.rows.get(id);
        if (!row) return;
        const el = row.statusEl;
        el.replaceChildren(); // the load dots (and their Web Animations) die with the children
        if (status === 'idle') {
            el.style.cssText = 'display:none;box-sizing:border-box;flex:none;';
            return;
        }
        if (status === 'loading') {
            // line-height:0 kills the font strut so the 4px dots are the box; translateY is
            // optical — the dots already share the title's geometric midline, but 4px discs
            // next to 12px type read a hair high without the nudge.
            el.style.cssText =
                `display:inline-flex;align-items:center;gap:3px;box-sizing:border-box;flex:none;` +
                `margin-left:${LEGEND_TITLE_STATUS_GAP_PX}px;line-height:0;transform:translateY(1px);`;
            for (let i = 0; i < 3; i += 1) {
                const dot = document.createElement('span');
                dot.style.cssText = 'width:4px;height:4px;border-radius:50%;background:currentColor;opacity:0.15;flex:none;';
                // Staggered phases via negative delays — every dot animates from the first frame.
                dot.animate?.([{ opacity: 0.12 }, { opacity: 0.55 }], { duration: 800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out', delay: -i * 260 });
                el.appendChild(dot);
            }
            return;
        }
        // live — a pulsing filled dot
        this.ensureStatusKeyframes();
        el.style.cssText =
            `display:inline-block;box-sizing:border-box;flex:none;width:8px;height:8px;border-radius:50%;` +
            `margin-left:${LEGEND_TITLE_STATUS_GAP_PX}px;transform:translateY(1px);` +
            `background:${this.theme.upColor};animation:vela-ind-pulse 1.2s ease-in-out infinite;`;
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
            row.eyeEl.setAttribute('aria-label', visible ? 'Hide' : 'Show'); // the tooltip reads live state itself
        }
        this.syncRowActions(row);
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
     * Show or hide a row's outline and eye/gear/✕ controls together — driven by title
     * hover and selection (plot values do not open the chip). An idle unselected row
     * shows just its title (+ values). Exception: a hidden indicator keeps its eye
     * visible even when idle, so it can be un-hidden without hovering.
     */
    private setRowHighlighted(id: string, highlighted: boolean): void {
        const row = this.rows.get(id);
        if (!row) return;
        row.highlighted = highlighted;
        this.renderRowValues(row); // values step aside while the controls are out
        row.el.style.boxShadow = highlighted ? `inset 0 0 0 1px ${this.neutralBorder()}` : 'none';
        // The solid fill exists only while the row is open — an idle row is a translucent
        // title-sized chip that lets the plot show through while keeping the label legible.
        row.el.style.background = highlighted ? this.theme.background : this.idleRowFill();
        this.syncRowActions(row);
    }

    /**
     * Reveal the action cluster (or just the eye for a hidden indicator). Non-eye
     * buttons only appear while highlighted; the eye keeps its inline-flex from
     * construction and is shown/hidden with the cluster container.
     */
    private syncRowActions(row: LegendRow): void {
        const open = row.highlighted;
        row.controlsEl.style.display = open || row.hidden ? 'inline-flex' : 'none';
        for (const child of Array.from(row.controlsEl.children)) {
            if (!(child instanceof HTMLElement) || child === row.eyeEl) continue;
            if (child === row.extrasEl) {
                child.style.display = open ? 'contents' : 'none';
                continue;
            }
            child.style.display = open ? 'inline-flex' : 'none';
        }
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
        this.disposeTips(this.rowTips, id);
        this.disposeTips(this.extrasTips, id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.inputsDialog.openId === id) this.inputsDialog.close();
        this.syncFoldToggle(); // below 2 indicators the chevron goes (and a fold in force lifts)
        // Drop an emptied non-price pane legend container (the pane itself is gone too).
        if (row && row.paneId !== 'price') {
            const lg = this.legends.get(row.paneId);
            if (lg && lg.childElementCount === 0) { lg.remove(); this.legends.delete(row.paneId); }
        }
    }

    destroy(): void {
        this.inputsDialog.close();
        this.moveMenu?.destroy();
        this.moveMenu = null;
        this.rowMenu?.destroy();
        this.rowMenu = null;
        for (const id of [...this.rowTips.keys()]) this.disposeTips(this.rowTips, id);
        for (const id of [...this.extrasTips.keys()]) this.disposeTips(this.extrasTips, id);
        for (const lg of this.legends.values()) lg.remove();
        this.legends.clear();
        this.rows.clear();
        this.foldToggle = null; // its element left with the legend containers
        this.legendFolded = false;
        this.selectedId = null;
        if (typeof document !== 'undefined') document.removeEventListener('click', this.onDocClick);
    }

    /** True when an indicator's settings dialog is currently open. */
    isDialogOpen(): boolean {
        return this.inputsDialog.isOpen();
    }

    /**
     * Close the open settings dialog (if any), keeping any live edits — the same as **Ok** or ×.
     * Public so the host can dismiss it when it opens a competing dialog of its own.
     */
    closeOpenDialog(): void {
        this.inputsDialog.close();
    }


    private openDialog(id: string): void {
        const row = this.rows.get(id);
        if (row) this.inputsDialog.open(row);
    }

    /** Idle legend-row fill — a translucent wash of the chart background, so the title keeps
     *  contrast when candles reach it without laying a solid block over the plot. */
    private idleRowFill(): string {
        return withAlpha(this.theme.background, 0.6);
    }

    /** Neutral field/separator border — the shared chrome border token. */
    private neutralBorder(): string {
        return 'var(--vela-border)';
    }
}