import type { VelaTheme } from '../../../core/options';
import type { Drawing, RegressionStyle, VwapStyle, FrvpStyle } from '../../../core/drawings';
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
    effectiveFillColor,
} from '../../../core/drawings';
import { buildColorPicker } from './colorPicker';
import { CHROME_BORDER_COLOR } from '../core/chartConfig';

/** A `{ path: value }` patch emitted as the user edits a control. */
export type SettingsPatch = Record<string, unknown>;

/** The actions a settings popup can invoke (wired by the controller to intents). */
export interface SettingsActions {
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
.vela-dpop input[type=color]{-webkit-appearance:none;appearance:none;border:none;padding:0;background:none;cursor:pointer;border-radius:5px;}
.vela-dpop input[type=color]::-webkit-color-swatch-wrapper{padding:0;}
.vela-dpop input[type=color]::-webkit-color-swatch{border:none;border-radius:5px;}
.vela-dpop input[type=color]::-moz-color-swatch{border:none;border-radius:5px;}
.vela-dpop textarea{outline:none;transition:border-color .12s ease,box-shadow .12s ease;}
.vela-dpop textarea:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}
.vela-dpop textarea::placeholder{color:currentColor;opacity:0.4;}
.vela-dpop textarea::-webkit-scrollbar,.vela-dpop .vela-fiblevels::-webkit-scrollbar,.vela-dpop .vela-frvp::-webkit-scrollbar{width:8px;}
.vela-dpop textarea::-webkit-scrollbar-thumb,.vela-dpop .vela-fiblevels::-webkit-scrollbar-thumb,.vela-dpop .vela-frvp::-webkit-scrollbar-thumb{background:var(--vela-scroll);border-radius:4px;border:2px solid transparent;background-clip:padding-box;}
.vela-dpop textarea::-webkit-scrollbar-track,.vela-dpop .vela-fiblevels::-webkit-scrollbar-track,.vela-dpop .vela-frvp::-webkit-scrollbar-track{background:transparent;}
.vela-dpop .vela-fiblevels input[type=text],.vela-dpop .vela-fiblevels input[type=number],.vela-dpop .vela-frvp input[type=text],.vela-dpop .vela-frvp input[type=number],.vela-dpop .vela-frvp select{transition:border-color .12s ease,box-shadow .12s ease;}
.vela-dpop .vela-fiblevels input[type=text]:focus,.vela-dpop .vela-fiblevels input[type=number]:focus,.vela-dpop .vela-frvp input[type=text]:focus,.vela-dpop .vela-frvp input[type=number]:focus,.vela-dpop .vela-frvp select:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}`;
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
    private colorPop: HTMLDivElement | null = null; // floating RGB + opacity picker for a color swatch
    private colorOwner: HTMLElement | null = null; // the swatch the open color popover belongs to (for toggle)
    private menuEl: HTMLDivElement | null = null; // floating option list for a dropdown control
    private menuOwner: HTMLElement | null = null; // the trigger the open menu belongs to (for toggle)
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
        return this.el?.contains(node) === true || this.colorPop?.contains(node) === true || this.menuEl?.contains(node) === true;
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
        el.style.cssText = `position:absolute;z-index:22;background:${t.background};border:1px solid ${CHROME_BORDER_COLOR};border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,0.45);color:${t.textColor};font:12px ${t.fontFamily};display:flex;flex-direction:column;pointer-events:auto;overflow:hidden;`;
        el.style.setProperty('--vela-focus', withAlpha(t.textColor, 0.5));
        el.style.setProperty('--vela-focus-soft', withAlpha(t.textColor, 0.12));
        el.style.setProperty('--vela-scroll', withAlpha(t.textColor, 0.3));
        // Engaging any control in the bar dismisses an open color popover / dropdown menu (they live
        // outside `el` and stop their own pointerdowns, so this only fires for the OTHER controls —
        // and a dropdown trigger stops its own pointerdown so it can toggle its menu on click).
        el.addEventListener('pointerdown', () => {
            this.closeColorPopover();
            this.closeMenu();
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
        if (paths.has('style.lineWidth')) bar.appendChild(this.dropdown('Line width', [1, 2, 3, 4], drawing.style.lineWidth, (w) => lineIcon(w, 'solid'), (v) => actions.patch({ 'style.lineWidth': v }), { label: (v) => `${v}px`, labelInTrigger: true }));
        if (paths.has('style.lineStyle')) bar.appendChild(this.dropdown('Line style', LINE_STYLE_OPTIONS.map((o) => o.value), drawing.style.lineStyle, (s) => lineIcon(2, s), (v) => actions.patch({ 'style.lineStyle': v }), { label: styleLabel }));
        // initialize the Fill swatch to the color actually painted (validity tint / line-color wash /
        // background fallback), not a stale default — same source the renderer fills with.
        if (paths.has('style.fillColor')) bar.appendChild(this.colorButton('Fill', BUCKET_ICON, effectiveFillColor(drawing, this.theme) ?? drawing.style.fillColor ?? DEFAULT_DRAWING_COLOR, (v) => actions.patch({ 'style.fillColor': v })));
        // Fixed-range VP: all settings live in the gear panel (nothing inline on the quick bar).
        const isFrvp = paths.has('frvp.rows') && drawing instanceof FixedRangeVolumeProfile;
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
        if (editableLevels) bar.appendChild(this.iconBtn('Levels', GEAR_ICON, () => this.toggleLevelsPanel(drawing, actions)));
        bar.appendChild(this.toggle('Lock', LOCK_ICON, drawing.locked, (v) => actions.setLocked(v)));
        const del = this.iconBtn('Delete', TRASH_ICON, () => actions.remove());
        del.style.color = '#f6465d';
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
        if (this.colorPop?.contains(target)) return; // the floating color picker is part of this popup
        if (this.menuEl?.contains(target)) return; // as is a floating dropdown menu
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
        panel.style.cssText = `padding:6px;border-top:1px solid ${CHROME_BORDER_COLOR};display:flex;flex-direction:column;gap:4px;`;
        const input = document.createElement('textarea');
        input.placeholder = 'Label…';
        input.value = text?.value ?? '';
        input.rows = 1;
        input.style.cssText = `display:block;width:100%;box-sizing:border-box;min-width:220px;min-height:46px;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:6px;padding:6px 9px;font:13px/18px ${t.fontFamily};resize:none;overflow-y:hidden;`;
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
        panel.style.cssText = `padding:8px 10px;border-top:1px solid ${CHROME_BORDER_COLOR};max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-width:280px;`;

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
            input.style.cssText = `width:72px;flex:none;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:5px;padding:4px 6px;font:12px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
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
            sel.style.cssText = `width:96px;flex:none;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:5px;padding:4px 6px;font:12px ${t.fontFamily};outline:none;cursor:pointer;`;
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
            col.style.cssText = `width:22px;height:18px;flex:none;border:1px solid ${CHROME_BORDER_COLOR};border-radius:4px;cursor:pointer;background:${cur};padding:0;`;
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
            chk.style.cssText = `accent-color:${s[colorPath] as string};width:15px;height:15px;flex:none;cursor:pointer;`;
            chk.addEventListener('change', () => actions.patch({ [`frvp.${showPath}`]: chk.checked }));
            const lbl = document.createElement('span');
            lbl.textContent = label;
            lbl.style.cssText = 'flex:1;min-width:0;opacity:0.9;';
            const col = document.createElement('button');
            col.type = 'button';
            let cur = s[colorPath] as string;
            col.style.cssText = `width:22px;height:18px;flex:none;border:1px solid ${CHROME_BORDER_COLOR};border-radius:4px;cursor:pointer;background:${cur};padding:0;`;
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
        panel.style.cssText = `padding:6px;border-top:1px solid ${CHROME_BORDER_COLOR};max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;min-width:${isMach ? 200 : 248}px;`;
        // Mach: show/hide all on-chart ratio labels from inside this panel (not the toolbar).
        if (isMach) {
            const mach = drawing as MachFigure;
            const showRow = document.createElement('label');
            showRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px 8px;margin-bottom:2px;border-bottom:1px solid ' + CHROME_BORDER_COLOR + ';cursor:pointer;user-select:none;';
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
            col.style.cssText = `width:22px;height:18px;flex:none;border:1px solid ${CHROME_BORDER_COLOR};border-radius:4px;cursor:pointer;background:${lv.color};padding:0;`;
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
                ? `width:88px;flex:1;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:5px;padding:5px 8px;font:13px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`
                : `width:52px;flex:none;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:5px;padding:3px 4px;font:12px ${t.fontFamily};font-variant-numeric:tabular-nums;outline:none;`;
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
                label.style.cssText = `flex:1;min-width:60px;background:transparent;color:inherit;border:1px solid ${CHROME_BORDER_COLOR};border-radius:5px;padding:3px 7px;font:12px ${t.fontFamily};outline:none;`;
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
        const t = this.theme;
        b.style.cssText = `width:${BTN}px;height:${BTN}px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:inherit;border:none;border-radius:5px;padding:0;`;
        b.addEventListener('mouseenter', () => (b.style.background = withAlpha(t.textColor, 0.1)));
        b.addEventListener('mouseleave', () => (b.style.background = b.dataset.active === '1' ? withAlpha(t.textColor, 0.16) : 'transparent'));
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
        b.style.cssText = `width:${BTN}px;height:${BTN}px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;padding:0;cursor:grab;color:${withAlpha(this.theme.textColor, 0.32)};`;
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
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
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

    /** A floating list of one-shot actions (icon + label rows) opened by the kebab. */
    private openActionMenu(anchor: HTMLElement, rows: readonly { icon: string; label: string; onClick: () => void }[]): void {
        this.closeMenu();
        this.closeColorPopover();
        const t = this.theme;
        const menu = document.createElement('div');
        menu.className = 'vela-dpop';
        menu.style.cssText = `position:absolute;z-index:26;background:${t.background};border:1px solid ${CHROME_BORDER_COLOR};border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:4px;pointer-events:auto;display:flex;flex-direction:column;gap:1px;color:${t.textColor};font:12px ${t.fontFamily};`;
        menu.addEventListener('pointerdown', (e) => e.stopPropagation()); // keep clicks from dismissing the popup
        for (const row of rows) {
            const item = document.createElement('button');
            item.type = 'button';
            item.style.cssText = `display:flex;align-items:center;gap:9px;min-width:150px;padding:6px 9px;border:none;border-radius:5px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;`;
            const ic = document.createElement('span');
            ic.style.cssText = 'display:flex;flex:none;width:20px;justify-content:center;';
            ic.innerHTML = sized(row.icon, 18);
            const tx = document.createElement('span');
            tx.textContent = row.label;
            tx.style.cssText = 'flex:1;';
            item.append(ic, tx);
            item.addEventListener('mouseenter', () => (item.style.background = withAlpha(t.textColor, 0.1)));
            item.addEventListener('mouseleave', () => (item.style.background = 'transparent'));
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeMenu();
                row.onClick();
            });
            menu.appendChild(item);
        }
        this.host.appendChild(menu);
        // Right-align under the kebab, flipping above / clamping so it stays inside the chart.
        const ar = anchor.getBoundingClientRect();
        const hr = this.host.getBoundingClientRect();
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        let left = ar.right - hr.left - w;
        let top = ar.bottom - hr.top + 6;
        if (left + w > hr.width - 4) left = hr.width - w - 4;
        if (left < 4) left = 4;
        if (top + h > hr.height - 4) top = ar.top - hr.top - h - 6;
        if (top < 4) top = 4;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        this.menuEl = menu;
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
            tp.style.cssText = `position:absolute;z-index:27;pointer-events:none;white-space:nowrap;background:${t.textColor};color:${t.background};padding:3px 7px;border-radius:5px;font:11px ${t.fontFamily};box-shadow:0 3px 10px rgba(0,0,0,0.35);`;
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
        const set = (on: boolean): void => {
            b.dataset.active = on ? '1' : '0';
            b.style.background = on ? withAlpha(this.theme.textColor, 0.16) : 'transparent';
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
        this.closeMenu();
        this.closeColorPopover();
        const t = this.theme;
        const menu = document.createElement('div');
        menu.className = 'vela-dpop';
        menu.style.cssText = `position:absolute;z-index:26;background:${t.background};border:1px solid ${CHROME_BORDER_COLOR};border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:4px;pointer-events:auto;display:flex;flex-direction:column;gap:1px;color:${t.textColor};font:12px ${t.fontFamily};`;
        menu.addEventListener('pointerdown', (e) => e.stopPropagation()); // keep clicks from dismissing the popup
        for (const v of values) {
            const active = v === current;
            const item = document.createElement('button');
            item.type = 'button';
            item.style.cssText = `display:flex;align-items:center;gap:8px;${label ? 'min-width:118px;' : ''}padding:5px 8px;border:none;border-radius:5px;background:${active ? withAlpha(t.textColor, 0.16) : 'transparent'};color:inherit;cursor:pointer;text-align:left;font:inherit;`;
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
            item.addEventListener('mouseenter', () => (item.style.background = withAlpha(t.textColor, active ? 0.16 : 0.1)));
            item.addEventListener('mouseleave', () => (item.style.background = active ? withAlpha(t.textColor, 0.16) : 'transparent'));
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeMenu();
                onPick(v);
            });
            menu.appendChild(item);
        }
        this.host.appendChild(menu);
        // Anchor below the trigger, flipping above / clamping so it stays inside the chart.
        const ar = anchor.getBoundingClientRect();
        const hr = this.host.getBoundingClientRect();
        const w = menu.offsetWidth;
        const h = menu.offsetHeight;
        let left = ar.left - hr.left;
        let top = ar.bottom - hr.top + 6;
        if (left + w > hr.width - 4) left = hr.width - w - 4;
        if (left < 4) left = 4;
        if (top + h > hr.height - 4) top = ar.top - hr.top - h - 6;
        if (top < 4) top = 4;
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
        this.menuEl = menu;
        this.menuOwner = anchor;
    }

    private closeMenu(): void {
        if (this.menuEl) {
            this.menuEl.remove();
            this.menuEl = null;
        }
        this.menuOwner = null;
    }

    /** A color control: an `icon` over a thin **colored underline** showing the current
     *  value (the common idiom), with an invisible native picker overlaid to edit it.
     *  `iconSize` shrinks it for the floating text controls. */
    private colorButton(tip: string, icon: string, color: string, onChange: (v: string) => void, iconSize = 17): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.tip = tip;
        b.style.cssText = `position:relative;width:${BTN}px;height:${BTN}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;border-radius:5px;border:none;background:transparent;color:inherit;padding:0;`;
        const t = this.theme;
        b.addEventListener('mouseenter', () => (b.style.background = withAlpha(t.textColor, 0.1)));
        b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
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
        this.closeColorPopover();
        this.closeMenu();
        const t = this.theme;
        const pop = document.createElement('div');
        pop.style.cssText = `position:absolute;z-index:25;background:${t.background};border:1px solid ${CHROME_BORDER_COLOR};border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.5);padding:10px;pointer-events:auto;`;
        pop.addEventListener('pointerdown', (e) => e.stopPropagation()); // keep clicks from dismissing the popup
        pop.appendChild(buildColorPicker(color, t, onChange));
        this.host.appendChild(pop);
        // Anchor below the swatch, flipping above / clamping so it stays inside the chart.
        const ar = anchor.getBoundingClientRect();
        const hr = this.host.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        let left = ar.left - hr.left;
        let top = ar.bottom - hr.top + 6;
        if (left + w > hr.width - 4) left = hr.width - w - 4;
        if (left < 4) left = 4;
        if (top + h > hr.height - 4) top = ar.top - hr.top - h - 6;
        if (top < 4) top = 4;
        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
        this.colorPop = pop;
        this.colorOwner = anchor;
    }

    private closeColorPopover(): void {
        if (this.colorPop) {
            this.colorPop.remove();
            this.colorPop = null;
        }
        this.colorOwner = null;
    }

    private divider(): HTMLElement {
        const d = document.createElement('div');
        d.style.cssText = `width:1px;height:18px;margin:0 3px;background:${CHROME_BORDER_COLOR};`;
        return d;
    }
}

// ── inline SVG icons (Lucide-inspired: 24px grid, 1.9 stroke, round caps/joins) ──
const SW = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
/** Paintbrush — line/stroke color. */
const BRUSH_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/></svg>`;
/** Paint bucket — fill color. */
const BUCKET_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="m18.5 11.5-7-7L4 12a1.8 1.8 0 0 0 0 2.5l5 5a1.8 1.8 0 0 0 2.5 0Z"/><path d="m5 5 4 4"/><path d="M3.5 13.5h13"/><path d="M21 17.5c0 1.1-.9 2-2 2s-2-.9-2-2c0-1 1.2-1.7 2-3 .8 1.3 2 2 2 3Z"/></svg>`;
/** Type / T — text color. */
const TYPE_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9.5 19.5h5"/></svg>`;
const PRICE_DELTA_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M12 4v16"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/></svg>`;
const DATE_DELTA_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M4 12h16"/><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/></svg>`;
const LOCK_ICON = `<svg viewBox="0 0 24 24" ${SW}><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>`;
const FRONT_ICON = `<svg viewBox="0 0 24 24" ${SW}><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 24 24" ${SW}><rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none" opacity="0.35"/><path d="M4.5 10.5V6a1.5 1.5 0 0 1 1.5-1.5h4.5"/><path d="M19.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-4.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M4 6.5h16"/><path d="M18 6.5V19a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6.5"/><path d="M9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M10 11v6M14 11v6"/></svg>`;
const BOLD_ICON = `<svg viewBox="0 0 24 24" ${SW} stroke-width="2.4"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7Z"/><path d="M7 12h7a3.5 3.5 0 0 1 0 7H7Z"/></svg>`;
const ITALIC_ICON = `<svg viewBox="0 0 24 24" ${SW} stroke-width="2.2"><path d="M15 5h-5M14 19H9M14.5 5 10 19"/></svg>`;
/** Grip dots — the drag handle for moving the toolbar. */
const GRIP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;
/** Vertical ellipsis — the kebab overflow trigger (z-order + reset). */
const KEBAB_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`;
/** Drawing tile + restore arc — reset the drawing's settings to defaults. */
const RESET_ICON = `<svg viewBox="0 0 24 24" ${SW}><rect x="9" y="9" width="6" height="6" rx="1.2"/><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
/** Gear / cog — opens a tool's custom panel (e.g. fib levels). */
const GEAR_ICON = `<svg viewBox="0 0 24 24" ${SW}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
/** Small down chevron — the affordance marking a control as a dropdown. */
const CHEVRON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
/** R² glyph — toggles the regression channel's goodness-of-fit readout. */
const R2_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><text x="2.5" y="17.5" font-size="14" font-family="serif">R²</text></svg>`;
/** Two band edges around a midline — the VWAP band σ-multiplier control glyph. */
const BANDS_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M3 6h18"/><path d="M3 18h18"/><path d="M3 12h18" stroke-dasharray="3 3"/></svg>`;
const DEDEKIND_ICON = `<svg viewBox="0 0 24 24" ${SW}><path d="M2 20h20"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="M8 20a4 4 0 0 1 8 0"/><path d="M12 4v16"/></svg>`;
const SONIC_ICON = `<svg viewBox="0 0 24 24" ${SW}><circle cx="15" cy="12" r="4"/><circle cx="12" cy="12" r="2.5"/><path d="M8 5v14"/></svg>`;
const SUPERSONIC_ICON = `<svg viewBox="0 0 24 24" ${SW}><circle cx="16" cy="12" r="3.5"/><path d="M6 12 15 6M6 12 15 18"/></svg>`;

/** A line glyph at a given width + style (for the width/style dropdown glyphs). */
function lineIcon(width: number | string, style: string | number): string {
    const dash = style === 'dashed' ? '5,3' : style === 'dotted' ? '1.5,3' : '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="3.5" y1="12" x2="20.5" y2="12" stroke-width="${Number(width) || 2}" stroke-dasharray="${dash}"/></svg>`;
}

const MAX_TEXT_LINES = 4;
/** Grow a label textarea to fit its content, up to 4 lines, then scroll (styled). */
function autoGrow(ta: HTMLTextAreaElement): void {
    ta.style.height = 'auto';
    const max = 18 * MAX_TEXT_LINES + 10 + 2; // line-height·lines + vertical padding + border
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}

/** The current glyph rendered into the icon-stamp dropdown trigger. */
function glyphIcon(glyph: string | number): string {
    return `<svg viewBox="0 0 24 24" fill="currentColor"><text x="12" y="17" font-size="15" text-anchor="middle">${glyph}</text></svg>`;
}

/** A dot that grows with the chosen stamp size — the icon-size dropdown glyph. */
function stampSizeIcon(size: string | number): string {
    const fs = (SIZE_PX[String(size)] ?? 13) + 4;
    return `<svg viewBox="0 0 24 24" fill="currentColor"><text x="12" y="17" font-size="${fs}" text-anchor="middle">●</text></svg>`;
}

/** A letter glyph (S/M/L/H) for the text-size dropdown glyph. */
function sizeIcon(size: string | number): string {
    const ch = String(size).charAt(0).toUpperCase();
    return `<svg viewBox="0 0 24 24" fill="currentColor"><text x="12" y="17" font-size="15" text-anchor="middle">${ch}</text></svg>`;
}

/** The font px each named size renders the icon glyph at — so the button visibly grows. */
const SIZE_PX: Record<string, number> = { small: 10, normal: 13, large: 16, huge: 20 };

/** A "12" glyph that grows with the chosen size — the fib level-numbers size dropdown glyph. */
function numbersSizeIcon(size: string | number): string {
    const fs = (SIZE_PX[String(size)] ?? 13) - 1;
    return `<svg viewBox="0 0 24 24" fill="currentColor"><text x="12" y="16.5" font-size="${fs}" text-anchor="middle" font-weight="600">12</text></svg>`;
}

/** A "T" glyph that grows with the chosen size — the fib level-labels size dropdown glyph. */
function labelSizeIcon(size: string | number): string {
    const fs = (SIZE_PX[String(size)] ?? 13) + 2;
    return `<svg viewBox="0 0 24 24" fill="currentColor"><text x="12" y="17" font-size="${fs}" text-anchor="middle">T</text></svg>`;
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

function withAlpha(color: string, alpha: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) {
        const n = parseInt(m[1]!, 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }
    return `rgba(148,163,184,${alpha})`;
}

