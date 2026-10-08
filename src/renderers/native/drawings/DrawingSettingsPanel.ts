import type { VelaTheme } from '../../../core/options';
import type { Drawing, DrawingToolDefaults, DrawingToolTemplate, SerializedDrawing, SettingsField } from '../../../core/drawings';
import {
    DEFAULT_DRAWING_COLOR,
    FIB_PRESETS,
    FibLevels,
    FibRetracement,
    FixedRangeVolumeProfile,
    MachFigure,
    LINE_STYLE_OPTIONS,
    MAGNIFIER_TIMEFRAME_OPTIONS,
    PositionTool,
    TEXT_SIZE_OPTIONS,
    TIMEFRAME_BANDS,
    builtinToolTemplates,
    clonePlain,
    effectiveFillColor,
    getDrawingType,
    matchFibPreset,
    timeframeBandOf,
} from '../../../core/drawings';
import { applyChromeTokens } from '../../shared/theme-tokens';
import { Dialog } from '../../../ui/components/dialog';
import { Popover, closeOpenPopovers } from '../../../ui/components/popover';
import { buildFieldControl, fieldGrid } from '../../../ui/components/field';
import { TextArea } from '../../../ui/components/text-area';
import { formatTimeStamp, valueDecimals } from '../chrome/ticks';
import { buildPositionSection, buildProfileSection } from './DrawingSettingsSections';
import type { PopupAnchor, SettingsActions, SettingsPatch } from './DrawingSettingsPopup';

/** What the panel needs from the chart beyond the drawing itself. */
export interface DrawingPanelEnv {
    /** One chart bar in ms — marks the chart's own timeframe in the "Show on" picker. */
    chartBarMs(): number;
    /** The chart's time zone — point times read the same as the time axis. */
    timeZone(): string;
    /** Decimals of the symbol's price increment, or null when unknown. */
    priceDecimals(): number | null;
}

/** The tools whose label can slide along the line and sit under it. */
const LINE_LABEL_TYPES = new Set(['trendline', 'ray', 'extendedline', 'infoline', 'trendangle']);
/** Tools whose points are not worth listing: a free-hand stroke, a line with no price, or a
 *  position (its own section edits entry, stop and target). */
const NO_POINTS = new Set(['freehand', 'highlighter', 'vline', 'position']);
const MAX_POINTS = 8;
/** Paths the rich sections own, kept out of the generic rows. */
const POSITION_PATHS = new Set(['riskPercent', 'accountBalance', 'quantity', 'direction', 'entryPrice', 'stopPrice', 'targetPrice', 'showText', 'showHeader', 'showLossSize', 'showTargetLabel', 'showStopLabel', 'showPrices']);
const LEVEL_PATHS = new Set(['showRatios', 'showPrices', 'labelSide', 'background', 'reverse']);

/** "Show on" shortcuts, as timeframe bands. */
const INTRADAY = ['s', '1', '5', '15', '60', '240'];
const HIGHER = ['60', '240', 'D', 'W', 'M'];
type ShowMode = 'all' | 'intraday' | 'higher' | 'custom';

/** Which folds are open, per tool — remembered for the session so a panel reopens as it was left. */
const openFolds = new Map<string, Set<string>>();

const STYLE_ID = 'vela-dsp-styles';
const STYLE_REV = '1';

const CHEVRON = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4.5 2.5 3.5 3.5-3.5 3.5"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m2.5 4.5 3.5 3.5 3.5-3.5"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';
const EXTEND_ICONS: Record<string, string> = {
    none: '<svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 7h8"/><circle cx="5" cy="7" r="1.5" fill="currentColor"/><circle cx="13" cy="7" r="1.5" fill="currentColor"/></svg>',
    left: '<svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 7h12"/><path d="m3.5 4.5-2.5 2.5 2.5 2.5"/><circle cx="13" cy="7" r="1.5" fill="currentColor"/></svg>',
    right: '<svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 7h12"/><path d="m14.5 4.5 2.5 2.5-2.5 2.5"/><circle cx="5" cy="7" r="1.5" fill="currentColor"/></svg>',
    both: '<svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 7h16"/><path d="m3.5 4.5-2.5 2.5 2.5 2.5M14.5 4.5l2.5 2.5-2.5 2.5"/></svg>',
};
const widthIcon = (w: number): string => `<svg viewBox="0 0 18 14" width="18" height="14"><rect x="2" y="${7 - w / 2}" width="14" height="${w}" rx="${w / 2}" fill="currentColor"/></svg>`;
const dashIcon = (s: string): string =>
    `<svg viewBox="0 0 18 14" width="18" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="${s === 'dashed' ? '4 3' : s === 'dotted' ? '0.1 3.5' : '0'}"><path d="M2 7h14"/></svg>`;

function ensureStyles(): void {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (existing?.dataset.rev === STYLE_REV) return;
    const s = existing ?? document.createElement('style');
    s.id = STYLE_ID;
    s.dataset.rev = STYLE_REV;
    s.textContent = `
.vela-dsp-pass { pointer-events: none !important; }
.vela-dialog.vela-dsp { pointer-events: auto; width: 360px; min-width: 0; max-width: calc(100% - 24px); max-height: calc(100% - 24px); font-size: 13px; }
.vela-dsp .vela-dialog-header { padding: 8px 8px 8px 16px; gap: 6px; }
.vela-dsp .vela-dialog-title { font-size: 15px; line-height: 22px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dsp .vela-dialog-footer { padding: 10px 12px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vela-border); }
.vela-dsp .vela-dialog-btn { height: 30px; font-size: 13px; }
.vela-dsp-scroll { overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0; }
.vela-dsp-block { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.vela-dsp-block + .vela-dsp-block, .vela-dsp-fold { border-top: 1px solid var(--vela-border); }
.vela-dsp-h { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--vela-fg-muted); }
.vela-dsp-row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.vela-dsp-row[hidden], .vela-dsp-stack[hidden], .vela-dsp-chip[hidden] { display: none; }
.vela-dsp-stack { display: flex; flex-direction: column; gap: 6px; }
.vela-dsp-stack > .vela-dsp-lab { flex: none; }
.vela-dsp-lab { flex: 0 0 96px; color: var(--vela-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vela-dsp-row > .vela-dsp-lab + * { min-width: 0; }
.vela-dsp-spacer { flex: 1; }
.vela-dsp-fold-h { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; padding: 11px 16px; cursor: pointer; }
.vela-dsp-fold-h:hover { background: var(--vela-hover); }
.vela-dsp-fold-h:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: -2px; }
.vela-dsp-fold-t { font-weight: 600; color: var(--vela-fg-bright); white-space: nowrap; }
.vela-dsp-fold-s { flex: 1; min-width: 0; text-align: right; color: var(--vela-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.vela-dsp-chev { display: flex; color: var(--vela-fg-muted); transition: transform var(--vela-dur-fast) ease; }
.vela-dsp-fold[data-open] .vela-dsp-chev { transform: rotate(90deg); }
.vela-dsp-fold-b { padding: 0 16px 12px; display: flex; flex-direction: column; gap: 8px; }
.vela-dsp-fold:not([data-open]) .vela-dsp-fold-b { display: none; }
.vela-dsp-seg { display: inline-flex; flex: none; border: 1px solid var(--vela-border-strong); border-radius: 6px; overflow: hidden; }
.vela-dsp-seg[data-full] { display: flex; flex: 1; }
.vela-dsp-seg > button { all: unset; box-sizing: border-box; cursor: pointer; height: 28px; min-width: 32px; padding: 0 8px; display: flex; align-items: center; justify-content: center; color: var(--vela-fg-muted); white-space: nowrap; }
.vela-dsp-seg[data-full] > button { flex: 1 1 0; min-width: 0; }
.vela-dsp-seg > button + button { border-left: 1px solid var(--vela-border); }
.vela-dsp-seg > button:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dsp-seg > button[aria-pressed='true'] { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-dsp-seg > button:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: -2px; }
.vela-dsp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vela-dsp-chip { all: unset; box-sizing: border-box; cursor: pointer; height: 26px; padding: 0 10px; border-radius: 13px; border: 1px solid var(--vela-border-strong); color: var(--vela-fg-muted); display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.vela-dsp-chip:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-dsp-chip[aria-pressed='true'] { background: var(--vela-active); border-color: transparent; color: var(--vela-fg-bright); }
.vela-dsp-chip:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: 1px; }
.vela-dsp-note { font-size: 12px; color: var(--vela-fg-muted); line-height: 1.45; }
.vela-dsp-pt { display: grid; grid-template-columns: 34px minmax(0, 120px) minmax(0, 1fr); align-items: center; gap: 8px; min-height: 30px; }
.vela-dsp-pt-k { font-weight: 600; color: var(--vela-fg-muted); }
.vela-dsp-pt-t { color: var(--vela-fg-muted); font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vela-dsp-tf[hidden], .vela-dsp-note[hidden] { display: none; }
.vela-dsp-tf { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.vela-dsp-tf > button { all: unset; box-sizing: border-box; cursor: pointer; position: relative; height: 28px; border-radius: 6px; border: 1px solid var(--vela-border-strong); color: var(--vela-fg-muted); display: flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
.vela-dsp-tf > button:hover { color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-dsp-tf > button[aria-pressed='true'] { background: var(--vela-active); border-color: transparent; color: var(--vela-fg-bright); }
.vela-dsp-tf > button[data-here]::after { content: ''; position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--vela-selected-bg); }
.vela-dsp-grid { padding: 0; }
.vela-dsp-lv { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; }
.vela-dsp-lv-c { display: flex; align-items: center; gap: 6px; min-width: 0; }
.vela-dsp-lv-c .vela-num:not([data-fill])[data-compact] { width: 76px; }
.vela-dsp-lv-c .vela-num input { height: 28px; }
.vela-dsp-lv-c[data-off] .vela-num input { color: var(--vela-fg-muted); }
.vela-dsp-style { all: unset; box-sizing: border-box; cursor: pointer; flex: none; height: 28px; max-width: 150px; padding: 0 6px 0 10px; border-radius: 6px; border: 1px solid var(--vela-border-strong); display: inline-flex; align-items: center; gap: 4px; color: var(--vela-fg); font-size: 12px; }
.vela-dsp-style > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dsp-style:hover, .vela-dsp-style[aria-expanded='true'] { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-dsp-menu { min-width: 220px; max-height: 320px; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 1px; }
.vela-dsp-mh { padding: 6px 8px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--vela-fg-muted); }
.vela-dsp-mi { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 8px; padding: 0 4px 0 8px; height: 30px; border-radius: 5px; color: inherit; }
.vela-dsp-mi:hover, .vela-dsp-mi:focus-visible { background: var(--vela-hover-strong); }
.vela-dsp-mi[data-current] { color: var(--vela-fg-bright); font-weight: 600; }
.vela-dsp-mi > .vela-dsp-mi-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vela-dsp-mi-dot { flex: none; width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--vela-border-strong); }
.vela-dsp-mi-x { all: unset; cursor: pointer; flex: none; width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--vela-fg-muted); }
.vela-dsp-mi-x:hover { background: var(--vela-hover); color: var(--vela-danger); }
.vela-dsp-msep { height: 1px; background: var(--vela-border); margin: 4px 0; }
.vela-dsp-mname { display: flex; gap: 6px; padding: 4px; }
.vela-dsp-mname > input { flex: 1; min-width: 0; height: 28px; box-sizing: border-box; padding: 0 8px; border-radius: 6px; border: 1px solid var(--vela-border-strong); background: transparent; color: inherit; font: inherit; outline: none; }
.vela-dsp-mname > input:focus { border-color: var(--vela-selected-bg); }`;
    if (!existing) document.head.appendChild(s);
}

/** The mutable bits one panel build shares with its controls. */
interface Build {
    /** The drawing as it is now (every edit replaces the instance). */
    live(): Drawing;
    /** Apply a settings patch and refresh whatever reads from the drawing. */
    edit(p: SettingsPatch): void;
    /** Register a refresher, run now and after every edit or chart change. */
    watch(fn: () => void): void;
    /** Rebuild every section (a control set changed shape). */
    rebuild(): void;
    actions: SettingsActions;
}

/**
 * The full settings panel for one drawing — every option its tool has, laid out the same way
 * for every tool. The schema-driven core (style, text, the tool's own options) is followed by
 * folds for the label, the anchor points and the timeframes the drawing shows on; tools with
 * richer data (levels, position sizing, a volume profile) add their own section. Options that
 * only matter in some state appear when they apply. Edits are live; Cancel puts the drawing
 * back as it was when the panel opened. A style menu in the header applies, previews and
 * saves named looks for the tool.
 *
 * Non-modal: the chart stays interactive behind it, so the drawing's points can still be
 * dragged while the panel is open.
 */
export class DrawingSettingsPanel {
    private ui: Dialog | null = null;
    private menu: Popover | null = null;
    private refresh: (() => void) | null = null;
    private theme: VelaTheme;

    constructor(
        private readonly host: HTMLElement,
        theme: VelaTheme,
        private readonly env: DrawingPanelEnv,
    ) {
        this.theme = theme;
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
    }

    isOpen(): boolean {
        return this.ui != null;
    }

    contains(node: Node | null): boolean {
        if (!node) return false;
        if (this.ui?.contains(node) || this.menu?.el.contains(node)) return true;
        // Kit popovers (color picker, select lists) opened from the panel portal into the host.
        const el = node instanceof Element ? node : node.parentElement;
        const pop = el?.closest('.vela-popover');
        return pop != null && this.ui != null && this.host.contains(pop);
    }

    /** Re-read the drawing after a change made outside the panel (a drag, an undo). */
    sync(): void {
        this.refresh?.();
    }

    open(drawing: Drawing, actions: SettingsActions, anchor: PopupAnchor | null): void {
        this.close();
        ensureStyles();
        const first = actions.resolve() ?? drawing;
        const snapshot: SerializedDrawing = clonePlain(first.serialize());
        const live = (): Drawing => actions.resolve() ?? first;
        const meta = getDrawingType(first.type);

        const scroll = document.createElement('div');
        scroll.className = 'vela-dsp-scroll';
        let watchers: Array<() => void> = [];
        const runWatchers = (): void => {
            for (const fn of watchers) fn();
        };
        const build: Build = {
            live,
            edit: (p) => {
                actions.patch(p);
                runWatchers();
            },
            watch: (fn) => {
                watchers.push(fn);
                fn();
            },
            rebuild: () => {
                const top = scroll.scrollTop;
                watchers = [];
                scroll.replaceChildren(...this.sections(build));
                scroll.scrollTop = top;
                styleBtn.refresh();
            },
            actions,
        };

        const cancel = (): void => {
            actions.preview?.(null);
            actions.restore?.(snapshot);
            this.close();
        };
        const ui = new Dialog({
            host: this.host,
            title: meta?.label ?? 'Settings',
            modal: false,
            contained: true,
            align: 'center',
            draggable: true,
            flush: true,
            className: 'vela-dsp',
            closeOnEscape: false,
            footer: (foot) => foot.append(button('Cancel', false, cancel), button('Ok', true, () => this.close())),
            onOpenChange: (open) => {
                if (!open) this.close();
            },
        });
        applyChromeTokens(ui.panel, this.theme);
        ui.backdrop.classList.add('vela-dsp-pass');
        ui.positioner.classList.add('vela-dsp-pass');
        // Open on the side of the chart away from the drawing, so the drawing stays in view.
        const hostW = this.host.clientWidth;
        const leftHalf = anchor != null && hostW > 0 && anchor.x + anchor.w / 2 < hostW / 2;
        ui.positioner.style.justifyContent = leftHalf ? 'flex-end' : 'flex-start';
        ui.positioner.style.padding = '0 12px';

        const styleBtn = this.styleMenuButton(build);
        ui.titleEl.after(styleBtn.el);
        ui.body.appendChild(scroll);
        ui.panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (this.menu) this.menu.hide();
                else cancel();
            }
        });
        this.ui = ui;
        this.refresh = () => {
            if (!actions.resolve()) {
                this.close(); // the drawing went away (deleted, undone)
                return;
            }
            runWatchers();
            styleBtn.refresh();
        };
        build.rebuild();
        ui.show();
    }

    close(): void {
        this.menu?.hide();
        this.menu = null;
        this.refresh = null;
        const ui = this.ui;
        this.ui = null;
        ui?.destroy();
    }

    destroy(): void {
        this.close();
    }

    // ── sections ──

    private sections(b: Build): HTMLElement[] {
        const d = b.live();
        const schema = d.schema();
        const fields = schema.fields;
        const has = (path: string): boolean => fields.some((f) => f.path === path);
        const out: HTMLElement[] = [];

        if (schema.textIsContent && has('text.value')) out.push(this.textContentBlock(b, has));
        const style = this.styleBlock(b, fields, has);
        if (style) out.push(style);
        if (d.editableLevels()) out.push(this.levelsBlock(b));
        if (d instanceof PositionTool) out.push(this.richBlock('Position', (grid) => buildPositionSection(grid, d, b.actions, this.theme)));
        if (d instanceof FixedRangeVolumeProfile) out.push(this.richBlock('Profile', (grid) => buildProfileSection(grid, d, b.actions, this.theme)));
        const own = this.optionsBlock(b, fields, d);
        if (own) out.push(own);
        if (!schema.textIsContent && fields.some((f) => f.path.startsWith('text.'))) out.push(this.textFold(b, has));
        const points = this.pointsFold(b);
        if (points) out.push(points);
        out.push(this.showOnFold(b));
        return out;
    }

    /** Line, width, dash, ends and fill — the look every stroked tool shares. */
    private styleBlock(b: Build, fields: readonly SettingsField[], has: (p: string) => boolean): HTMLElement | null {
        const rows: HTMLElement[] = [];
        if (has('style.lineColor') || has('style.lineWidth')) {
            const ctrls: HTMLElement[] = [];
            if (has('style.lineColor')) ctrls.push(this.swatch(b, 'Line color', () => b.live().style.lineColor || DEFAULT_DRAWING_COLOR, 'style.lineColor'));
            const wf = fields.find((f) => f.path === 'style.lineWidth');
            if (wf) {
                // A marker's broad stroke (the highlighter's 4–60) outgrows the 1–4 ladder.
                if ((wf.min ?? 1) > 1) ctrls.push(this.number(b, 'Line width', () => b.live().style.lineWidth, 'style.lineWidth', wf));
                else ctrls.push(this.seg(b, 'Line width', [1, 2, 3, 4].map((w) => ({ value: w, html: widthIcon(w), title: `${w}px` })), () => b.live().style.lineWidth, (v) => b.edit({ 'style.lineWidth': v })));
            }
            rows.push(row('Line', ...ctrls));
        }
        if (has('style.lineStyle')) {
            rows.push(row('Style', this.seg(b, 'Line style', LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, html: dashIcon(o.value), title: o.label })), () => b.live().style.lineStyle, (v) => b.edit({ 'style.lineStyle': v }))));
        }
        if (has('style.extendLeft') && has('style.extendRight')) {
            const opts = [
                { value: 'none', html: EXTEND_ICONS.none!, title: "Don't extend" },
                { value: 'left', html: EXTEND_ICONS.left!, title: 'Extend left' },
                { value: 'right', html: EXTEND_ICONS.right!, title: 'Extend right' },
                { value: 'both', html: EXTEND_ICONS.both!, title: 'Extend both ways' },
            ];
            const read = (): string => {
                const { extendLeft: l, extendRight: r } = b.live().style;
                return l && r ? 'both' : l ? 'left' : r ? 'right' : 'none';
            };
            rows.push(row('Extend', this.seg(b, 'Extend', opts, read, (v) => b.edit({ 'style.extendLeft': v === 'left' || v === 'both', 'style.extendRight': v === 'right' || v === 'both' }))));
        }
        const arrows: HTMLElement[] = [];
        if (has('style.arrowLeft')) arrows.push(this.chip(b, 'Start arrow', () => !!b.live().style.arrowLeft, (on) => b.edit({ 'style.arrowLeft': on })));
        if (has('style.arrowRight')) arrows.push(this.chip(b, has('style.arrowLeft') ? 'End arrow' : 'Arrow', () => !!b.live().style.arrowRight, (on) => b.edit({ 'style.arrowRight': on })));
        if (arrows.length) rows.push(row('Ends', chips(...arrows)));
        if (has('style.fillColor')) {
            rows.push(row('Fill', this.swatch(b, 'Fill', () => effectiveFillColor(b.live(), this.theme) ?? b.live().style.fillColor ?? DEFAULT_DRAWING_COLOR, 'style.fillColor')));
        }
        // A computed label (no typed words) keeps its text styling with the look.
        if (!has('text.value') && has('text.color')) rows.push(row('Text', ...this.textStyling(b, has)));
        return rows.length ? block(null, ...rows) : null;
    }

    /** The tool's own options — every schema field the shared look and the rich sections
     *  don't cover, each as the control its kind calls for. */
    private optionsBlock(b: Build, fields: readonly SettingsField[], d: Drawing): HTMLElement | null {
        const skip = (f: SettingsField): boolean =>
            f.path.startsWith('style.') ||
            f.path.startsWith('text.') ||
            f.path.startsWith('frvp.') ||
            (d instanceof PositionTool && POSITION_PATHS.has(f.path)) ||
            (d.editableLevels() != null && LEVEL_PATHS.has(f.path));
        const rows: HTMLElement[] = [];
        const own = fields.filter((f) => !skip(f));
        // An option that matters only in some modes comes and goes with them.
        const shownWhen = (el: HTMLElement, f: SettingsField): HTMLElement => {
            const cond = f.when;
            if (cond) b.watch(() => (el.hidden = !cond.in.includes(readPath(b.live(), cond.path))));
            return el;
        };
        for (let i = 0; i < own.length; i += 1) {
            const f = own[i]!;
            const next = own[i + 1];
            // Several on/off options in a row read as one line of toggles.
            if (f.kind === 'boolean' && next?.kind === 'boolean') {
                const run: SettingsField[] = [];
                while (own[i]?.kind === 'boolean') run.push(own[i++]!);
                i -= 1;
                rows.push(chips(...run.map((r) => shownWhen(this.chip(b, r.label, () => readPath(b.live(), r.path) === true, (on) => b.edit({ [r.path]: on })), r))));
                continue;
            }
            // A short list of modes reads as buttons under its name, all choices in view.
            if (f.kind === 'select' && f.path !== 'magnifier.timeframe' && (f.options?.length ?? 0) >= 2 && (f.options?.length ?? 0) <= 4) {
                const opts = f.options!.map((o) => ({ value: o.value, html: o.label }));
                const read = (): string => String(readPath(b.live(), f.path) ?? '');
                const seg = this.seg(b, f.label, opts, read, (v) => b.edit({ [f.path]: v }), true);
                rows.push(shownWhen(f.options!.length > 2 ? stacked(f.label, seg) : row(f.label, seg), f));
                continue;
            }
            // "Upper line color" + "Upper line style" read as one "Upper line" row, and an upper /
            // lower color pair ("Upper band color", "Lower band color") as one "Bands" row.
            const base =
                f.kind === 'color' && next?.kind === 'lineStyle' ? pairBase(f.label, next.label)
                : f.kind === 'color' && next?.kind === 'color' ? upperLowerBase(f.label, next.label) ?? (f.label === 'Bullish' && next.label === 'Bearish' ? 'Colors' : null)
                : null;
            if (base) {
                const color = this.fieldControl(b, f);
                const style = this.fieldControl(b, next!);
                if (color && style) rows.push(row(base, color, style));
                i += 1;
                continue;
            }
            const ctrl = this.fieldControl(b, f);
            if (ctrl) rows.push(shownWhen(row(f.label, ctrl), f));
        }
        // Level numbers and their labels have their own sizes (fib-family tools).
        const props = d.serialize().props ?? {};
        const sizes = TEXT_SIZE_OPTIONS.map((o) => ({ value: o.value, html: o.label }));
        if ('numbersSize' in props) rows.push(row('Numbers', this.seg(b, 'Numbers size', sizes, () => (b.live().serialize().props?.numbersSize as string) ?? 'small', (v) => b.edit({ numbersSize: v }), true)));
        if ('labelsSize' in props) rows.push(row('Labels', this.seg(b, 'Labels size', sizes, () => (b.live().serialize().props?.labelsSize as string) ?? 'normal', (v) => b.edit({ labelsSize: v }), true)));
        return rows.length ? block(null, ...rows) : null;
    }

    private fieldControl(b: Build, f: SettingsField): HTMLElement | null {
        const read = (): unknown => readPath(b.live(), f.path);
        switch (f.kind) {
            case 'color':
                return this.swatch(b, f.label, () => (read() as string | undefined) || DEFAULT_DRAWING_COLOR, f.path);
            case 'lineStyle':
                return this.seg(b, f.label, LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, html: dashIcon(o.value), title: o.label })), () => read() as string, (v) => b.edit({ [f.path]: v }));
            case 'boolean':
                return this.switch(b, () => read() !== false && read() != null, (v) => b.edit({ [f.path]: v }));
            case 'number':
            case 'opacity':
                return this.number(b, f.label, () => Number(read() ?? 0), f.path, f);
            case 'select': {
                let options = f.options ?? [];
                if (f.path === 'magnifier.timeframe') {
                    // Only timeframes below the chart's own make sense for a lower-timeframe inset.
                    const chartMs = this.env.chartBarMs();
                    const lower = MAGNIFIER_TIMEFRAME_OPTIONS.filter((o) => !(chartMs > 0) || o.ms === 0 || o.ms < chartMs);
                    options = lower.map((o) => ({ value: o.value, label: o.label }));
                }
                if (options.length === 0) return null;
                const sel = buildFieldControl({ kind: 'select', options, value: String(read() ?? options[0]!.value), fill: false, theme: this.theme, onChange: (v) => b.edit({ [f.path]: maybeNumber(v, read()) }) });
                b.watch(() => sel.setValue?.(String(read() ?? '')));
                return sel.el;
            }
            case 'text': {
                const tf = buildFieldControl({ kind: 'text', value: String(read() ?? ''), fill: true, onChange: (v) => b.edit({ [f.path]: v }) });
                return tf.el;
            }
            default:
                return null;
        }
    }

    /** A levelled tool's levels: every level in a two-column grid (on/off, ratio, color) — the
     *  ones that are off stay listed, ready to switch on. A retracement leads with its ready-made
     *  sets; the horizontal fibs follow with how their level text and fill show. */
    private levelsBlock(b: Build): HTMLElement {
        const d = b.live();
        const rows: HTMLElement[] = [];
        const grid = document.createElement('div');
        grid.className = 'vela-dsp-lv';
        const key = (): string => JSON.stringify(b.live().editableLevels() ?? []);
        let last = '';
        // A level edited here is already shown — only a change from elsewhere (a preset, an
        // undo) rebuilds the grid, and never under the field being typed in.
        const mine = (p: SettingsPatch): void => {
            b.edit(p);
            last = key();
        };
        const fill = (): void => {
            last = key();
            grid.replaceChildren();
            const free = b.live() instanceof FibLevels; // horizontal levels may sit at or beyond either anchor
            (b.live().editableLevels() ?? []).forEach((lv, i) => {
                const cell = document.createElement('div');
                cell.className = 'vela-dsp-lv-c';
                cell.toggleAttribute('data-off', !lv.enabled);
                const on = buildFieldControl({
                    kind: 'switch',
                    checked: lv.enabled,
                    onChange: (v) => {
                        cell.toggleAttribute('data-off', !v);
                        mine({ [`levels.${i}.enabled`]: v });
                    },
                });
                let ratio = lv.ratio;
                const num = buildFieldControl({
                    kind: 'number',
                    value: lv.ratio,
                    min: free ? undefined : 0,
                    step: 0.01,
                    compact: true,
                    fill: false,
                    commit: 'blur',
                    title: `Level ${i + 1}`,
                    onChange: (n) => {
                        if (!Number.isFinite(n) || (!free && n <= 0)) {
                            num.setValue?.(ratio);
                            return;
                        }
                        ratio = n;
                        mine({ [`levels.${i}.ratio`]: n });
                    },
                });
                let color = lv.color;
                const swatch = buildFieldControl({
                    kind: 'color',
                    theme: this.theme,
                    title: `Level ${lv.ratio} color`,
                    get: () => color,
                    onChange: (v) => {
                        color = v;
                        mine({ [`levels.${i}.color`]: v });
                    },
                });
                cell.append(on.el, num.el, swatch.el);
                grid.appendChild(cell);
            });
        };
        b.watch(() => {
            if (key() !== last && !grid.contains(document.activeElement)) fill();
        });

        if (d instanceof FibRetracement) {
            rows.push(
                this.seg(
                    b,
                    'Level set',
                    FIB_PRESETS.map((p) => ({ value: p.key, html: p.label })),
                    () => {
                        const f = b.live() as FibRetracement;
                        return matchFibPreset(f.levels, f.reverse) ?? undefined;
                    },
                    (k) => {
                        const preset = FIB_PRESETS.find((p) => p.key === k)!;
                        b.edit({ levels: clonePlain(preset.levels), reverse: preset.reverse });
                    },
                    true,
                ),
            );
        }
        if (d instanceof MachFigure) rows.push(row('Ratios', this.switch(b, () => (b.live() as MachFigure).showRatios !== false, (v) => b.edit({ showRatios: v }))));
        rows.push(grid);
        if (d instanceof FibLevels) {
            const fib = (): FibLevels => b.live() as FibLevels;
            rows.push(row('Labels', chips(this.chip(b, 'Ratios', () => fib().showRatios, (on) => b.edit({ showRatios: on })), this.chip(b, 'Prices', () => fib().showPrices, (on) => b.edit({ showPrices: on })))));
            rows.push(
                row(
                    'Label side',
                    this.seg(b, 'Label side', [
                        { value: 'left', html: 'Left' },
                        { value: 'right', html: 'Right' },
                    ], () => fib().labelSide, (v) => b.edit({ labelSide: v })),
                ),
            );
            const flags = [this.chip(b, 'Background', () => fib().background, (on) => b.edit({ background: on }))];
            if (d instanceof FibRetracement) flags.push(this.chip(b, 'Reverse', () => (b.live() as FibRetracement).reverse, (on) => b.edit({ reverse: on })));
            rows.push(row('Show', chips(...flags)));
        }
        return block('Levels', ...rows);
    }

    /** A rich per-type section on the shared field grid. */
    private richBlock(title: string, fill: (grid: HTMLElement) => void): HTMLElement {
        const grid = fieldGrid({ variant: 'inputs' });
        grid.classList.add('vela-dsp-grid');
        fill(grid);
        return block(title, grid);
    }

    /** A note, a callout, a text label: the words lead the panel. */
    private textContentBlock(b: Build, has: (p: string) => boolean): HTMLElement {
        return block(null, this.textArea(b, 'Text', 3), row('Style', ...this.textStyling(b, has)));
    }

    /** A shape's optional label: folded to one line saying what it reads. */
    private textFold(b: Build, has: (p: string) => boolean): HTMLElement {
        const type = b.live().type;
        const words = (): string => b.live().text?.value?.trim() ?? '';
        const summary = (): string => {
            if (!has('text.value')) return sizeLabel(b.live().text?.size);
            const w = words();
            return w ? `“${w.split('\n')[0]}”` : 'None';
        };
        return this.fold(b, 'text', has('text.value') ? 'Label' : 'Text', summary, () => {
            const rows: HTMLElement[] = [];
            if (has('text.value')) rows.push(this.textArea(b, 'Add a label', 1));
            rows.push(row('Style', ...this.textStyling(b, has)));
            if (LINE_LABEL_TYPES.has(type) && has('text.value')) {
                const place = row(
                    'Place',
                    this.seg(b, 'Position along the line', [
                        { value: 'start', html: 'Start' },
                        { value: 'middle', html: 'Middle' },
                        { value: 'end', html: 'End' },
                    ], () => b.live().text?.place ?? 'middle', (v) => b.edit({ 'text.place': v }), true),
                );
                const side = row(
                    'Side',
                    this.seg(b, 'Side of the line', [
                        { value: 'above', html: 'Above' },
                        { value: 'below', html: 'Below' },
                    ], () => b.live().text?.side ?? 'above', (v) => b.edit({ 'text.side': v }), true),
                );
                // Where the label sits only matters once there is one.
                b.watch(() => (place.hidden = side.hidden = words() === ''));
                rows.push(place, side);
            }
            return rows;
        });
    }

    private textArea(b: Build, placeholder: string, rows: number): HTMLElement {
        const ta = new TextArea({
            value: b.live().text?.value ?? '',
            rows,
            size: 'sm',
            autoGrow: true,
            maxLines: 6,
            placeholder,
            onChange: (v) => b.edit({ 'text.value': v }),
        });
        ta.input.addEventListener('input', () => b.edit({ 'text.value': ta.input.value }));
        ta.input.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') e.stopPropagation(); // typing never reaches chart shortcuts
        });
        b.watch(() => {
            const v = b.live().text?.value ?? '';
            if (document.activeElement !== ta.input && ta.input.value !== v) ta.input.value = v;
        });
        ta.el.style.width = '100%';
        return ta.el;
    }

    private textStyling(b: Build, has: (p: string) => boolean): HTMLElement[] {
        const out: HTMLElement[] = [];
        if (has('text.color')) out.push(this.swatch(b, 'Text color', () => b.live().text?.color || this.theme.textColor, 'text.color'));
        if (has('text.size')) {
            const sel = buildFieldControl({
                kind: 'select',
                options: TEXT_SIZE_OPTIONS,
                value: b.live().text?.size ?? 'normal',
                fill: false,
                theme: this.theme,
                onChange: (v) => b.edit({ 'text.size': v }),
            });
            b.watch(() => sel.setValue?.(b.live().text?.size ?? 'normal'));
            out.push(sel.el);
        }
        const flags: HTMLElement[] = [];
        if (has('text.bold')) flags.push(this.chip(b, 'B', () => !!b.live().text?.bold, (on) => b.edit({ 'text.bold': on }), 'Bold'));
        if (has('text.italic')) flags.push(this.chip(b, 'I', () => !!b.live().text?.italic, (on) => b.edit({ 'text.italic': on }), 'Italic'));
        if (flags.length) out.push(chips(...flags));
        return out;
    }

    /** Each anchor's price (editable) and time. */
    private pointsFold(b: Build): HTMLElement | null {
        const d = b.live();
        if (NO_POINTS.has(d.type) || d.anchors.length === 0 || d.anchors.length > MAX_POINTS) return null;
        const slots = d.anchorSchema().slots;
        const free = (i: number): string => slots[i]?.free ?? slots[slots.length - 1]?.free ?? 'both';
        const shown = d.anchors.map((_, i) => i).filter((i) => free(i) !== 'none');
        if (shown.length === 0) return null;
        const priced = shown.filter((i) => free(i) !== 'x');
        // Shown to the symbol's price increment (or a sensible precision for the price's size).
        const shownPrice = (n: number): number => {
            const dec = this.env.priceDecimals() ?? Math.max(2, valueDecimals(n));
            return Number(n.toFixed(Math.min(dec, 10)));
        };
        const fmt = (n: number): string => String(shownPrice(n));
        const summary = (): string => {
            const a = b.live().anchors;
            if (priced.length) return priced.map((i) => fmt(a[i]?.price ?? 0)).join(' → ');
            const t = a[shown[0]!]?.time;
            return shown.length === 1 && t != null ? formatTimeStamp(t, this.env.timeZone(), this.env.chartBarMs()) : `${shown.length} points`;
        };
        return this.fold(b, 'points', 'Points', summary, () =>
            shown.map((i, n) => {
                const key = shown.length === 1 ? (free(i) === 'x' ? 'Time' : 'Price') : String.fromCharCode(65 + n);
                const line = document.createElement('div');
                line.className = 'vela-dsp-pt';
                const k = document.createElement('span');
                k.className = 'vela-dsp-pt-k';
                k.textContent = key;
                line.appendChild(k);
                if (free(i) !== 'x') {
                    const ni = buildFieldControl({
                        kind: 'number',
                        value: shownPrice(d.anchors[i]!.price),
                        fill: true,
                        commit: 'blur',
                        title: `Point ${key} price`,
                        onChange: (v) => b.edit({ [`anchors.${i}.price`]: v }),
                    });
                    const input = ni.el.querySelector('input');
                    b.watch(() => {
                        if (document.activeElement !== input) ni.setValue?.(shownPrice(b.live().anchors[i]?.price ?? 0));
                    });
                    line.appendChild(ni.el);
                } else {
                    line.appendChild(document.createElement('span'));
                }
                const t = document.createElement('span');
                t.className = 'vela-dsp-pt-t';
                b.watch(() => {
                    const time = b.live().anchors[i]?.time;
                    t.textContent = time != null ? formatTimeStamp(time, this.env.timeZone(), this.env.chartBarMs()) : '';
                });
                line.appendChild(t);
                return line;
            }),
        );
    }

    /** The timeframes the drawing shows on: one line while it's every timeframe, the band
     *  picker only once the user goes custom. */
    private showOnFold(b: Build): HTMLElement {
        const bands = (): readonly string[] | undefined => b.live().showOn;
        let mode: ShowMode = modeOf(bands());
        const here = timeframeBandOf(this.env.chartBarMs());
        const summary = (): string => {
            const s = bands();
            if (!s) return 'All timeframes';
            if (mode === 'intraday') return 'Intraday';
            if (mode === 'higher') return '1H and up';
            if (s.length === 0) return 'Nowhere';
            return s.map((k) => TIMEFRAME_BANDS.find((t) => t.key === k)?.label ?? k).join(', ');
        };
        return this.fold(b, 'show', 'Show on', summary, () => {
            const set = (next: string[] | undefined): void => b.edit({ showOn: next });
            const pick = this.seg(
                b,
                'Show on',
                [
                    { value: 'all', html: 'All' },
                    { value: 'intraday', html: 'Intraday' },
                    { value: 'higher', html: '1H and up' },
                    { value: 'custom', html: 'Custom' },
                ],
                () => mode,
                (v) => {
                    mode = v as ShowMode;
                    if (mode === 'all') set(undefined);
                    else if (mode === 'intraday') set([...INTRADAY]);
                    else if (mode === 'higher') set([...HIGHER]);
                    else set([...(bands() ?? TIMEFRAME_BANDS.map((t) => t.key))]); // start from what shows now
                },
                true,
            );
            const grid = document.createElement('div');
            grid.className = 'vela-dsp-tf';
            for (const band of TIMEFRAME_BANDS) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = band.label;
                if (band.key === here) {
                    btn.dataset.here = '';
                    btn.title = "The chart's timeframe";
                }
                btn.addEventListener('click', () => {
                    const cur = new Set(bands() ?? []);
                    if (cur.has(band.key)) cur.delete(band.key);
                    else cur.add(band.key);
                    set(TIMEFRAME_BANDS.map((t) => t.key).filter((k) => cur.has(k)));
                });
                b.watch(() => btn.setAttribute('aria-pressed', String(bands()?.includes(band.key) ?? true)));
                grid.appendChild(btn);
            }
            const note = document.createElement('div');
            note.className = 'vela-dsp-note';
            b.watch(() => {
                grid.hidden = mode !== 'custom';
                const s = bands();
                const hidden = s != null && here != null && !s.includes(here);
                note.hidden = !hidden;
                note.textContent = s?.length === 0 ? 'Hidden on every timeframe.' : "Hidden on this chart's timeframe.";
            });
            return [pick, grid, note];
        });
    }

    // ── the style menu ──

    /** The header's style menu: the tool's ready-made and saved looks (hover to preview, click
     *  to apply), saving the current look, and going back to the tool's defaults. */
    private styleMenuButton(b: Build): { el: HTMLElement; refresh(): void } {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-dsp-style';
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        const label = document.createElement('span');
        const chev = document.createElement('span');
        chev.style.display = 'flex';
        chev.innerHTML = CHEVRON_DOWN;
        btn.append(label, chev);
        const all = (): DrawingToolTemplate[] => [...builtinToolTemplates(b.live().type), ...(b.actions.templates?.() ?? [])];
        const refresh = (): void => {
            const match = all().filter((t) => matchesTemplate(b.live(), t.settings)).pop();
            label.textContent = match?.name ?? 'Style';
            btn.title = match ? `Style: ${match.name}` : 'Styles';
        };
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.menu) {
                this.menu.hide();
                return;
            }
            this.openStyleMenu(btn, b, all, refresh);
        });
        refresh();
        return { el: btn, refresh };
    }

    private openStyleMenu(anchor: HTMLElement, b: Build, all: () => DrawingToolTemplate[], refresh: () => void): void {
        closeOpenPopovers();
        const t = this.theme;
        const pop = new Popover({
            trigger: anchor,
            host: this.host,
            theme: t,
            position: 'absolute',
            boundary: this.host,
            boundaryInset: 4,
            viewportInset: 0,
            gap: 6,
            align: 'end',
            zIndex: 6000,
            onClose: () => {
                b.actions.preview?.(null);
                anchor.setAttribute('aria-expanded', 'false');
                if (this.menu === pop) this.menu = null;
            },
        });
        const el = pop.el;
        el.classList.add('vela-dsp-menu');
        el.setAttribute('role', 'menu');
        el.style.cssText += `background:${t.background};border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);color:${t.textColor};font:13px ${t.fontFamily};pointer-events:auto;`;
        applyChromeTokens(el, t);

        const fill = (): void => {
            el.replaceChildren();
            const builtins = builtinToolTemplates(b.live().type);
            const saved = b.actions.templates?.() ?? [];
            const item = (tpl: DrawingToolTemplate, removable: boolean): HTMLElement => {
                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'vela-dsp-mi';
                row.setAttribute('role', 'menuitem');
                if (matchesTemplate(b.live(), tpl.settings)) row.dataset.current = '';
                const dot = document.createElement('span');
                dot.className = 'vela-dsp-mi-dot';
                dot.style.background = templateColor(tpl.settings) ?? 'transparent';
                const name = document.createElement('span');
                name.className = 'vela-dsp-mi-t';
                name.textContent = tpl.name;
                row.append(dot, name);
                if (removable) {
                    const x = document.createElement('span');
                    x.className = 'vela-dsp-mi-x';
                    x.setAttribute('role', 'button');
                    x.setAttribute('aria-label', `Delete ${tpl.name}`);
                    x.innerHTML = CROSS;
                    x.addEventListener('click', (e) => {
                        e.stopPropagation();
                        b.actions.preview?.(null);
                        b.actions.removeTemplate?.(tpl.name);
                        fill();
                        refresh();
                    });
                    row.appendChild(x);
                }
                row.addEventListener('pointerenter', () => b.actions.preview?.(tpl.settings));
                row.addEventListener('pointerleave', () => b.actions.preview?.(null));
                row.addEventListener('click', () => {
                    b.actions.preview?.(null);
                    b.actions.applyToolSettings?.(tpl.settings);
                    pop.hide();
                    b.rebuild();
                });
                return row;
            };
            if (builtins.length) {
                el.appendChild(menuHeading('Presets'));
                for (const tpl of builtins) el.appendChild(item(tpl, false));
            }
            if (saved.length) {
                el.appendChild(menuHeading('Saved'));
                for (const tpl of saved) el.appendChild(item(tpl, true));
            }
            if (builtins.length || saved.length) el.appendChild(separator());
            if (b.actions.saveTemplate) el.appendChild(this.saveRow(b, fill, refresh));
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'vela-dsp-mi';
            reset.setAttribute('role', 'menuitem');
            reset.innerHTML = '<span class="vela-dsp-mi-t">Reset to default</span>';
            reset.addEventListener('click', () => {
                b.actions.resetSettings();
                pop.hide();
                b.rebuild();
            });
            el.appendChild(reset);
        };
        fill();
        anchor.setAttribute('aria-expanded', 'true');
        this.menu = pop;
        pop.show();
    }

    /** "Save as style…": a menu row that turns into a name field. */
    private saveRow(b: Build, refill: () => void, refresh: () => void): HTMLElement {
        const wrap = document.createElement('div');
        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'vela-dsp-mi';
        start.setAttribute('role', 'menuitem');
        start.innerHTML = '<span class="vela-dsp-mi-t">Save as style…</span>';
        start.addEventListener('click', (e) => {
            e.stopPropagation();
            const form = document.createElement('div');
            form.className = 'vela-dsp-mname';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Style name';
            input.maxLength = 60;
            input.setAttribute('aria-label', 'Style name');
            const save = button('Save', true, () => commit());
            save.style.height = '28px';
            const commit = (): void => {
                const name = input.value.trim();
                if (!name) return;
                b.actions.saveTemplate?.(name);
                refill();
                refresh();
            };
            input.addEventListener('keydown', (ev) => {
                ev.stopPropagation();
                if (ev.key === 'Enter') commit();
                if (ev.key === 'Escape') refill();
            });
            form.append(input, save);
            wrap.replaceChildren(form);
            input.focus();
        });
        wrap.appendChild(start);
        return wrap;
    }

    // ── controls ──

    /** A fold: a one-line header saying what's set, opening to its rows. */
    private fold(b: Build, key: string, title: string, summary: () => string, body: () => HTMLElement[]): HTMLElement {
        const type = b.live().type;
        const open = openFolds.get(type) ?? new Set<string>();
        openFolds.set(type, open);
        const wrap = document.createElement('div');
        wrap.className = 'vela-dsp-fold';
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'vela-dsp-fold-h';
        const t = document.createElement('span');
        t.className = 'vela-dsp-fold-t';
        t.textContent = title;
        const s = document.createElement('span');
        s.className = 'vela-dsp-fold-s';
        const chev = document.createElement('span');
        chev.className = 'vela-dsp-chev';
        chev.innerHTML = CHEVRON;
        head.append(t, s, chev);
        const content = document.createElement('div');
        content.className = 'vela-dsp-fold-b';
        let built = false;
        const setOpen = (on: boolean): void => {
            if (on) open.add(key);
            else open.delete(key);
            wrap.toggleAttribute('data-open', on);
            head.setAttribute('aria-expanded', String(on));
            if (on && !built) {
                built = true;
                content.append(...body());
            }
        };
        head.addEventListener('click', () => setOpen(!open.has(key)));
        b.watch(() => (s.textContent = summary()));
        setOpen(open.has(key));
        wrap.append(head, content);
        return wrap;
    }

    private seg<T extends string | number>(
        b: Build,
        label: string,
        options: ReadonlyArray<{ value: T; html: string; title?: string }>,
        read: () => T | undefined,
        pick: (v: T) => void,
        full = false,
    ): HTMLElement {
        const el = document.createElement('div');
        el.className = 'vela-dsp-seg';
        el.setAttribute('role', 'group');
        el.setAttribute('aria-label', label);
        if (full) el.dataset.full = '';
        const buttons = options.map((o) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerHTML = o.html;
            if (o.title) {
                btn.title = o.title;
                btn.setAttribute('aria-label', o.title);
            }
            btn.addEventListener('click', () => {
                pick(o.value);
                sync();
            });
            el.appendChild(btn);
            return btn;
        });
        const sync = (): void => {
            const cur = read();
            options.forEach((o, i) => buttons[i]!.setAttribute('aria-pressed', String(o.value === cur)));
        };
        b.watch(sync);
        return el;
    }

    private chip(b: Build, text: string, read: () => boolean, set: (on: boolean) => void, title?: string): HTMLElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vela-dsp-chip';
        btn.textContent = text;
        if (title) {
            btn.title = title;
            btn.setAttribute('aria-label', title);
        }
        if (text === 'B') btn.style.fontWeight = '700';
        if (text === 'I') btn.style.fontStyle = 'italic';
        btn.addEventListener('click', () => set(!read()));
        b.watch(() => btn.setAttribute('aria-pressed', String(read())));
        return btn;
    }

    private swatch(b: Build, title: string, read: () => string, path: string): HTMLElement {
        const ctrl = buildFieldControl({ kind: 'color', theme: this.theme, title, get: read, onChange: (v) => b.edit({ [path]: v }) });
        return ctrl.el;
    }

    private switch(b: Build, read: () => boolean, set: (v: boolean) => void): HTMLElement {
        const sw = buildFieldControl({ kind: 'switch', checked: read(), onChange: set });
        b.watch(() => sw.setValue?.(read()));
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex:1;justify-content:flex-end;';
        wrap.appendChild(sw.el);
        return wrap;
    }

    private number(b: Build, title: string, read: () => number, path: string, f: { min?: number; max?: number; step?: number }): HTMLElement {
        const step = f.step ?? 1;
        const ni = buildFieldControl({
            kind: 'number',
            value: read(),
            min: f.min,
            max: f.max,
            step,
            integer: step >= 1 && Number.isInteger(step),
            fill: false,
            commit: 'blur',
            title,
            onChange: (v) => b.edit({ [path]: v }),
        });
        const input = ni.el.querySelector('input');
        b.watch(() => {
            if (document.activeElement !== input) ni.setValue?.(read());
        });
        return ni.el;
    }
}

// ── helpers ──

function block(title: string | null, ...rows: HTMLElement[]): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-block';
    if (title) {
        const h = document.createElement('div');
        h.className = 'vela-dsp-h';
        h.textContent = title;
        el.appendChild(h);
    }
    el.append(...rows);
    return el;
}

function row(label: string, ...controls: HTMLElement[]): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-row';
    const lab = document.createElement('span');
    lab.className = 'vela-dsp-lab';
    lab.textContent = label;
    lab.title = label;
    el.append(lab, ...controls);
    return el;
}

/** A control under its name, spanning the panel (a row of modes too wide to sit beside it). */
function stacked(label: string, control: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-stack';
    const lab = document.createElement('span');
    lab.className = 'vela-dsp-lab';
    lab.textContent = label;
    el.append(lab, control);
    return el;
}

function chips(...items: HTMLElement[]): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-chips';
    el.append(...items);
    return el;
}

function menuHeading(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-mh';
    el.textContent = text;
    return el;
}

function separator(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'vela-dsp-msep';
    return el;
}

function button(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = primary ? 'vela-dialog-btn vela-dialog-btn-primary' : 'vela-dialog-btn';
    b.addEventListener('click', onClick);
    return b;
}

function sizeLabel(size: string | undefined): string {
    return TEXT_SIZE_OPTIONS.find((o) => o.value === (size ?? 'normal'))?.label ?? 'Normal';
}

/** Read a dotted settings path off a drawing (the read side of `applySettings`). */
function readPath(d: Drawing, path: string): unknown {
    let cur: unknown = d;
    for (const k of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
}

/** The shared name of a color field and its line-style twin ("Midline color" + "Midline
 *  style" → "Midline"), or null when they don't pair up. */
function pairBase(colorLabel: string, styleLabel: string): string | null {
    const c = /^(.*) colou?r$/i.exec(colorLabel);
    const st = /^(.*) style$/i.exec(styleLabel);
    return c && st && c[1] === st[1] ? c[1]! : null;
}

/** The shared name of an upper / lower color pair ("Upper band color" + "Lower band color" →
 *  "Bands", "Upper fill" + "Lower fill" → "Fill"), or null when they don't pair up. */
function upperLowerBase(upper: string, lower: string): string | null {
    const u = /^Upper (.+)$/i.exec(upper);
    const l = /^Lower (.+)$/i.exec(lower);
    if (!u || !l || u[1] !== l[1]) return null;
    const name = u[1]!.replace(/ colou?r$/i, '');
    const word = name.charAt(0).toUpperCase() + name.slice(1);
    return /fill$/i.test(word) ? word : `${word}s`;
}

/** A select hands back strings; keep a numeric setting numeric. */
function maybeNumber(v: string, prev: unknown): string | number {
    return typeof prev === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
}

function modeOf(showOn: readonly string[] | undefined): ShowMode {
    if (!showOn) return 'all';
    const same = (a: readonly string[]): boolean => a.length === showOn.length && a.every((k) => showOn.includes(k));
    if (same(INTRADAY)) return 'intraday';
    if (same(HIGHER)) return 'higher';
    return 'custom';
}

/** Whether a drawing already wears a style: every setting the style names matches. */
export function matchesTemplate(d: Drawing, s: DrawingToolDefaults): boolean {
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const style = d.style as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(s.style ?? {})) if (!same(style[k], v)) return false;
    const text = (d.text ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(s.text ?? {})) if (!same(text[k], v)) return false;
    const props = d.serialize().props ?? {};
    for (const [k, v] of Object.entries(s.props ?? {})) if (!same(props[k], v)) return false;
    return Object.keys(s.style ?? {}).length + Object.keys(s.text ?? {}).length + Object.keys(s.props ?? {}).length > 0;
}

/** The color a style is best recognized by, for its menu swatch. */
function templateColor(s: DrawingToolDefaults): string | undefined {
    return s.style?.lineColor ?? s.style?.fillColor ?? s.text?.color;
}
