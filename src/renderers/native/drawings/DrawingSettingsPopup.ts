import type { VelaTheme } from '../../../core/options';
import type { Drawing, RegressionStyle, VwapStyle, SerializedDrawing } from '../../../core/drawings';
import {
    DEFAULT_DRAWING_COLOR,
    TEXT_SIZE_OPTIONS,
    LINE_STYLE_OPTIONS,
    GLYPH_OPTIONS,
    STAMP_SIZE_OPTIONS,
    DEDEKIND_CURVATURE_OPTIONS,
    MACH_WAVE_COUNT_OPTIONS,
    MACH_NUMBER_OPTIONS,
    MachFigure,
    FixedRangeVolumeProfile,
    PositionTool,
    Magnifier,
    MAGNIFIER_TIMEFRAME_OPTIONS,
    magnifierTimeframeLabel,
    effectiveFillColor,
} from '../../../core/drawings';
import { icon, svg24, svg24Solid } from '../../../core/icons';
import { applyChromeTokens } from '../../shared/theme-tokens';
import { contrastColor } from '../../shared/drawing-geometry';
import { NumberInput } from '../../../ui/components/number-input';
import { TextArea } from '../../../ui/components/text-area';
import { buildColorPicker } from '../../../ui/components/color-picker';
import { Popover, closeOpenPopovers } from '../../../ui/components/popover';
import { DrawingSettingsDialog } from './DrawingSettingsDialog';

/** A `{ path: value }` patch emitted as the user edits a control. */
export type SettingsPatch = Record<string, unknown>;

/** The actions a settings popup can invoke (wired by the controller to intents). With several
 *  drawings selected every action applies to all of them. */
export interface SettingsActions {
    /** The current live PRIMARY instance (sync rebuilds instances, so panels re-read through this). */
    resolve(): Drawing | null;
    patch(p: SettingsPatch): void;
    setLocked(v: boolean): void;
    reorder(to: 'front' | 'back'): void;
    /** Clone the drawing(s) in place (the copies become the selection). */
    duplicate(): void;
    resetSettings(): void;
    remove(): void;
    /** Restore a serialized snapshot (Cancel in the settings dialog). */
    restore?(doc: SerializedDrawing): void;
}

/** The value of a control whose drawings disagree — the bar shows it as "mixed" and the first
 *  edit unifies them. */
export const MIXED: unique symbol = Symbol('mixed');
export type Mixed = typeof MIXED;

/** The settings paths every one of `drawings` supports — what a multi-selection bar can edit. */
export function sharedPaths(drawings: readonly Drawing[]): Set<string> {
    const [first, ...rest] = drawings;
    const paths = new Set(first?.schema().fields.map((f) => f.path) ?? []);
    for (const d of rest) {
        const own = new Set(d.schema().fields.map((f) => f.path));
        for (const p of paths) if (!own.has(p)) paths.delete(p);
    }
    return paths;
}

/** One value read off every drawing: the shared value when they all agree, else {@link MIXED}. */
export function commonValue<T>(drawings: readonly Drawing[], read: (d: Drawing) => T): T | Mixed {
    const first = read(drawings[0]!);
    return drawings.every((d) => read(d) === first) ? first : MIXED;
}

/** The distinct values a mixed control spans (first-seen order) — the "in use" shortcuts. */
function distinctValues<T>(drawings: readonly Drawing[], read: (d: Drawing) => T): T[] {
    return [...new Set(drawings.map(read))];
}

/** The drawing's pixel bounding box, so the toolbar floats clear of it (not over it). */
export interface PopupAnchor {
    x: number;
    y: number;
    w: number;
    h: number;
}

const BTN = 30; // icon-button side (px)
const ICON = 21; // icon glyph side (px)
const STYLE_ID = 'vela-drawing-popup-styles';
const STYLE_REV = '4';

/** Inject the scoped styles that inline cssText can't reach (`:focus`, scrollbar
 *  pseudo-elements). Idempotent — one shared sheet for all popups. */
function ensureStyles(): void {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (existing?.dataset.rev === STYLE_REV) return;
    const s = existing ?? document.createElement('style');
    s.id = STYLE_ID;
    s.dataset.rev = STYLE_REV;
    s.textContent = `
.vela-dpop-btn{background:transparent;color:var(--vela-fg-muted);transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-dpop-btn:hover{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-dpop-btn[data-active='1']{background:var(--vela-active);color:var(--vela-fg-bright);}
/* Mixed (a multi-selection disagrees): the active fill at half strength behind a dashed ring. */
.vela-dpop-btn[data-active='mixed']{background:var(--vela-hover-strong);color:var(--vela-fg-bright);outline:1px dashed var(--vela-fg-muted);outline-offset:-2px;}
.vela-dpop-item{background:transparent;transition:background var(--vela-dur-fast) ease;}
.vela-dpop-item:hover{background:var(--vela-hover-strong);}
.vela-dpop-item[data-active='1']{background:var(--vela-active);}
/* A finger needs a wider grab zone than a cursor — grow the move handle on touch-first
   devices (the glyph stays centered; only the hit target widens). */
@media (pointer: coarse){.vela-dpop-grip{width:${BTN + 14}px !important;}}`;
    if (!existing) document.head.appendChild(s);
}

/**
 * A compact **horizontal** quick toolbar for the selected drawing: a leading move handle,
 * a row of icon controls (color/width/style/fill/text), then the trailing group — settings
 * wheel, lock, delete, and a kebab overflow (bring to front / send to back / reset
 * settings). A floating hover-label flips above/below the bar depending on where it
 * sits. Floats clear of the drawing (never over it) but is freely draggable. Controls
 * present themselves from the drawing's `schema()` paths, so each type only shows what
 * it supports. Pure vanilla DOM on the renderer `wrapper` (embeds anywhere).
 */
export class DrawingSettingsPopup {
    private el: HTMLDivElement | null = null;
    private tipEl: HTMLDivElement | null = null; // floating hover-label (above/below the toolbar)
    private textPanel: HTMLDivElement | null = null;
    private readonly settingsDialog: DrawingSettingsDialog;
    private colorPop: Popover | null = null;
    private colorOwner: HTMLElement | null = null;
    private menuPop: Popover | null = null;
    private menuOwner: HTMLElement | null = null;
    private theme: VelaTheme;
    private onClose: ((e?: PointerEvent) => void) | null = null;

    constructor(
        private readonly host: HTMLElement,
        theme: VelaTheme,
        /** One chart bar in ms — timeframe pickers drop the choices at/above it. */
        private readonly chartBarMs: () => number = () => 0,
    ) {
        this.theme = theme;
        this.settingsDialog = new DrawingSettingsDialog(host, theme);
    }

    /** The magnifier timeframe choices strictly below the chart's own bar duration
     *  (`auto` rides along while at least one concrete lower step exists). */
    private lowerTimeframeOptions(): Array<{ value: string; label: string; ms: number }> {
        const chartMs = this.chartBarMs();
        if (!(chartMs > 0)) return [...MAGNIFIER_TIMEFRAME_OPTIONS];
        const lower = MAGNIFIER_TIMEFRAME_OPTIONS.filter((o) => o.ms > 0 && o.ms < chartMs);
        return lower.length > 0 ? [MAGNIFIER_TIMEFRAME_OPTIONS[0]!, ...lower] : [];
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
        this.settingsDialog.setTheme(theme);
    }

    isOpen(): boolean {
        return this.el != null;
    }

    /** Whether `node` belongs to this popup — the bar, its host-floated color/menu shells,
     *  or a kit popover (select list / color chip) portaled into the chart host. */
    contains(node: Node | null): boolean {
        return node != null && (this.isOwnChrome(node) || this.settingsDialog.contains(node));
    }

    /** Open the quick toolbar for `drawings` (one, or a whole multi-selection), floating clear of
     *  their `anchor` box. With several drawings the bar shows only the controls they ALL support,
     *  a control whose values differ reads as mixed, and every edit applies to all of them —
     *  per-drawing panels (levels, position sizing, the text field) stay single-drawing only.
     *  `onClose` fires on a dismissal (an outside press, or Escape in the text field — not a
     *  programmatic close), with the dismissing press when there is one, so the caller can tell a
     *  modifier press (multi-select) from a plain one. */
    open(drawings: readonly Drawing[], anchor: PopupAnchor | null, actions: SettingsActions, onClose?: (e?: PointerEvent) => void): void {
        this.close();
        const drawing = drawings[0];
        if (!drawing) return;
        ensureStyles();
        this.onClose = onClose ?? null;
        const t = this.theme;
        const multi = drawings.length > 1;
        const schema = drawing.schema();
        const paths = sharedPaths(drawings);
        const common = <T>(read: (d: Drawing) => T): T | Mixed => commonValue(drawings, read);
        const every = (pred: (d: Drawing) => boolean): boolean => drawings.every(pred);
        /** A color swatch over the drawings: shared color, or striped with the colors in use. */
        const swatch = (tip: string, glyph: string, read: (d: Drawing) => string, path: string, iconSize?: number): HTMLButtonElement =>
            this.colorButton(tip, glyph, common(read), (v) => actions.patch({ [path]: v }), iconSize, distinctValues(drawings, read));
        // Text-first annotations (and computed labels) wear their text controls on the bar; on a
        // shape that merely CAN carry a label they stay beside the label field — and a
        // multi-selection has no label field, so its text styling always sits on the bar.
        const textOnBar = multi || schema.textIsContent === true || !paths.has('text.value');

        const el = document.createElement('div');
        el.className = 'vela-dpop';
        el.style.cssText = `position:absolute;z-index:22;background:${t.background};border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);color:${t.textColor};font:var(--vela-font-size-md) ${t.fontFamily};display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;`;
        applyChromeTokens(el, t);
        // Engaging any control in the bar dismisses an open color popover / dropdown menu (they live
        // outside `el` and stop their own pointerdowns, so this only fires for the OTHER controls —
        // and a dropdown trigger stops its own pointerdown so it can toggle its menu on click).
        // Kit Select / ColorField do not stop pointerdown — skip them so a re-click can toggle.
        el.addEventListener('pointerdown', (e) => {
            const t = e.target as HTMLElement | null;
            if (t?.closest('.vela-select-trigger, .vela-color-field')) return;
            closeOpenPopovers();
        });

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:2px;padding:4px;';

        // Leading move handle — drag the whole toolbar anywhere on the chart.
        bar.appendChild(this.dragHandle());

        if (paths.has('glyph')) {
            const cur = common((d) => (d as unknown as { glyph?: string }).glyph ?? GLYPH_OPTIONS[0]!);
            bar.appendChild(this.dropdown('Icon', GLYPH_OPTIONS, cur, (g) => glyphIcon(g), (v) => actions.patch({ glyph: v })));
        }
        if (paths.has('size')) {
            const sz = common((d) => (d as unknown as { size?: string }).size ?? 'normal');
            bar.appendChild(this.dropdown('Icon size', STAMP_SIZE_OPTIONS, sz, (s) => stampSizeIcon(s), (v) => actions.patch({ size: v }), { label: sizeLabel }));
        }
        // Magnifier: the lower-timeframe pick is the tool's one behavior control — it leads the
        // bar (text-only: the label IS the glyph); the inset candles' up/down colors ride along.
        // Only timeframes strictly below the chart's are offered; unset colors show the theme's
        // series colors (the inset follows the chart series until the user recolors it).
        if (paths.has('magnifier.timeframe') && every((d) => d instanceof Magnifier)) {
            const mag = (d: Drawing): Magnifier => d as Magnifier;
            const options = this.lowerTimeframeOptions();
            if (options.length > 0) {
                bar.appendChild(
                    this.dropdown('Lower timeframe', options.map((o) => o.value), common((d) => mag(d).magnifier.timeframe), () => '', (v) => actions.patch({ 'magnifier.timeframe': v }), {
                        label: (v) => magnifierTimeframeLabel(String(v)),
                        labelInTrigger: true,
                    }),
                );
            }
            bar.appendChild(swatch('Up candles', BUCKET_ICON, (d) => mag(d).magnifier.upColor || t.upColor, 'magnifier.upColor'));
            bar.appendChild(swatch('Down candles', BUCKET_ICON, (d) => mag(d).magnifier.downColor || t.downColor, 'magnifier.downColor'));
        }
        // The magnifier's unset border means the theme's contrast ink — the swatch shows that
        // effective color (same idea as effectiveFillColor below), not the generic blue default.
        if (paths.has('style.lineColor')) bar.appendChild(swatch('Line color', BRUSH_ICON, (d) => d.style.lineColor || (d instanceof Magnifier ? contrastColor(this.theme.background) : DEFAULT_DRAWING_COLOR), 'style.lineColor'));
        if (paths.has('style.lineWidth')) {
            // A marker-width field (floor above the hairline ladder, e.g. the
            // highlighter's 4–60) can't live in the 1–4 dropdown — a free numeric
            // input honoring the schema's declared range replaces it.
            const wf = schema.fields.find((f) => f.path === 'style.lineWidth');
            const width = common((d) => d.style.lineWidth);
            if (wf?.kind === 'number' && (wf.min ?? 1) > 1) {
                bar.appendChild(this.widthInput('Line width', width, wf.min ?? 1, wf.max ?? 60, wf.step ?? 1, (v) => actions.patch({ 'style.lineWidth': v })));
            } else {
                bar.appendChild(this.dropdown('Line width', [1, 2, 3, 4], width, (w) => lineIcon(w, 'solid'), (v) => actions.patch({ 'style.lineWidth': v }), { label: (v) => `${v}px`, labelInTrigger: true }));
            }
        }
        if (paths.has('style.lineStyle')) bar.appendChild(this.dropdown('Line style', LINE_STYLE_OPTIONS.map((o) => o.value), common((d) => d.style.lineStyle), (s) => lineIcon(2, s), (v) => actions.patch({ 'style.lineStyle': v }), { label: styleLabel }));
        // initialize the Fill swatch to the color actually painted (validity tint / line-color wash /
        // background fallback), not a stale default — same source the renderer fills with.
        if (paths.has('style.fillColor')) bar.appendChild(swatch('Fill', BUCKET_ICON, (d) => effectiveFillColor(d, this.theme) ?? d.style.fillColor ?? DEFAULT_DRAWING_COLOR, 'style.fillColor'));
        // Fixed-range VP: all settings live in the gear panel (nothing inline on the quick bar).
        const isFrvp = paths.has('frvp.rows') && drawing instanceof FixedRangeVolumeProfile;
        // Position tool: zone colors sit on the bar; risk/reward numbers + display toggles live
        // in the gear panel (they drive the loss/size labels).
        const isPosition = paths.has('riskPercent') && every((d) => d instanceof PositionTool);
        if (isPosition) {
            const pos = (d: Drawing): PositionTool => d as PositionTool;
            bar.appendChild(swatch('Profit zone', BUCKET_ICON, (d) => pos(d).profitColor, 'profitColor'));
            bar.appendChild(swatch('Loss zone', BUCKET_ICON, (d) => pos(d).lossColor, 'lossColor'));
        }
        // Regression channel: per-line color + style, the two area fills, and the R² toggle.
        const regOf = (d: Drawing): RegressionStyle | undefined => (d as unknown as { reg?: RegressionStyle }).reg;
        if (paths.has('reg.midColor') && every((d) => regOf(d) != null)) {
            const reg = (d: Drawing): RegressionStyle => regOf(d)!;
            const styles = LINE_STYLE_OPTIONS.map((o) => o.value);
            bar.appendChild(swatch('Midline color', BRUSH_ICON, (d) => reg(d).midColor, 'reg.midColor'));
            bar.appendChild(this.dropdown('Midline style', styles, common((d) => reg(d).midStyle), (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.midStyle': v }), { label: styleLabel }));
            bar.appendChild(swatch('Upper line color', BRUSH_ICON, (d) => reg(d).upperColor, 'reg.upperColor'));
            bar.appendChild(this.dropdown('Upper line style', styles, common((d) => reg(d).upperStyle), (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.upperStyle': v }), { label: styleLabel }));
            bar.appendChild(swatch('Lower line color', BRUSH_ICON, (d) => reg(d).lowerColor, 'reg.lowerColor'));
            bar.appendChild(this.dropdown('Lower line style', styles, common((d) => reg(d).lowerStyle), (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.lowerStyle': v }), { label: styleLabel }));
            bar.appendChild(swatch('Upper fill', BUCKET_ICON, (d) => reg(d).upperFill, 'reg.upperFill'));
            bar.appendChild(swatch('Lower fill', BUCKET_ICON, (d) => reg(d).lowerFill, 'reg.lowerFill'));
            bar.appendChild(this.toggle('Show R²', R2_ICON, common((d) => reg(d).showR2), (v) => actions.patch({ 'reg.showR2': v })));
        }
        // Anchored VWAP: midline color + style, band σ-multiplier, the two band-line colors, and the fill.
        const vwapOf = (d: Drawing): VwapStyle | undefined => (d as unknown as { vwap?: VwapStyle }).vwap;
        if (paths.has('vwap.midColor') && every((d) => vwapOf(d) != null)) {
            const vwap = (d: Drawing): VwapStyle => vwapOf(d)!;
            const styles = LINE_STYLE_OPTIONS.map((o) => o.value);
            const MULTS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
            bar.appendChild(swatch('VWAP color', BRUSH_ICON, (d) => vwap(d).midColor, 'vwap.midColor'));
            bar.appendChild(this.dropdown('VWAP style', styles, common((d) => vwap(d).midStyle), (s) => lineIcon(2, s), (v) => actions.patch({ 'vwap.midStyle': v }), { label: styleLabel }));
            bar.appendChild(
                this.dropdown('Band multiplier', MULTS, common((d) => vwap(d).multiplier), () => BANDS_ICON, (v) => actions.patch({ 'vwap.multiplier': v }), {
                    label: (v) => `${v}σ`,
                    labelInTrigger: true,
                }),
            );
            bar.appendChild(swatch('Upper band color', BRUSH_ICON, (d) => vwap(d).upperColor, 'vwap.upperColor'));
            bar.appendChild(swatch('Lower band color', BRUSH_ICON, (d) => vwap(d).lowerColor, 'vwap.lowerColor'));
            bar.appendChild(swatch('Band fill', BUCKET_ICON, (d) => vwap(d).bandFill, 'vwap.bandFill'));
        }
        // Dedekind tessellation: max circle curvature (tessellation density).
        if (paths.has('maxCurvature')) {
            const cur = common((d) => (d as unknown as { maxCurvature?: number }).maxCurvature ?? 24);
            bar.appendChild(
                this.dropdown('Max curvature', DEDEKIND_CURVATURE_OPTIONS, cur, () => DEDEKIND_ICON, (v) => actions.patch({ maxCurvature: v }), {
                    label: (v) => `n=${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        // Mach figures: wave count + (supersonic) Mach number.
        if (paths.has('mach')) {
            const cur = common((d) => (d as unknown as { mach?: number }).mach ?? 2);
            bar.appendChild(
                this.dropdown('Mach number', MACH_NUMBER_OPTIONS, cur, () => SUPERSONIC_ICON, (v) => actions.patch({ mach: v }), {
                    label: (v) => `M=${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        if (paths.has('waveCount')) {
            const cur = common((d) => (d as unknown as { waveCount?: number }).waveCount ?? 6);
            bar.appendChild(
                this.dropdown('Waves', MACH_WAVE_COUNT_OPTIONS, cur, () => SONIC_ICON, (v) => actions.patch({ waveCount: v }), {
                    label: (v) => `${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        // Range toggles + computed-label text styling (drawings whose label is computed, not typed).
        const flags = (d: Drawing): { showPrice?: boolean; showDate?: boolean } => d as unknown as { showPrice?: boolean; showDate?: boolean };
        if (paths.has('showPrice')) bar.appendChild(this.toggle('Show price', PRICE_DELTA_ICON, common((d) => flags(d).showPrice !== false), (v) => actions.patch({ showPrice: v })));
        if (paths.has('showDate')) bar.appendChild(this.toggle('Show date', DATE_DELTA_ICON, common((d) => flags(d).showDate !== false), (v) => actions.patch({ showDate: v })));
        if (paths.has('text.color') && textOnBar) bar.appendChild(swatch('Text color', TYPE_ICON, (d) => d.text?.color || t.textColor, 'text.color'));
        if (paths.has('text.size') && textOnBar) bar.appendChild(this.dropdown('Text size', TEXT_SIZE_OPTIONS.map((o) => o.value), common((d) => d.text?.size ?? 'normal'), (s) => labelSizeIcon(s), (v) => actions.patch({ 'text.size': v }), { label: sizeLabel }));
        // Bold/italic live under the text field; a computed label has no field (nor does a
        // multi-selection), so they go on the bar.
        const textField = !multi && paths.has('text.value');
        if (paths.has('text.bold') && !textField) bar.appendChild(this.toggle('Bold', BOLD_ICON, common((d) => !!d.text?.bold), (v) => actions.patch({ 'text.bold': v })));
        if (paths.has('text.italic') && !textField) bar.appendChild(this.toggle('Italic', ITALIC_ICON, common((d) => !!d.text?.italic), (v) => actions.patch({ 'text.italic': v })));
        if (textField) bar.appendChild(this.iconBtn('Text', TYPE_ICON, () => this.toggleTextPanel(drawing, actions, !textOnBar)));
        const editableLevels = drawing.editableLevels();
        if (editableLevels && every((d) => d.editableLevels() != null && !(d instanceof MachFigure))) {
            const fib = (d: Drawing): { numbersSize?: string; labelsSize?: string } => d as unknown as { numbersSize?: string; labelsSize?: string };
            const sizes = TEXT_SIZE_OPTIONS.map((o) => o.value);
            bar.appendChild(this.dropdown('Numbers size', sizes, common((d) => fib(d).numbersSize ?? 'small'), (s) => numbersSizeIcon(s), (v) => actions.patch({ numbersSize: v }), { label: sizeLabel }));
            bar.appendChild(this.dropdown('Label size', sizes, common((d) => fib(d).labelsSize ?? 'normal'), (s) => labelSizeIcon(s), (v) => actions.patch({ labelsSize: v }), { label: sizeLabel }));
        }

        // Trailing group: settings wheel (when the tool has one) sits just left of the lock,
        // and a kebab overflow (z-order + reset) sits just right of delete. The gear panels edit
        // one drawing's own data (levels, sizing, profile rows) — they stay off a multi-selection.
        bar.appendChild(this.divider());
        if (!multi && isFrvp) bar.appendChild(this.iconBtn('Settings', GEAR_ICON, () => this.settingsDialog.open(drawing, actions, 'frvp')));
        if (!multi && isPosition) bar.appendChild(this.iconBtn('Position size', GEAR_ICON, () => this.settingsDialog.open(drawing, actions, 'position')));
        if (!multi && editableLevels) bar.appendChild(this.iconBtn('Levels', GEAR_ICON, () => this.settingsDialog.open(drawing, actions, 'levels')));
        bar.appendChild(this.toggle('Lock', LOCK_ICON, common((d) => d.locked), (v) => actions.setLocked(v)));
        const del = this.iconBtn('Delete', TRASH_ICON, () => actions.remove());
        del.style.color = 'var(--vela-danger)';
        bar.appendChild(del);
        bar.appendChild(this.kebabButton(actions));

        el.append(bar);
        this.host.appendChild(el);
        this.el = el;
        // Hover-label: a floating tooltip that flips above/below the toolbar based on where it sits.
        el.addEventListener('mouseover', (e) => {
            const target = (e.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
            if (target) this.showTip(target);
            else this.hideTip();
        });
        el.addEventListener('mouseleave', () => this.hideTip());
        this.position(anchor);
        // Bubble phase (not capture): the chart canvas's pointerdown handler runs FIRST, so it can
        // claim a press on an off-body handle (e.g. an ellipse corner) before this dismiss deselects.
        setTimeout(() => document.addEventListener('pointerdown', this.onOutside), 0);
    }

    close(): void {
        document.removeEventListener('pointerdown', this.onOutside);
        this.closeColorPopover();
        this.closeMenu();
        this.hideTip();
        this.settingsDialog.close();
        this.el?.remove();
        this.el = null;
        this.textPanel = null;
        this.onClose = null;
    }

    destroy(): void {
        this.close();
    }

    private readonly onOutside = (e: Event): void => {
        const node = e.target as Node;
        if (this.settingsDialog.isOpen()) {
            if (this.settingsDialog.contains(node) || this.isOwnChrome(node)) return;
            this.settingsDialog.close();
            return;
        }
        if (this.isOwnChrome(node)) return;
        const cb = this.onClose;
        this.close();
        cb?.(e as PointerEvent);
    };

    /** Bar, host-floated shells, and kit popovers (select list / color chip) portaled into `host`. */
    private isOwnChrome(node: Node): boolean {
        if (this.el?.contains(node) || this.colorPop?.el.contains(node) || this.menuPop?.el.contains(node)) return true;
        const el = node instanceof Element ? node : node.parentElement;
        if (!el) return false;
        const pop = el.closest('.vela-popover');
        return pop != null && this.host.contains(pop);
    }

    /** The expandable text editor (toggled by the Text button): the field itself, with bold/italic
     *  under it, plus color and size when those aren't already on the bar. */
    private toggleTextPanel(drawing: Drawing, actions: SettingsActions, withColorAndSize: boolean): void {
        if (this.textPanel) {
            this.textPanel.remove();
            this.textPanel = null;
            this.reposition();
            return;
        }
        const text = drawing.text;
        // Textarea on top; format controls sit in a footer row so they never cover typed text.
        const panel = document.createElement('div');
        panel.style.cssText = `padding:6px;border-top:1px solid var(--vela-border);display:flex;flex-direction:column;gap:4px;`;
        const ta = new TextArea({
            value: text?.value ?? '',
            rows: 1,
            size: 'sm',
            autoGrow: true,
            maxLines: 4,
            placeholder: 'Label…',
            onChange: (v) => {
                actions.patch({ 'text.value': v });
                this.reposition();
            },
        });
        ta.el.style.minWidth = '220px';
        ta.input.addEventListener('input', () => {
            actions.patch({ 'text.value': ta.input.value });
            this.reposition();
        });
        ta.input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                const cb = this.onClose;
                this.close();
                cb?.();
            }
        });

        const tools = document.createElement('div');
        tools.style.cssText = `display:flex;align-items:center;justify-content:flex-start;gap:0;transform:scale(0.8);transform-origin:left center;`;
        if (withColorAndSize) {
            // text color defaults to the ACTUAL rendered color (theme text color when unset)
            tools.append(
                this.colorButton('Text color', TYPE_ICON, text?.color || this.theme.textColor, (v) => actions.patch({ 'text.color': v }), 14),
                this.dropdown('Text size', TEXT_SIZE_OPTIONS.map((o) => o.value), text?.size ?? 'normal', (s) => sizeIcon(s), (v) => actions.patch({ 'text.size': v }), { label: sizeLabel }),
            );
        }
        tools.append(
            this.toggle('Bold', BOLD_ICON, !!text?.bold, (v) => actions.patch({ 'text.bold': v })),
            this.toggle('Italic', ITALIC_ICON, !!text?.italic, (v) => actions.patch({ 'text.italic': v })),
        );

        panel.append(ta.el, tools);
        this.el?.appendChild(panel);
        this.textPanel = panel;
        this.reposition();
        ta.input.focus();
    }

    // ── positioning ──
    private position(anchor: PopupAnchor | null): void {
        const el = this.el;
        if (!el) return;
        const host = this.host.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const gap = 10;
        let left = host.width / 2 - w / 2;
        let top = 12;
        if (anchor) {
            left = anchor.x + anchor.w / 2 - w / 2;
            top = anchor.y - h - gap; // above the drawing
            if (top < 4) top = anchor.y + anchor.h + gap; // no room above → below
        }
        el.style.left = `${Math.max(4, Math.min(left, host.width - w - 4))}px`;
        el.style.top = `${Math.max(4, Math.min(top, host.height - h - 4))}px`;
    }

    /** Keep the toolbar where it is when its size changes (a panel toggled, or the user dragged it) —
     *  grow in place and only nudge back into view, so opening the gear doesn't make it leap away. */
    private reposition(): void {
        const el = this.el;
        if (!el) return;
        const host = this.host.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const left = parseFloat(el.style.left) || 0;
        const top = parseFloat(el.style.top) || 0;
        el.style.left = `${Math.max(4, Math.min(left, host.width - w - 4))}px`;
        el.style.top = `${Math.max(4, Math.min(top, host.height - h - 4))}px`;
    }


    private base(tip: string): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tip = tip; // the custom tip strip reads this (no native `title` — that tooltip is noisy)
        b.className = 'vela-dpop-btn';
        b.style.cssText = `width:${BTN}px;height:${BTN}px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:inherit;border:none;border-radius:5px;padding:0;`;
        return b;
    }

    private iconBtn(tip: string, icon: string, onClick: () => void): HTMLButtonElement {
        const b = this.base(tip);
        b.innerHTML = sized(icon);
        b.addEventListener('click', onClick);
        return b;
    }

    /** The leading grip: press-and-drag it to move the whole toolbar around the chart.
     *  Deliberately quiet — a dim icon with no hover fill and no tooltip, so it reads as chrome. */
    private dragHandle(): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'vela-dpop-grip';
        // touch-action:none — the handle owns its touches: without it the browser claims
        // the move for scrolling and CANCELS the pointer stream, which is why the bar
        // could barely be dragged on a phone.
        b.style.cssText = `width:${BTN}px;height:${BTN}px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;padding:0;cursor:grab;touch-action:none;color:var(--vela-fg-faint);`;
        b.innerHTML = sized(GRIP_ICON);
        b.addEventListener('pointerdown', (e) => {
            const el = this.el;
            if (!el || (e as PointerEvent).button !== 0) return;
            e.preventDefault();
            e.stopPropagation(); // don't let the bar's pointerdown close popovers, and don't dismiss
            this.hideTip();
            this.closeColorPopover();
            this.closeMenu();
            const host = this.host.getBoundingClientRect();
            const startX = (e as PointerEvent).clientX;
            const startY = (e as PointerEvent).clientY;
            const origLeft = parseFloat(el.style.left) || 0;
            const origTop = parseFloat(el.style.top) || 0;
            b.style.cursor = 'grabbing';
            // Capture keeps the move stream on the handle even when a finger (a far
            // blunter pointer than a cursor) slides off the 30px grip mid-drag.
            try {
                b.setPointerCapture((e as PointerEvent).pointerId);
            } catch {
                /* detached target or a test double without capture support */
            }
            const move = (ev: PointerEvent): void => {
                const w = el.offsetWidth;
                const h = el.offsetHeight;
                const nx = origLeft + (ev.clientX - startX);
                const ny = origTop + (ev.clientY - startY);
                el.style.left = `${Math.max(4, Math.min(nx, host.width - w - 4))}px`;
                el.style.top = `${Math.max(4, Math.min(ny, host.height - h - 4))}px`;
            };
            const up = (): void => {
                b.style.cursor = 'grab';
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                window.removeEventListener('pointercancel', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            window.addEventListener('pointercancel', up);
        });
        return b;
    }

    /** The trailing kebab overflow — duplicate, z-order actions, reset settings. */
    private kebabButton(actions: SettingsActions): HTMLButtonElement {
        const b = this.base('More');
        b.innerHTML = sized(KEBAB_ICON);
        // Stop the trigger's own pointerdown from reaching `el` (which would pre-close the menu),
        // so a re-click can toggle it shut in the click handler below.
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.menuOwner === b) {
                this.closeMenu();
                return;
            }
            this.openActionMenu(b, [
                { icon: CLONE_ICON, label: 'Duplicate', onClick: () => actions.duplicate() },
                { icon: FRONT_ICON, label: 'Bring to front', onClick: () => actions.reorder('front') },
                { icon: BACK_ICON, label: 'Send to back', onClick: () => actions.reorder('back') },
                { icon: RESET_ICON, label: 'Reset settings', onClick: () => actions.resetSettings() },
            ]);
        });
        return b;
    }

    /** Host-anchored floating shell (stays inside the chart). Content is filled after
     *  construction so `fill` can close over the live `Popover` without hitting TDZ. */
    private hostFloat(anchor: HTMLElement, opts: { align?: 'start' | 'end'; zIndex: number; padding: string; onClose?: () => void; fill: (el: HTMLElement, pop: Popover) => void }): Popover {
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
            align: opts.align ?? 'start',
            zIndex: opts.zIndex,
            onClose: () => {
                if (this.menuPop === pop) { this.menuPop = null; this.menuOwner = null; }
                if (this.colorPop === pop) { this.colorPop = null; this.colorOwner = null; }
                opts.onClose?.();
            },
        });
        const el = pop.el;
        el.style.background = t.background;
        el.style.border = '1px solid var(--vela-border)';
        el.style.borderRadius = 'var(--vela-radius-lg)';
        el.style.boxShadow = 'var(--vela-shadow)';
        el.style.padding = opts.padding;
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.gap = '1px';
        el.style.color = t.textColor;
        el.style.font = `var(--vela-font-size-md) ${t.fontFamily}`;
        el.style.pointerEvents = 'auto';
        opts.fill(el, pop);
        pop.show();
        return pop;
    }

    /**
     * A standalone timeframe menu for the magnifier's ON-CHART chip. The chip lives on
     * canvas, so a transient invisible anchor is dropped at its pixel rect for the popover
     * to position against, and removed again when the menu closes. Independent of the
     * quick toolbar — the chip works without selecting the drawing first.
     */
    openMagnifierTimeframeMenu(rect: { x: number; y: number; w: number; h: number }, current: string, onPick: (value: string) => void): void {
        ensureStyles();
        closeOpenPopovers();
        const options = this.lowerTimeframeOptions();
        const anchor = document.createElement('div');
        anchor.style.cssText = `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.w}px;height:${rect.h}px;pointer-events:none;`;
        this.host.appendChild(anchor);
        this.menuPop = this.hostFloat(anchor, {
            zIndex: 26,
            padding: '4px',
            onClose: () => anchor.remove(),
            fill: (menu, pop) => {
                if (options.length === 0) {
                    // The chart is already at the finest offered step — say so instead of
                    // presenting an empty (or lying) list.
                    const note = document.createElement('div');
                    note.style.cssText = 'padding:6px 10px;opacity:0.65;white-space:nowrap;';
                    note.textContent = 'No lower timeframe available';
                    menu.appendChild(note);
                    return;
                }
                for (const o of options) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'vela-dpop-item';
                    item.dataset.active = o.value === current ? '1' : '0';
                    item.style.cssText = 'display:flex;align-items:center;min-width:88px;padding:5px 10px;border:none;border-radius:5px;color:inherit;cursor:pointer;text-align:left;font:inherit;font-variant-numeric:tabular-nums;';
                    item.textContent = o.label;
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pop.hide();
                        onPick(o.value);
                    });
                    menu.appendChild(item);
                }
            },
        });
        this.menuOwner = anchor;
    }

    /** A floating list of one-shot actions (icon + label rows) opened by the kebab. */
    private openActionMenu(anchor: HTMLElement, rows: readonly { icon: string; label: string; onClick: () => void }[]): void {
        this.menuPop = this.hostFloat(anchor, {
            align: 'end',
            zIndex: 26,
            padding: '4px',
            fill: (menu, pop) => {
                for (const row of rows) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'vela-dpop-item';
                    item.style.cssText = 'display:flex;align-items:center;gap:9px;min-width:150px;padding:6px 9px;border:none;border-radius:5px;color:inherit;cursor:pointer;text-align:left;font:inherit;';
                    const ic = document.createElement('span');
                    ic.style.cssText = 'display:flex;flex:none;width:20px;justify-content:center;';
                    ic.innerHTML = sized(row.icon, 18);
                    const tx = document.createElement('span');
                    tx.textContent = row.label;
                    tx.style.cssText = 'flex:1;';
                    item.append(ic, tx);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pop.hide();
                        row.onClick();
                    });
                    menu.appendChild(item);
                }
            },
        });
        this.menuOwner = anchor;
    }

    /** The floating hover-label. Sits just above or below the toolbar depending on where it floats,
     *  and tracks the hovered control horizontally — a styled replacement for the native `title`. */
    private showTip(target: HTMLElement): void {
        const text = target.dataset.tip;
        if (!text) {
            this.hideTip();
            return;
        }
        const t = this.theme;
        if (!this.tipEl) {
            const tp = document.createElement('div');
            tp.style.cssText = `position:absolute;z-index:27;pointer-events:none;white-space:nowrap;background:${t.textColor};color:${t.background};padding:3px 7px;border-radius:5px;font:var(--vela-font-size-sm) ${t.fontFamily};box-shadow:var(--vela-shadow);`;
            this.host.appendChild(tp);
            this.tipEl = tp;
        }
        const tip = this.tipEl;
        tip.textContent = text;
        const hr = this.host.getBoundingClientRect();
        const br = target.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const gap = 6;
        let left = br.left - hr.left + br.width / 2 - tw / 2;
        left = Math.max(4, Math.min(left, hr.width - tw - 4));
        // Hug the hovered control — just above it, dropping below only when there's no room above.
        const aboveTop = br.top - hr.top - th - gap;
        const top = aboveTop >= 4 ? aboveTop : br.bottom - hr.top + gap;
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    private hideTip(): void {
        this.tipEl?.remove();
        this.tipEl = null;
    }

    /** An on/off button. A mixed state (the selected drawings disagree) reads as half-lit and
     *  the first click turns it ON for all of them. */
    private toggle(tip: string, icon: string, active: boolean | Mixed, onChange: (v: boolean) => void): HTMLButtonElement {
        const b = this.base(tip);
        b.innerHTML = sized(icon);
        // `data-active` alone drives the fill — the stylesheet owns idle/hover/active/mixed.
        const set = (on: boolean | Mixed): void => {
            b.dataset.active = on === MIXED ? 'mixed' : on ? '1' : '0';
        };
        set(active);
        let on = active;
        b.addEventListener('click', () => {
            on = on === MIXED ? true : !on;
            set(on);
            onChange(on);
        });
        return b;
    }

    /** An inline numeric width field for tools whose stroke range outgrows the 1–4px
     *  ladder — the value is clamped to the schema's declared min/max on commit. A mixed
     *  value shows an empty field with a dash until a number is typed for all. */
    private widthInput(tip: string, value: number | Mixed, min: number, max: number, step: number, onChange: (v: number) => void): HTMLElement {
        const ni = new NumberInput({
            value: value === MIXED ? min : value,
            min,
            max,
            step,
            integer: step >= 1,
            size: 'sm',
            fill: false,
            compact: true,
            commit: 'blur',
            title: tip,
            onChange,
        });
        if (value === MIXED) {
            ni.input.value = '';
            ni.input.placeholder = '—';
        }
        ni.el.dataset.tip = tip;
        trapChartKeys(ni.el);
        return ni.el;
    }

    /** A pick-one dropdown: the trigger shows the current value's glyph (plus an optional inline
     *  text label — e.g. `2px` — for controls that would otherwise look alike), and clicking it
     *  opens a floating list of every option so a value is one click away (no cycling through).
     *  A mixed value shows a dash in the trigger and highlights no row. */
    private dropdown(
        tip: string,
        values: readonly (string | number)[],
        current: string | number | Mixed,
        render: (v: string | number) => string,
        onChange: (v: string | number) => void,
        opts: { label?: (v: string | number) => string; labelInTrigger?: boolean } = {},
    ): HTMLButtonElement {
        const b = this.base(tip);
        b.style.width = 'auto';
        b.style.minWidth = `${BTN}px`;
        b.style.padding = '0 4px';
        b.style.gap = '2px';
        let cur = current;
        const paint = (v: string | number | Mixed): void => {
            b.replaceChildren();
            if (v === MIXED) {
                const dash = document.createElement('span');
                dash.textContent = '—';
                dash.style.cssText = 'min-width:18px;text-align:center;opacity:0.85;';
                b.appendChild(dash);
            }
            const glyph = v === MIXED ? '' : render(v);
            if (glyph) {
                // An empty glyph means a text-only control (e.g. the magnifier's timeframe) —
                // the trigger then shows just the label + chevron.
                const ic = document.createElement('span');
                ic.style.cssText = 'display:flex;';
                ic.innerHTML = sized(glyph);
                b.appendChild(ic);
            }
            if (opts.label && opts.labelInTrigger && v !== MIXED) {
                const tx = document.createElement('span');
                tx.textContent = opts.label(v);
                tx.style.cssText = 'font-size:11px;opacity:0.85;font-variant-numeric:tabular-nums;';
                b.appendChild(tx);
            }
            const ch = document.createElement('span');
            ch.style.cssText = 'display:flex;opacity:0.55;';
            ch.innerHTML = sized(CHEVRON_ICON, 12);
            b.appendChild(ch);
        };
        paint(cur);
        // Stop the trigger's own pointerdown from reaching `el` (which would pre-close the menu),
        // so a re-click can toggle it shut in the click handler below.
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.menuOwner === b) {
                this.closeMenu();
                return;
            }
            this.openMenu(b, values, cur, render, opts.label, (v) => {
                cur = v;
                paint(v);
                onChange(v);
            });
        });
        return b;
    }

    /** The floating option list opened by a {@link dropdown} trigger. Each row shows the option's
     *  glyph (and text label when one is supplied); the current value is highlighted. */
    private openMenu(
        anchor: HTMLElement,
        values: readonly (string | number)[],
        current: string | number | Mixed,
        render: (v: string | number) => string,
        label: ((v: string | number) => string) | undefined,
        onPick: (v: string | number) => void,
    ): void {
        this.menuPop = this.hostFloat(anchor, {
            zIndex: 26,
            padding: '4px',
            fill: (menu, pop) => {
                for (const v of values) {
                    const active = v === current;
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'vela-dpop-item';
                    item.dataset.active = active ? '1' : '0';
                    item.style.cssText = `display:flex;align-items:center;gap:8px;${label ? 'min-width:118px;' : ''}padding:5px 8px;border:none;border-radius:5px;color:inherit;cursor:pointer;text-align:left;font:inherit;`;
                    const glyph = render(v);
                    if (glyph) {
                        const ic = document.createElement('span');
                        ic.style.cssText = 'display:flex;flex:none;width:22px;justify-content:center;';
                        ic.innerHTML = sized(glyph, 18);
                        item.appendChild(ic);
                    }
                    if (label) {
                        const tx = document.createElement('span');
                        tx.textContent = label(v);
                        tx.style.cssText = 'flex:1;font-variant-numeric:tabular-nums;';
                        item.appendChild(tx);
                    }
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        pop.hide();
                        onPick(v);
                    });
                    menu.appendChild(item);
                }
            },
        });
        this.menuOwner = anchor;
    }

    private closeMenu(): void {
        this.menuPop?.hide();
    }

    /** A color control: an `icon` over a thin **colored underline** showing the current
     *  value (the common idiom), with an invisible native picker overlaid to edit it.
     *  `iconSize` shrinks it for the floating text controls. A mixed color paints the
     *  underline striped with the colors `used` across the selection, and the picker then
     *  leads with those colors so unifying onto one of them is a single click. */
    private colorButton(tip: string, icon: string, color: string | Mixed, onChange: (v: string) => void, iconSize = 17, used: readonly string[] = []): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tip = tip;
        b.className = 'vela-dpop-btn';
        b.style.cssText = `position:relative;width:${BTN}px;height:${BTN}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;border-radius:5px;border:none;color:inherit;padding:0;`;
        const ic = document.createElement('span');
        ic.style.cssText = 'display:flex;';
        ic.innerHTML = sized(icon, iconSize);
        const bar = document.createElement('span');
        bar.style.cssText = `display:block;height:3px;width:${Math.round(iconSize * 0.85)}px;border-radius:2px;background:${color === MIXED ? stripes(used) : color};`;
        b.append(ic, bar);
        let cur = color;
        // Stop the swatch's own pointerdown from reaching `el` (which would pre-close the popover),
        // so a re-click toggles it shut instead of closing-then-reopening.
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            // A mixed picker starts from the first color in use — some real value must seed the sliders.
            const seed = cur === MIXED ? used[0] ?? DEFAULT_DRAWING_COLOR : cur;
            this.toggleColorPopover(b, seed, cur === MIXED ? used : [], (v) => {
                cur = v;
                bar.style.background = v;
                onChange(v);
            });
        });
        return b;
    }

    /** Open the color popover for `anchor`, or close it if it's already this anchor's (toggle). */
    private toggleColorPopover(anchor: HTMLElement, color: string, used: readonly string[], onChange: (v: string) => void): void {
        if (this.colorOwner === anchor) {
            this.closeColorPopover();
            return;
        }
        this.openColorPopover(anchor, color, used, onChange);
    }

    /** A floating RGB picker + opacity slider anchored to a color swatch — emits `#RRGGBB(AA)`.
     *  `used` (a mixed swatch's colors) leads the picker as one-click unify shortcuts. */
    private openColorPopover(anchor: HTMLElement, color: string, used: readonly string[], onChange: (v: string) => void): void {
        const t = this.theme;
        this.colorPop = this.hostFloat(anchor, {
            zIndex: 25,
            padding: '10px',
            fill: (el, pop) => {
                if (used.length > 1) {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding-bottom:9px;border-bottom:1px solid var(--vela-border);';
                    const lbl = document.createElement('span');
                    lbl.textContent = 'In use';
                    lbl.style.cssText = 'font:var(--vela-font-size-sm) inherit;opacity:0.7;margin-right:2px;';
                    row.appendChild(lbl);
                    for (const c of used) {
                        const sw = document.createElement('button');
                        sw.type = 'button';
                        sw.dataset.tip = c;
                        sw.style.cssText = `width:18px;height:18px;border-radius:4px;border:1px solid var(--vela-border-strong);cursor:pointer;background:${c};padding:0;`;
                        sw.addEventListener('click', (e) => {
                            e.stopPropagation();
                            pop.hide();
                            onChange(c);
                        });
                        row.appendChild(sw);
                    }
                    el.appendChild(row);
                }
                el.appendChild(buildColorPicker(color, t, onChange));
            },
        });
        this.colorOwner = anchor;
    }

    private closeColorPopover(): void {
        this.colorPop?.hide();
    }

    private divider(): HTMLElement {
        const d = document.createElement('div');
        d.style.cssText = 'width:1px;height:18px;margin:0 3px;background:var(--vela-border);';
        return d;
    }
}

// The toolbar's glyphs all come from the shared registry; only the PARAMETERIZED ones below
// (a line at a given width, a stamp at a given size) are generated here, since they encode a
// live style value rather than a fixed concept.
const BRUSH_ICON = icon('brush');
const BUCKET_ICON = icon('bucket');
const TYPE_ICON = icon('type');
const PRICE_DELTA_ICON = icon('price-delta');
const DATE_DELTA_ICON = icon('date-delta');
const LOCK_ICON = icon('lock');
const FRONT_ICON = icon('bring-front');
const BACK_ICON = icon('send-back');
const TRASH_ICON = icon('trash');
const BOLD_ICON = icon('bold');
const ITALIC_ICON = icon('italic');
const GRIP_ICON = icon('grip');
const KEBAB_ICON = icon('kebab');
const CLONE_ICON = icon('clone');
const RESET_ICON = icon('reset');
const GEAR_ICON = icon('gear');
const CHEVRON_ICON = icon('chevron-down');
const R2_ICON = icon('r-squared');
const BANDS_ICON = icon('bands');
const DEDEKIND_ICON = icon('dedekind');
const SONIC_ICON = icon('sonic');
const SUPERSONIC_ICON = icon('supersonic');

/** A striped underline for a mixed color swatch: equal bands of every color in use (a neutral
 *  gray pair when nothing concrete is known), so the mix itself is visible without opening it. */
function stripes(colors: readonly string[]): string {
    const bands = colors.length > 1 ? colors : ['var(--vela-fg-faint)', 'var(--vela-fg-muted)'];
    const step = 100 / bands.length;
    const stops = bands.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(',');
    return `linear-gradient(90deg,${stops})`;
}

/** A line glyph at a given width + style (for the width/style dropdown glyphs). The stroke IS
 *  the value being previewed, so it overrides the tier's weight. */
function lineIcon(width: number | string, style: string | number): string {
    const dash = style === 'dashed' ? '5,3' : style === 'dotted' ? '1.5,3' : '';
    return svg24(`<line x1="3.5" y1="12" x2="20.5" y2="12" stroke-width="${Number(width) || 2}" stroke-dasharray="${dash}"/>`);
}

/** Typing in a bar field must not reach the chart (Delete would remove the drawing). */
function trapChartKeys(el: HTMLElement): void {
    el.addEventListener('keydown', (e) => e.stopPropagation());
}

/** A centered text glyph on the tier-B grid — the base of every generated preview below. */
function textGlyph(text: string, fontSize: number, y = 17, extra = ''): string {
    return svg24Solid(`<text x="12" y="${y}" font-size="${fontSize}" text-anchor="middle"${extra ? ' ' + extra : ''}>${text}</text>`);
}

/** The current glyph rendered into the icon-stamp dropdown trigger. */
function glyphIcon(glyph: string | number): string {
    return textGlyph(String(glyph), 15);
}

/** A dot that grows with the chosen stamp size — the icon-size dropdown glyph. */
function stampSizeIcon(size: string | number): string {
    return textGlyph('●', (SIZE_PX[String(size)] ?? 13) + 4);
}

/** A letter glyph (S/M/L/H) for the text-size dropdown glyph. */
function sizeIcon(size: string | number): string {
    return textGlyph(String(size).charAt(0).toUpperCase(), 15);
}

/** The font px each named size renders the icon glyph at — so the button visibly grows. */
const SIZE_PX: Record<string, number> = { small: 10, normal: 13, large: 16, huge: 20 };

/** A "12" glyph that grows with the chosen size — the fib level-numbers size dropdown glyph. */
function numbersSizeIcon(size: string | number): string {
    return textGlyph('12', (SIZE_PX[String(size)] ?? 13) - 1, 16.5, 'font-weight="600"');
}

/** A "T" glyph that grows with the chosen size — the fib level-labels size dropdown glyph. */
function labelSizeIcon(size: string | number): string {
    return textGlyph('T', (SIZE_PX[String(size)] ?? 13) + 2);
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Human label for a named size (`small` → `Small`) — the dropdown menu row text. */
function sizeLabel(v: string | number): string {
    return TEXT_SIZE_OPTIONS.find((o) => o.value === v)?.label ?? capitalize(String(v));
}

/** Human label for a line style (`dashed` → `Dashed`) — the dropdown menu row text. */
function styleLabel(v: string | number): string {
    return LINE_STYLE_OPTIONS.find((o) => o.value === v)?.label ?? capitalize(String(v));
}

/** Make an inline SVG fill the icon slot (default {@link ICON}px). */
function sized(svg: string, size: number = ICON): string {
    return svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
}

