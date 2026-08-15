import type { VelaTheme } from '../../../core/options';
import type { Drawing, RegressionStyle, VwapStyle, FrvpStyle, PositionLevelMode } from '../../../core/drawings';
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
    DIRECTION_OPTIONS,
    effectiveFillColor,
} from '../../../core/drawings';
import { icon, svg24, svg24Solid } from '../../../core/icons';
import { applyChromeTokens } from '../../shared/theme-tokens';
import { contrastColor } from '../../shared/drawing-geometry';
import { buildColorPicker } from '../../../ui/components/color-picker';
import { Popover, closeOpenPopovers } from '../../../ui/components/popover';

/** A `{ path: value }` patch emitted as the user edits a control. */
export type SettingsPatch = Record<string, unknown>;

/** The actions a settings popup can invoke (wired by the controller to intents). */
export interface SettingsActions {
    /** The current live instance (sync rebuilds instances, so panels re-read through this). */
    resolve(): Drawing | null;
    patch(p: SettingsPatch): void;
    setLocked(v: boolean): void;
    reorder(to: 'front' | 'back'): void;
    resetSettings(): void;
    remove(): void;
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

/** Inject the scoped styles that inline cssText can't reach (`:focus`, color-swatch +
 *  scrollbar pseudo-elements). Idempotent — one shared sheet for all popups. */
function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
.vela-dpop input[type=color]{-webkit-appearance:none;appearance:none;border:none;padding:0;background:none;cursor:pointer;border-radius:0;}
.vela-dpop input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
.vela-dpop input[type=color]::-webkit-color-swatch{border:none;border-radius:0;}
.vela-dpop input[type=color]::-moz-color-swatch{border:none;border-radius:0;}
.vela-dpop textarea{outline:none;transition:border-color .12s ease,box-shadow .12s ease;}
.vela-dpop textarea:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}
.vela-dpop textarea::placeholder{color:currentColor;opacity:0.4;}
.vela-dpop textarea::-webkit-scrollbar,.vela-dpop .vela-fiblevels::-webkit-scrollbar,.vela-dpop .vela-frvp::-webkit-scrollbar{width:8px;}
.vela-dpop textarea::-webkit-scrollbar-thumb,.vela-dpop .vela-fiblevels::-webkit-scrollbar-thumb,.vela-dpop .vela-frvp::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}
.vela-dpop textarea::-webkit-scrollbar-track,.vela-dpop .vela-fiblevels::-webkit-scrollbar-track,.vela-dpop .vela-frvp::-webkit-scrollbar-track{background:transparent;}
.vela-dpop .vela-fiblevels input[type=text],.vela-dpop .vela-fiblevels input[type=number],.vela-dpop .vela-frvp input[type=text],.vela-dpop .vela-frvp input[type=number],.vela-dpop .vela-frvp select{transition:border-color .12s ease,box-shadow .12s ease;}
.vela-dpop .vela-fiblevels input[type=text]:focus,.vela-dpop .vela-fiblevels input[type=number]:focus,.vela-dpop .vela-frvp input[type=text]:focus,.vela-dpop .vela-frvp input[type=number]:focus,.vela-dpop .vela-frvp select:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}
.vela-dpop-btn{background:transparent;color:var(--vela-fg-muted);transition:background var(--vela-dur-fast) ease,color var(--vela-dur-fast) ease;}
.vela-dpop-btn:hover{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-dpop-btn[data-active='1']{background:var(--vela-active);color:var(--vela-fg-bright);}
.vela-dpop-item{background:transparent;transition:background var(--vela-dur-fast) ease;}
.vela-dpop-item:hover{background:var(--vela-hover-strong);}
.vela-dpop-item[data-active='1']{background:var(--vela-active);}
/* A finger needs a wider grab zone than a cursor — grow the move handle on touch-first
   devices (the glyph stays centered; only the hit target widens). */
@media (pointer: coarse){.vela-dpop-grip{width:${BTN + 14}px !important;}}`;
    document.head.appendChild(s);
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
    private levelsPanel: HTMLDivElement | null = null;
    private colorPop: Popover | null = null;
    private colorOwner: HTMLElement | null = null;
    private menuPop: Popover | null = null;
    private menuOwner: HTMLElement | null = null;
    private theme: VelaTheme;
    private onClose: (() => void) | null = null;

    constructor(private readonly host: HTMLElement, theme: VelaTheme) {
        this.theme = theme;
    }

    setTheme(theme: VelaTheme): void {
        this.theme = theme;
    }

    isOpen(): boolean {
        return this.el != null;
    }

    /** Whether `node` belongs to this popup — the bar or either of its floating children (color
     *  picker / dropdown menu), which live outside `el`. */
    contains(node: Node | null): boolean {
        if (!node) return false;
        return this.el?.contains(node) === true || this.colorPop?.el.contains(node) === true || this.menuPop?.el.contains(node) === true;
    }

    /** Open the quick toolbar for `drawing`, floating clear of its `anchor` box.
     *  `onClose` fires on an outside-click dismissal (not a programmatic close). */
    open(drawing: Drawing, anchor: PopupAnchor | null, actions: SettingsActions, onClose?: () => void): void {
        this.close();
        ensureStyles();
        this.onClose = onClose ?? null;
        const t = this.theme;
        const schema = drawing.schema();
        const paths = new Set(schema.fields.map((f) => f.path));
        // Text-first annotations (and computed labels) wear their text controls on the bar; on a
        // shape that merely CAN carry a label they stay beside the label field.
        const textOnBar = schema.textIsContent === true || !paths.has('text.value');

        const el = document.createElement('div');
        el.className = 'vela-dpop';
        el.style.cssText = `position:absolute;z-index:22;background:${t.background};border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);color:${t.textColor};font:var(--vela-font-size-md) ${t.fontFamily};display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;`;
        applyChromeTokens(el, t);
        // Engaging any control in the bar dismisses an open color popover / dropdown menu (they live
        // outside `el` and stop their own pointerdowns, so this only fires for the OTHER controls —
        // and a dropdown trigger stops its own pointerdown so it can toggle its menu on click).
        el.addEventListener('pointerdown', () => {
            closeOpenPopovers();
        });

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;align-items:center;gap:2px;padding:4px;';

        // Leading move handle — drag the whole toolbar anywhere on the chart.
        bar.appendChild(this.dragHandle());

        if (paths.has('glyph')) {
            const cur = (drawing as unknown as { glyph?: string }).glyph ?? GLYPH_OPTIONS[0];
            bar.appendChild(this.dropdown('Icon', GLYPH_OPTIONS, cur, (g) => glyphIcon(g), (v) => actions.patch({ glyph: v })));
        }
        if (paths.has('size')) {
            const sz = (drawing as unknown as { size?: string }).size ?? 'normal';
            bar.appendChild(this.dropdown('Icon size', STAMP_SIZE_OPTIONS, sz, (s) => stampSizeIcon(s), (v) => actions.patch({ size: v }), { label: sizeLabel }));
        }
        if (paths.has('style.lineColor')) bar.appendChild(this.colorButton('Line color', BRUSH_ICON, drawing.style.lineColor || DEFAULT_DRAWING_COLOR, (v) => actions.patch({ 'style.lineColor': v })));
        if (paths.has('style.lineWidth')) {
            // A marker-width field (floor above the hairline ladder, e.g. the
            // highlighter's 4–60) can't live in the 1–4 dropdown — a free numeric
            // input honoring the schema's declared range replaces it.
            const wf = schema.fields.find((f) => f.path === 'style.lineWidth');
            if (wf?.kind === 'number' && (wf.min ?? 1) > 1) {
                bar.appendChild(this.widthInput('Line width', drawing.style.lineWidth, wf.min ?? 1, wf.max ?? 60, wf.step ?? 1, (v) => actions.patch({ 'style.lineWidth': v })));
            } else {
                bar.appendChild(this.dropdown('Line width', [1, 2, 3, 4], drawing.style.lineWidth, (w) => lineIcon(w, 'solid'), (v) => actions.patch({ 'style.lineWidth': v }), { label: (v) => `${v}px`, labelInTrigger: true }));
            }
        }
        if (paths.has('style.lineStyle')) bar.appendChild(this.dropdown('Line style', LINE_STYLE_OPTIONS.map((o) => o.value), drawing.style.lineStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'style.lineStyle': v }), { label: styleLabel }));
        // initialize the Fill swatch to the color actually painted (validity tint / line-color wash /
        // background fallback), not a stale default — same source the renderer fills with.
        if (paths.has('style.fillColor')) bar.appendChild(this.colorButton('Fill', BUCKET_ICON, effectiveFillColor(drawing, this.theme) ?? drawing.style.fillColor ?? DEFAULT_DRAWING_COLOR, (v) => actions.patch({ 'style.fillColor': v })));
        // Fixed-range VP: all settings live in the gear panel (nothing inline on the quick bar).
        const isFrvp = paths.has('frvp.rows') && drawing instanceof FixedRangeVolumeProfile;
        // Position tool: zone colors sit on the bar; risk/reward numbers + display toggles live
        // in the gear panel (they drive the loss/size labels).
        const isPosition = paths.has('riskPercent') && drawing instanceof PositionTool;
        if (isPosition) {
            const pos = drawing as PositionTool;
            bar.appendChild(this.colorButton('Profit zone', BUCKET_ICON, pos.profitColor, (v) => actions.patch({ profitColor: v })));
            bar.appendChild(this.colorButton('Loss zone', BUCKET_ICON, pos.lossColor, (v) => actions.patch({ lossColor: v })));
        }
        // Regression channel: per-line color + style, the two area fills, and the R² toggle.
        const reg = (drawing as unknown as { reg?: RegressionStyle }).reg;
        if (paths.has('reg.midColor') && reg) {
            const styles = LINE_STYLE_OPTIONS.map((o) => o.value);
            bar.appendChild(this.colorButton('Midline color', BRUSH_ICON, reg.midColor, (v) => actions.patch({ 'reg.midColor': v })));
            bar.appendChild(this.dropdown('Midline style', styles, reg.midStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.midStyle': v }), { label: styleLabel }));
            bar.appendChild(this.colorButton('Upper line color', BRUSH_ICON, reg.upperColor, (v) => actions.patch({ 'reg.upperColor': v })));
            bar.appendChild(this.dropdown('Upper line style', styles, reg.upperStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.upperStyle': v }), { label: styleLabel }));
            bar.appendChild(this.colorButton('Lower line color', BRUSH_ICON, reg.lowerColor, (v) => actions.patch({ 'reg.lowerColor': v })));
            bar.appendChild(this.dropdown('Lower line style', styles, reg.lowerStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'reg.lowerStyle': v }), { label: styleLabel }));
            bar.appendChild(this.colorButton('Upper fill', BUCKET_ICON, reg.upperFill, (v) => actions.patch({ 'reg.upperFill': v })));
            bar.appendChild(this.colorButton('Lower fill', BUCKET_ICON, reg.lowerFill, (v) => actions.patch({ 'reg.lowerFill': v })));
            bar.appendChild(this.toggle('Show R²', R2_ICON, reg.showR2, (v) => actions.patch({ 'reg.showR2': v })));
        }
        // Anchored VWAP: midline color + style, band σ-multiplier, the two band-line colors, and the fill.
        const vwap = (drawing as unknown as { vwap?: VwapStyle }).vwap;
        if (paths.has('vwap.midColor') && vwap) {
            const styles = LINE_STYLE_OPTIONS.map((o) => o.value);
            const MULTS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
            bar.appendChild(this.colorButton('VWAP color', BRUSH_ICON, vwap.midColor, (v) => actions.patch({ 'vwap.midColor': v })));
            bar.appendChild(this.dropdown('VWAP style', styles, vwap.midStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'vwap.midStyle': v }), { label: styleLabel }));
            bar.appendChild(
                this.dropdown('Band multiplier', MULTS, vwap.multiplier, () => BANDS_ICON, (v) => actions.patch({ 'vwap.multiplier': v }), {
                    label: (v) => `${v}σ`,
                    labelInTrigger: true,
                }),
            );
            bar.appendChild(this.colorButton('Upper band color', BRUSH_ICON, vwap.upperColor, (v) => actions.patch({ 'vwap.upperColor': v })));
            bar.appendChild(this.colorButton('Lower band color', BRUSH_ICON, vwap.lowerColor, (v) => actions.patch({ 'vwap.lowerColor': v })));
            bar.appendChild(this.colorButton('Band fill', BUCKET_ICON, vwap.bandFill, (v) => actions.patch({ 'vwap.bandFill': v })));
        }
        // Dedekind tessellation: max circle curvature (tessellation density).
        if (paths.has('maxCurvature')) {
            const cur = (drawing as unknown as { maxCurvature?: number }).maxCurvature ?? 24;
            bar.appendChild(
                this.dropdown('Max curvature', DEDEKIND_CURVATURE_OPTIONS, cur, () => DEDEKIND_ICON, (v) => actions.patch({ maxCurvature: v }), {
                    label: (v) => `n=${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        // Mach figures: wave count + (supersonic) Mach number.
        if (paths.has('mach')) {
            const cur = (drawing as unknown as { mach?: number }).mach ?? 2;
            bar.appendChild(
                this.dropdown('Mach number', MACH_NUMBER_OPTIONS, cur, () => SUPERSONIC_ICON, (v) => actions.patch({ mach: v }), {
                    label: (v) => `M=${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        if (paths.has('waveCount')) {
            const cur = (drawing as unknown as { waveCount?: number }).waveCount ?? 6;
            bar.appendChild(
                this.dropdown('Waves', MACH_WAVE_COUNT_OPTIONS, cur, () => SONIC_ICON, (v) => actions.patch({ waveCount: v }), {
                    label: (v) => `${v}`,
                    labelInTrigger: true,
                }),
            );
        }
        // Range toggles + computed-label text styling (drawings whose label is computed, not typed).
        const toggles = drawing as unknown as { showPrice?: boolean; showDate?: boolean };
        if (paths.has('showPrice')) bar.appendChild(this.toggle('Show price', PRICE_DELTA_ICON, toggles.showPrice !== false, (v) => actions.patch({ showPrice: v })));
        if (paths.has('showDate')) bar.appendChild(this.toggle('Show date', DATE_DELTA_ICON, toggles.showDate !== false, (v) => actions.patch({ showDate: v })));
        if (paths.has('text.color') && textOnBar) bar.appendChild(this.colorButton('Text color', TYPE_ICON, drawing.text?.color || t.textColor, (v) => actions.patch({ 'text.color': v })));
        if (paths.has('text.size') && textOnBar) bar.appendChild(this.dropdown('Text size', TEXT_SIZE_OPTIONS.map((o) => o.value), drawing.text?.size ?? 'normal', (s) => labelSizeIcon(s), (v) => actions.patch({ 'text.size': v }), { label: sizeLabel }));
        // Bold/italic live under the text field; a computed label has no field, so they go on the bar.
        if (paths.has('text.bold') && !paths.has('text.value')) bar.appendChild(this.toggle('Bold', BOLD_ICON, !!drawing.text?.bold, (v) => actions.patch({ 'text.bold': v })));
        if (paths.has('text.italic') && !paths.has('text.value')) bar.appendChild(this.toggle('Italic', ITALIC_ICON, !!drawing.text?.italic, (v) => actions.patch({ 'text.italic': v })));
        if (paths.has('text.value')) bar.appendChild(this.iconBtn('Text', TYPE_ICON, () => this.toggleTextPanel(drawing, actions, !textOnBar)));
        const editableLevels = drawing.editableLevels();
        if (editableLevels && !(drawing instanceof MachFigure)) {
            const fib = drawing as unknown as { numbersSize?: string; labelsSize?: string };
            const sizes = TEXT_SIZE_OPTIONS.map((o) => o.value);
            bar.appendChild(this.dropdown('Numbers size', sizes, fib.numbersSize ?? 'small', (s) => numbersSizeIcon(s), (v) => actions.patch({ numbersSize: v }), { label: sizeLabel }));
            bar.appendChild(this.dropdown('Label size', sizes, fib.labelsSize ?? 'normal', (s) => labelSizeIcon(s), (v) => actions.patch({ labelsSize: v }), { label: sizeLabel }));
        }

        // Trailing group: settings wheel (when the tool has one) sits just left of the lock,
        // and a kebab overflow (z-order + reset) sits just right of delete.
        bar.appendChild(this.divider());
        if (isFrvp) bar.appendChild(this.iconBtn('Settings', GEAR_ICON, () => this.toggleFrvpPanel(drawing as FixedRangeVolumeProfile, actions)));
        if (isPosition) bar.appendChild(this.iconBtn('Position size', GEAR_ICON, () => this.togglePositionPanel(drawing as PositionTool, actions)));
        if (editableLevels) bar.appendChild(this.iconBtn('Levels', GEAR_ICON, () => this.toggleLevelsPanel(drawing, actions)));
        bar.appendChild(this.toggle('Lock', LOCK_ICON, drawing.locked, (v) => actions.setLocked(v)));
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
        this.el?.remove();
        this.el = null;
        this.textPanel = null;
        this.levelsPanel = null;
        this.onClose = null;
    }

    destroy(): void {
        this.close();
    }

    private readonly onOutside = (e: Event): void => {
        const target = e.target as Node;
        if (this.colorPop?.el.contains(target)) return; // the floating color picker is part of this popup
        if (this.menuPop?.el.contains(target)) return; // as is a floating dropdown menu
        if (this.el && !this.el.contains(target)) {
            const cb = this.onClose;
            this.close();
            cb?.();
        }
    };

    /** The expandable text editor (toggled by the Text button): the field itself, with bold/italic
     *  under it, plus color and size when those aren't already on the bar. */
    private toggleTextPanel(drawing: Drawing, actions: SettingsActions, withColorAndSize: boolean): void {
        if (this.textPanel) {
            this.textPanel.remove();
            this.textPanel = null;
            this.reposition();
            return;
        }
        const t = this.theme;
        const text = drawing.text;
        // Textarea on top; format controls sit in a footer row so they never cover typed text.
        const panel = document.createElement('div');
        panel.style.cssText = `padding:6px;border-top:1px solid var(--vela-border);display:flex;flex-direction:column;gap:4px;`;
        const input = document.createElement('textarea');
        input.placeholder = 'Label…';
        input.value = text?.value ?? '';
        input.rows = 1;
        input.style.cssText = `display:block;width:100%;box-sizing:border-box;min-width:220px;min-height:46px;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:6px;padding:6px 9px;font:13px/18px ${t.fontFamily};resize:none;overflow-y:hidden;`;
        input.addEventListener('input', () => {
            actions.patch({ 'text.value': input.value });
            autoGrow(input);
            this.reposition();
        });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // typing (incl. Enter for newlines, Delete) must not reach the chart
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

        panel.append(input, tools);
        this.el?.appendChild(panel);
        this.textPanel = panel;
        autoGrow(input); // size to initial content (multi-line aware)
        this.reposition();
        input.focus();
    }

    /** Gear panel for the position tool: account fields (risk %, balance, position size — size
     *  back-solves the risk %), the trade levels (direction switch, entry price, stop/target with
     *  Price / Points units), per-label display toggles, and a live loss/size summary. Every commit
     *  re-reads the live drawing — editing one field can move another (a flipped level, a
     *  back-solved risk %), so all fields refresh together. */
    private togglePositionPanel(drawing: PositionTool, actions: SettingsActions): void {
        if (this.levelsPanel) {
            this.levelsPanel.remove();
            this.levelsPanel = null;
            this.reposition();
            return;
        }
        const t = this.theme;
        const panel = document.createElement('div');
        panel.style.cssText = `padding:8px 10px;border-top:1px solid var(--vela-border);display:flex;flex-direction:column;gap:6px;min-width:280px;`;

        const live = (): PositionTool => {
            const d = actions.resolve();
            return d instanceof PositionTool ? d : drawing;
        };
        const refreshers: Array<() => void> = [];
        const refreshAll = (): void => refreshers.forEach((f) => f());

        /** Trim binary float noise so back-solved values (risk % from a typed size) stay readable. */
        const fmt = (n: number): string => String(Math.round(n * 1e8) / 1e8);

        const numberInput = (): HTMLInputElement => {
            const input = document.createElement('input');
            input.type = 'number';
            input.style.cssText = `width:96px;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:4px 6px;font:12px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
            return input;
        };
        const rowShell = (label: string): HTMLDivElement => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;opacity:0.9;';
            row.appendChild(lbl);
            panel.appendChild(row);
            return row;
        };
        const onEnterCommit = (input: HTMLInputElement, commit: () => void): void => {
            input.addEventListener('change', commit);
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                    input.blur();
                }
            });
        };

        type NumField = 'riskPercent' | 'accountBalance' | 'quantity' | 'entryPrice';
        const numberRow = (label: string, path: NumField, clamp?: { min: number; max: number; step: number }): void => {
            const row = rowShell(label);
            const input = numberInput();
            if (clamp) {
                input.min = String(clamp.min);
                input.max = String(clamp.max);
                input.step = String(clamp.step);
            } else {
                input.step = 'any';
            }
            input.value = fmt(live()[path]);
            const commit = (): void => {
                const n = parseFloat(input.value);
                if (!Number.isFinite(n)) {
                    input.value = fmt(live()[path]);
                    return;
                }
                const v = clamp ? Math.min(clamp.max, Math.max(clamp.min, n)) : n;
                actions.patch({ [path]: v });
                refreshAll();
            };
            onEnterCommit(input, commit);
            refreshers.push(() => {
                if (document.activeElement !== input) input.value = fmt(live()[path]);
            });
            row.appendChild(input);
        };

        const unitSelect = (): HTMLSelectElement => {
            const sel = document.createElement('select');
            sel.style.cssText = `width:76px;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:4px 4px;font:12px ${t.fontFamily};outline:none;cursor:pointer;`;
            sel.addEventListener('keydown', (e) => e.stopPropagation());
            return sel;
        };

        /** Stop/target row: the value input plus a Price / Points unit dropdown. Switching the
         *  unit re-expresses the CURRENT level in the new unit (the level itself doesn't move);
         *  typing commits in the selected unit. */
        const levelRow = (label: string, path: 'stopPrice' | 'targetPrice', level: 'stop' | 'target'): void => {
            let mode: PositionLevelMode = 'price';
            const row = rowShell(label);
            const input = numberInput();
            input.step = 'any';
            input.style.width = '84px';
            const display = (): string => fmt(live().levelDisplayValue(level, mode));
            input.value = display();
            const commit = (): void => {
                const n = parseFloat(input.value);
                if (!Number.isFinite(n)) {
                    input.value = display();
                    return;
                }
                actions.patch({ [path]: live().levelPriceFromDisplay(level, mode, n) });
                refreshAll();
            };
            onEnterCommit(input, commit);
            const sel = unitSelect();
            for (const opt of [
                { value: 'price', label: 'Price' },
                { value: 'points', label: 'Points' },
            ]) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                sel.appendChild(o);
            }
            sel.addEventListener('change', () => {
                mode = sel.value as PositionLevelMode;
                input.value = display();
            });
            refreshers.push(() => {
                if (document.activeElement !== input) input.value = display();
            });
            row.append(input, sel);
        };

        const directionRow = (): void => {
            const row = rowShell('Direction');
            const sel = unitSelect();
            sel.style.width = '96px';
            for (const opt of DIRECTION_OPTIONS) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                sel.appendChild(o);
            }
            sel.value = live().direction;
            sel.addEventListener('change', () => {
                actions.patch({ direction: sel.value });
                refreshAll();
            });
            refreshers.push(() => {
                sel.value = live().direction;
            });
            row.appendChild(sel);
        };

        type BoolField = 'showText' | 'showHeader' | 'showPrices' | 'showLossSize' | 'showTargetLabel' | 'showStopLabel';
        const toggleRow = (label: string, path: BoolField): void => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = live()[path];
            chk.style.cssText = `accent-color:${t.textColor};width:15px;height:15px;flex:none;cursor:pointer;`;
            chk.addEventListener('change', () => {
                actions.patch({ [path]: chk.checked });
                refreshAll();
            });
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;opacity:0.9;';
            refreshers.push(() => {
                chk.checked = live()[path];
            });
            row.append(chk, lbl);
            panel.appendChild(row);
        };

        const section = (label: string): void => {
            const el = document.createElement('div');
            el.style.cssText = `opacity:0.5;font-size:10px;letter-spacing:0.6px;text-transform:uppercase;padding-top:4px;`;
            el.textContent = label;
            panel.appendChild(el);
        };

        section('Account');
        numberRow('Risk %', 'riskPercent', { min: 0, max: 100, step: 0.1 });
        numberRow('Account balance', 'accountBalance', { min: 0, max: 1e12, step: 1 });
        numberRow('Position size', 'quantity');

        section('Levels');
        directionRow();
        numberRow('Entry price', 'entryPrice');
        levelRow('Stop', 'stopPrice', 'stop');
        levelRow('Target', 'targetPrice', 'target');

        section('Display');
        toggleRow('Show text', 'showText');
        toggleRow('Show direction & ratio', 'showHeader');
        toggleRow('Show loss & size', 'showLossSize');
        toggleRow('Show target label', 'showTargetLabel');
        toggleRow('Show stop label', 'showStopLabel');
        toggleRow('Show level prices', 'showPrices');

        const summary = document.createElement('div');
        summary.style.cssText = `opacity:0.7;font-size:11px;line-height:1.4;border-top:1px solid var(--vela-border);padding-top:6px;font-variant-numeric:tabular-nums;`;
        refreshers.push(() => {
            const d = live();
            summary.textContent = `${d.headerLabel()}  —  ${d.lossSizeLabel()}`;
        });
        panel.appendChild(summary);
        refreshAll();

        this.el?.appendChild(panel);
        this.levelsPanel = panel;
        this.reposition();
    }

    /** Gear panel for Fixed Range Volume Profile: rows / VA / width / anchor, volume colors,
     *  and the VAH / VAL / POC / developing level toggles (color + line style). */
    private toggleFrvpPanel(drawing: FixedRangeVolumeProfile, actions: SettingsActions): void {
        if (this.levelsPanel) {
            this.levelsPanel.remove();
            this.levelsPanel = null;
            this.reposition();
            return;
        }
        const t = this.theme;
        const s = drawing.frvp;
        const panel = document.createElement('div');
        panel.className = 'vela-frvp';
        panel.style.cssText = `padding:8px 10px;border-top:1px solid var(--vela-border);max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-width:280px;`;

        const numberRow = (label: string, path: keyof FrvpStyle, min: number, max: number, step: number): void => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;opacity:0.9;';
            const input = document.createElement('input');
            input.type = 'number';
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            input.value = String(s[path] as number);
            input.style.cssText = `width:72px;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:4px 6px;font:12px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
            const commit = (): void => {
                const n = parseFloat(input.value);
                if (!Number.isFinite(n)) {
                    input.value = String(s[path] as number);
                    return;
                }
                const clamped = Math.min(max, Math.max(min, n));
                input.value = String(clamped);
                actions.patch({ [`frvp.${path}`]: clamped });
            };
            input.addEventListener('change', commit);
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                    input.blur();
                }
            });
            row.append(lbl, input);
            panel.appendChild(row);
        };

        numberRow('Rows', 'rows', 1, 500, 1);
        numberRow('Value Area', 'valueAreaPct', 0, 100, 1);
        numberRow('Width %', 'widthPct', 0, 100, 1);

        {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;';
            const lbl = document.createElement('span');
            lbl.textContent = 'Anchor';
            lbl.style.cssText = 'flex:1;opacity:0.9;';
            const sel = document.createElement('select');
            sel.style.cssText = `width:96px;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:4px 6px;font:12px ${t.fontFamily};outline:none;cursor:pointer;`;
            for (const opt of [
                { value: 'right', label: 'Right' },
                { value: 'left', label: 'Left' },
            ]) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                o.selected = s.anchor === opt.value;
                sel.appendChild(o);
            }
            sel.addEventListener('change', () => actions.patch({ 'frvp.anchor': sel.value }));
            sel.addEventListener('keydown', (e) => e.stopPropagation());
            row.append(lbl, sel);
            panel.appendChild(row);
        }

        const colorRow = (label: string, path: keyof FrvpStyle): void => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;';
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;opacity:0.9;';
            const col = document.createElement('button');
            col.type = 'button';
            let cur = s[path] as string;
            col.style.cssText = `width:18px;height:18px;flex:none;border:1px solid var(--vela-border);border-radius:0;cursor:pointer;background:${cur};padding:0;`;
            col.addEventListener('pointerdown', (e) => e.stopPropagation());
            col.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleColorPopover(col, cur, (v) => {
                    cur = v;
                    col.style.background = v;
                    actions.patch({ [`frvp.${path}`]: v });
                });
            });
            row.append(lbl, col);
            panel.appendChild(row);
        };

        colorRow('Up Volume', 'upColor');
        colorRow('Down Volume', 'downColor');
        colorRow('Value Area Up', 'vaUpColor');
        colorRow('Value Area Down', 'vaDownColor');

        const styles = LINE_STYLE_OPTIONS.map((o) => o.value);
        const levelRow = (
            label: string,
            showPath: keyof FrvpStyle,
            colorPath: keyof FrvpStyle,
            stylePath: keyof FrvpStyle,
        ): void => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = Boolean(s[showPath]);
            // An unset color (the POC's themed default) shows as the ink actually painted.
            const current = (s[colorPath] as string | undefined) ?? contrastColor(t.background);
            chk.style.cssText = `accent-color:${current};width:15px;height:15px;flex:none;cursor:pointer;`;
            chk.addEventListener('change', () => actions.patch({ [`frvp.${showPath}`]: chk.checked }));
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;min-width:0;opacity:0.9;';
            const col = document.createElement('button');
            col.type = 'button';
            let cur = current;
            col.style.cssText = `width:18px;height:18px;flex:none;border:1px solid var(--vela-border);border-radius:0;cursor:pointer;background:${cur};padding:0;`;
            col.addEventListener('pointerdown', (e) => e.stopPropagation());
            col.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleColorPopover(col, cur, (v) => {
                    cur = v;
                    col.style.background = v;
                    chk.style.accentColor = v;
                    actions.patch({ [`frvp.${colorPath}`]: v });
                });
            });
            const styleBtn = this.dropdown(
                `${label} style`,
                styles,
                s[stylePath] as string,
                (st) => lineIcon(2, st),
                (v) => actions.patch({ [`frvp.${stylePath}`]: v }),
                { label: styleLabel },
            );
            styleBtn.style.width = 'auto';
            row.append(chk, lbl, col, styleBtn);
            panel.appendChild(row);
        };

        levelRow('VAH', 'showVah', 'vahColor', 'vahStyle');
        levelRow('VAL', 'showVal', 'valColor', 'valStyle');
        levelRow('POC', 'showPoc', 'pocColor', 'pocStyle');
        levelRow('Developing POC', 'showDevelopingPoc', 'developingPocColor', 'developingPocStyle');
        levelRow('Developing VA', 'showDevelopingVa', 'developingVaColor', 'developingVaStyle');

        this.el?.appendChild(panel);
        this.levelsPanel = panel;
        this.reposition();
    }

    /** The expandable per-level editor (gear) for Fibonacci tools: enable, recolor, and label
     *  each level. Edits emit `levels.<i>.<field>` patches that round-trip through `props`. */
    private toggleLevelsPanel(drawing: Drawing, actions: SettingsActions): void {
        if (this.levelsPanel) {
            this.levelsPanel.remove();
            this.levelsPanel = null;
            this.reposition();
            return;
        }
        const levels = drawing.editableLevels();
        if (!levels) return;
        const t = this.theme;
        const isMach = drawing instanceof MachFigure;
        const panel = document.createElement('div');
        panel.className = 'vela-fiblevels';
        panel.style.cssText = `padding:6px;border-top:1px solid var(--vela-border);max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;min-width:${isMach ? 200 : 248}px;`;
        // Mach: show/hide all on-chart ratio labels from inside this panel (not the toolbar).
        if (isMach) {
            const mach = drawing as MachFigure;
            const showRow = document.createElement('label');
            showRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px 8px;margin-bottom:2px;border-bottom:1px solid var(--vela-border);cursor:pointer;user-select:none;';
            const showChk = document.createElement('input');
            showChk.type = 'checkbox';
            showChk.checked = mach.showRatios !== false;
            showChk.style.cssText = `accent-color:${t.textColor};width:15px;height:15px;flex:none;cursor:pointer;`;
            showChk.addEventListener('change', () => actions.patch({ showRatios: showChk.checked }));
            const showLbl = document.createElement('span');
            showLbl.textContent = 'Show ratio labels';
            showLbl.style.cssText = 'opacity:0.9;';
            showRow.append(showChk, showLbl);
            panel.appendChild(showRow);
        }
        levels.forEach((lv, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = lv.enabled;
            chk.style.cssText = `accent-color:${lv.color};width:15px;height:15px;flex:none;cursor:pointer;`;
            chk.addEventListener('change', () => actions.patch({ [`levels.${i}.enabled`]: chk.checked }));
            const col = document.createElement('button');
            col.type = 'button';
            col.style.cssText = `width:18px;height:18px;flex:none;border:1px solid var(--vela-border);border-radius:0;cursor:pointer;background:${lv.color};padding:0;`;
            let curC = lv.color;
            col.addEventListener('pointerdown', (e) => e.stopPropagation());
            col.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleColorPopover(col, curC, (v) => {
                    curC = v;
                    col.style.background = v;
                    chk.style.accentColor = v;
                    actions.patch({ [`levels.${i}.color`]: v });
                });
            });
            // Ratio is editable — for Mach tools it is the circle radius / R; changing it
            // must update geometry (a read-only span was why edits looked like a no-op).
            const ratio = document.createElement('input');
            ratio.type = 'number';
            ratio.step = 'any';
            ratio.min = '0';
            let curRatio = lv.ratio;
            ratio.value = String(curRatio);
            ratio.title = 'Ratio';
            // Mach ratios need a wider field (fib values like 11.09 / typed edits); Fib rows keep a compact field beside the label.
            ratio.style.cssText = isMach
                ? `width:88px;flex:1;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:5px 8px;font:13px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`
                : `width:52px;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:3px 4px;font:12px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
            const commitRatio = (): void => {
                const n = parseFloat(ratio.value);
                if (!Number.isFinite(n) || n <= 0) {
                    ratio.value = String(curRatio);
                    return;
                }
                curRatio = n;
                actions.patch({ [`levels.${i}.ratio`]: n });
            };
            ratio.addEventListener('change', commitRatio);
            ratio.addEventListener('keydown', (e) => {
                e.stopPropagation(); // typing must not reach the chart
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRatio();
                    ratio.blur();
                }
            });
            row.append(chk, col, ratio);
            // Fib tools keep a custom label field; Mach levels are ratio-only (on-chart text is the ratio).
            if (!isMach) {
                const label = document.createElement('input');
                label.type = 'text';
                label.placeholder = 'label…';
                label.value = lv.label ?? '';
                label.style.cssText = `flex:1;min-width:60px;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:3px 7px;font:12px ${t.fontFamily};outline:none;`;
                label.addEventListener('input', () => actions.patch({ [`levels.${i}.label`]: label.value }));
                label.addEventListener('keydown', (e) => e.stopPropagation()); // typing must not reach the chart
                row.appendChild(label);
            }
            panel.appendChild(row);
        });
        this.el?.appendChild(panel);
        this.levelsPanel = panel;
        this.reposition();
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

    // ── control factories ──
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

    /** The trailing kebab overflow — z-order actions + reset settings. */
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
                { icon: FRONT_ICON, label: 'Bring to front', onClick: () => actions.reorder('front') },
                { icon: BACK_ICON, label: 'Send to back', onClick: () => actions.reorder('back') },
                { icon: RESET_ICON, label: 'Reset settings', onClick: () => actions.resetSettings() },
            ]);
        });
        return b;
    }

    /** Host-anchored floating shell (stays inside the chart). Content is filled after
     *  construction so `fill` can close over the live `Popover` without hitting TDZ. */
    private hostFloat(anchor: HTMLElement, opts: { align?: 'start' | 'end'; zIndex: number; padding: string; fill: (el: HTMLElement, pop: Popover) => void }): Popover {
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

    private toggle(tip: string, icon: string, active: boolean, onChange: (v: boolean) => void): HTMLButtonElement {
        const b = this.base(tip);
        b.innerHTML = sized(icon);
        // `data-active` alone drives the fill — the stylesheet owns idle/hover/active.
        const set = (on: boolean): void => {
            b.dataset.active = on ? '1' : '0';
        };
        set(active);
        let on = active;
        b.addEventListener('click', () => {
            on = !on;
            set(on);
            onChange(on);
        });
        return b;
    }

    /** An inline numeric width field for tools whose stroke range outgrows the 1–4px
     *  ladder — the value is clamped to the schema's declared min/max on commit. */
    private widthInput(tip: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
        const input = document.createElement('input');
        input.type = 'number';
        input.dataset.tip = tip;
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = String(value);
        input.style.cssText = `width:52px;height:${BTN}px;box-sizing:border-box;flex:none;background:transparent;color:inherit;border:1px solid var(--vela-border);border-radius:5px;padding:0 4px;font:12px ${this.theme.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
        const commit = (): void => {
            const n = parseFloat(input.value);
            if (!Number.isFinite(n)) {
                input.value = String(value);
                return;
            }
            const v = Math.min(max, Math.max(min, n));
            input.value = String(v);
            value = v;
            onChange(v);
        };
        input.addEventListener('change', commit);
        input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // typing (incl. Delete) must not reach the chart
            if (e.key === 'Enter') {
                e.preventDefault();
                commit();
                input.blur();
            }
        });
        return input;
    }

    /** A pick-one dropdown: the trigger shows the current value's glyph (plus an optional inline
     *  text label — e.g. `2px` — for controls that would otherwise look alike), and clicking it
     *  opens a floating list of every option so a value is one click away (no cycling through). */
    private dropdown(
        tip: string,
        values: readonly (string | number)[],
        current: string | number,
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
        const paint = (v: string | number): void => {
            b.replaceChildren();
            const ic = document.createElement('span');
            ic.style.cssText = 'display:flex;';
            ic.innerHTML = sized(render(v));
            b.appendChild(ic);
            if (opts.label && opts.labelInTrigger) {
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
        current: string | number,
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
                    const ic = document.createElement('span');
                    ic.style.cssText = 'display:flex;flex:none;width:22px;justify-content:center;';
                    ic.innerHTML = sized(render(v), 18);
                    item.appendChild(ic);
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
     *  `iconSize` shrinks it for the floating text controls. */
    private colorButton(tip: string, icon: string, color: string, onChange: (v: string) => void, iconSize = 17): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tip = tip;
        b.className = 'vela-dpop-btn';
        b.style.cssText = `position:relative;width:${BTN}px;height:${BTN}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;border-radius:5px;border:none;color:inherit;padding:0;`;
        const ic = document.createElement('span');
        ic.style.cssText = 'display:flex;';
        ic.innerHTML = sized(icon, iconSize);
        const bar = document.createElement('span');
        bar.style.cssText = `display:block;height:3px;width:${Math.round(iconSize * 0.85)}px;border-radius:2px;background:${color};`;
        b.append(ic, bar);
        let cur = color;
        // Stop the swatch's own pointerdown from reaching `el` (which would pre-close the popover),
        // so a re-click toggles it shut instead of closing-then-reopening.
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleColorPopover(b, cur, (v) => {
                cur = v;
                bar.style.background = v;
                onChange(v);
            });
        });
        return b;
    }

    /** Open the color popover for `anchor`, or close it if it's already this anchor's (toggle). */
    private toggleColorPopover(anchor: HTMLElement, color: string, onChange: (v: string) => void): void {
        if (this.colorOwner === anchor) {
            this.closeColorPopover();
            return;
        }
        this.openColorPopover(anchor, color, onChange);
    }

    /** A floating RGB picker + opacity slider anchored to a color swatch — emits `#RRGGBB(AA)`. */
    private openColorPopover(anchor: HTMLElement, color: string, onChange: (v: string) => void): void {
        const t = this.theme;
        this.colorPop = this.hostFloat(anchor, {
            zIndex: 25,
            padding: '10px',
            fill: (el) => { el.appendChild(buildColorPicker(color, t, onChange)); },
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
const RESET_ICON = icon('reset');
const GEAR_ICON = icon('gear');
const CHEVRON_ICON = icon('chevron-down');
const R2_ICON = icon('r-squared');
const BANDS_ICON = icon('bands');
const DEDEKIND_ICON = icon('dedekind');
const SONIC_ICON = icon('sonic');
const SUPERSONIC_ICON = icon('supersonic');

/** A line glyph at a given width + style (for the width/style dropdown glyphs). The stroke IS
 *  the value being previewed, so it overrides the tier's weight. */
function lineIcon(width: number | string, style: string | number): string {
    const dash = style === 'dashed' ? '5,3' : style === 'dotted' ? '1.5,3' : '';
    return svg24(`<line x1="3.5" y1="12" x2="20.5" y2="12" stroke-width="${Number(width) || 2}" stroke-dasharray="${dash}"/>`);
}

const MAX_TEXT_LINES = 4;
/** Grow a label textarea to fit its content, up to 4 lines, then scroll (styled). */
function autoGrow(ta: HTMLTextAreaElement): void {
    ta.style.height = 'auto';
    const max = 18 * MAX_TEXT_LINES + 10 + 2; // line-height·lines + vertical padding + border
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
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

