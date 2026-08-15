// Color-picker VIEW — swatch grid + recents + opacity slider, plus the field trigger.
import type { VelaTheme } from '../../../core/options';
import { ACCENT, BEARISH, BULLISH, NEUTRAL, WARNING } from '../../../core/palette';
import { injectStyles } from '../../styles';
import { Popover, closeOpenPopovers, openPopoverTrigger, type PopoverBoundary, type PopoverOptions } from '../popover';
import {
    buildPalette,
    combineColor,
    splitColor,
    transparencyChecker,
    type ColorFieldShape,
} from './controller';
import { COLOR_CSS, COLOR_STYLE_ID } from './styles';

const PALETTE = buildPalette();
const CHECKER = transparencyChecker(10);
const FIELD_CHECKER = transparencyChecker(8);

/** Session-shared recently-picked colors (most-recent first). */
const recents: string[] = [ACCENT, BULLISH, BEARISH, WARNING, NEUTRAL];

function addRecent(hex6: string): void {
    const i = recents.findIndex((c) => c.toLowerCase() === hex6.toLowerCase());
    if (i >= 0) recents.splice(i, 1);
    recents.unshift(hex6);
    if (recents.length > 10) recents.length = 10;
}

/**
 * A self-contained color picker: a swatch grid (grays + hue × shade), a
 * recents row with a custom "+" picker, and an opacity slider over a transparency checker.
 * Emits `#RRGGBB` / `#RRGGBBAA` through `onChange`.
 */
export function buildColorPicker(color: string, theme: VelaTheme, onChange: (v: string) => void): HTMLElement {
    const parsed = splitColor(color);
    let curHex = parsed.hex6;
    let curAlpha = parsed.alpha;

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:9px;width:236px;';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(10,1fr);gap:4px;';
    const swatches: HTMLButtonElement[] = [];
    for (const row of PALETTE) {
        for (const c of row) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.dataset.c = c;
            sw.style.cssText = `width:100%;aspect-ratio:1;border-radius:4px;border:none;cursor:pointer;background:${c};padding:0;`;
            sw.addEventListener('click', (e) => {
                e.stopPropagation();
                pickHex(c);
            });
            grid.appendChild(sw);
            swatches.push(sw);
        }
    }
    const paintSelection = (): void => {
        for (const sw of swatches) {
            const on = (sw.dataset.c ?? '').toLowerCase() === curHex.toLowerCase();
            sw.style.outline = on ? `2px solid ${theme.textColor}` : 'none';
            sw.style.outlineOffset = '2px';
            sw.style.zIndex = on ? '1' : '';
            sw.style.position = on ? 'relative' : '';
        }
    };

    const recentRow = document.createElement('div');
    recentRow.style.cssText = 'display:flex;align-items:center;gap:5px;flex-wrap:wrap;border-top:1px solid var(--vela-border);padding-top:9px;';
    const renderRecents = (): void => {
        recentRow.replaceChildren();
        for (const c of recents) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.style.cssText = `width:17px;height:17px;border-radius:var(--vela-radius-sm);border:1px solid var(--vela-border);cursor:pointer;background:${c};padding:0;`;
            sw.addEventListener('click', (e) => {
                e.stopPropagation();
                pickHex(c);
            });
            recentRow.appendChild(sw);
        }
        const add = document.createElement('label');
        add.style.cssText = `width:17px;height:17px;border-radius:var(--vela-radius-sm);border:1px dashed var(--vela-border-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;color:${theme.textColor};font:14px ${theme.fontFamily};position:relative;`;
        add.textContent = '+';
        const input = document.createElement('input');
        input.type = 'color';
        input.value = curHex;
        input.style.cssText = 'position:absolute;inset:0;opacity:0;cursor:pointer;';
        input.addEventListener('input', () => pickHex(input.value, true));
        add.appendChild(input);
        recentRow.appendChild(add);
    };

    const opLabel = document.createElement('div');
    opLabel.textContent = 'Opacity';
    opLabel.style.cssText = `font:11px ${theme.fontFamily};color:var(--vela-fg-muted);`;
    const opRow = document.createElement('div');
    opRow.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const track = document.createElement('div');
    track.style.cssText = 'flex:1;position:relative;height:13px;border-radius:7px;cursor:pointer;';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;top:50%;width:15px;height:15px;border-radius:50%;background:var(--vela-selected-bg);box-shadow:0 1px 3px rgba(0,0,0,0.55);transform:translate(-50%,-50%);pointer-events:none;';
    track.appendChild(knob);
    const pctBox = document.createElement('div');
    pctBox.style.cssText = `min-width:42px;text-align:center;font:var(--vela-font-size-md) ${theme.fontFamily};color:var(--vela-fg);border:1px solid var(--vela-border);border-radius:5px;padding:3px 4px;`;
    opRow.append(track, pctBox);
    const paintOpacity = (): void => {
        track.style.background = `linear-gradient(to right, ${curHex}00, ${curHex}ff), ${CHECKER}`;
        knob.style.left = `${curAlpha * 100}%`;
        pctBox.textContent = `${Math.round(curAlpha * 100)}%`;
    };
    let dragging = false;
    const onDrag = (clientX: number): void => {
        const r = track.getBoundingClientRect();
        curAlpha = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
        paintOpacity();
        emit();
    };
    track.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        dragging = true;
        track.setPointerCapture(e.pointerId);
        onDrag(e.clientX);
    });
    track.addEventListener('pointermove', (e) => {
        if (dragging) onDrag(e.clientX);
    });
    track.addEventListener('pointerup', () => (dragging = false));

    function emit(): void {
        onChange(combineColor(curHex, curAlpha));
    }
    function pickHex(hex: string, custom = false): void {
        curHex = splitColor(hex).hex6;
        addRecent(curHex);
        paintSelection();
        paintOpacity();
        if (custom) renderRecents();
        emit();
    }

    renderRecents();
    paintSelection();
    paintOpacity();
    root.append(grid, recentRow, opLabel, opRow);
    return root;
}

export interface ColorFieldOpts {
    shape?: ColorFieldShape;
    theme: VelaTheme;
    getVal: () => string;
    onVal: (v: string) => void;
    id?: string;
    popover?: Pick<PopoverOptions, 'host' | 'position' | 'boundary' | 'zIndex' | 'gap' | 'align'>;
}

/** Closed-state swatch shape. `square` is the chart-settings field; `circle` is the
 *  indicator-dialog preview — a square chip inset from a matching square field border. */
export function colorField(theme: VelaTheme, getVal: () => string, onVal: (v: string) => void, opts?: { shape?: ColorFieldShape; id?: string; popover?: ColorFieldOpts['popover'] }): HTMLElement {
    return new ColorField({ theme, getVal, onVal, shape: opts?.shape, id: opts?.id, popover: opts?.popover }).el;
}

export class ColorField {
    readonly el: HTMLButtonElement;
    private readonly swatch: HTMLElement;
    private readonly getVal: () => string;
    private readonly onVal: (v: string) => void;
    private readonly theme: VelaTheme;
    private readonly popoverOpts: ColorFieldOpts['popover'];

    constructor(opts: ColorFieldOpts) {
        injectStyles(COLOR_STYLE_ID, COLOR_CSS, document);
        this.theme = opts.theme;
        this.getVal = opts.getVal;
        this.onVal = opts.onVal;
        this.popoverOpts = opts.popover;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        if (opts.id) trigger.id = opts.id;
        trigger.className = opts.shape === 'circle' ? 'vela-color-field vela-color-field-circle' : 'vela-color-field';
        const swatch = document.createElement('span');
        swatch.className = 'vela-color-field-swatch';
        trigger.appendChild(swatch);
        this.el = trigger;
        this.swatch = swatch;
        this.paint();
        trigger.addEventListener('vela-sync', () => this.paint());
        // Suppress the default mousedown focus: when this press outside-dismisses an open
        // popover, Chrome's focus action can scroll the dialog body under the pointer.
        trigger.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            trigger.focus({ preventScroll: true });
        });
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
    }

    private paint(): void {
        const v = this.getVal();
        this.swatch.style.background = `linear-gradient(${v}, ${v}), ${FIELD_CHECKER}`;
    }

    private toggle(): void {
        if (openPopoverTrigger() === this.el) {
            closeOpenPopovers();
            return;
        }
        const pop = new Popover({
            trigger: this.el,
            theme: this.theme,
            align: this.popoverOpts?.align ?? 'end',
            gap: this.popoverOpts?.gap ?? 6,
            host: this.popoverOpts?.host,
            position: this.popoverOpts?.position,
            boundary: this.popoverOpts?.boundary as PopoverBoundary | undefined,
            zIndex: this.popoverOpts?.zIndex,
            className: 'vela-color-field-pop',
            content: buildColorPicker(this.getVal(), this.theme, (val) => {
                this.onVal(val);
                this.paint();
            }),
        });
        pop.show();
    }
}

/** Close any open color (or other kit) popover — dialog teardown. */
export function closeColorPopover(): void {
    closeOpenPopovers();
}
