import type { VelaTheme } from '../../../core/options';
import { DEFAULT_DRAWING_COLOR } from '../../../core/drawings';
import { ACCENT, BEARISH, BULLISH, NEUTRAL, WARNING } from '../../../core/palette';

/** Split a color into its `#RRGGBB` part + alpha 0..1 (handles `#RGB`, `#RRGGBB(AA)`, `rgba()`). */
export function splitColor(color: string): { hex6: string; alpha: number } {
    const s = String(color ?? '').trim();
    let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (m) return { hex6: `#${m[1]!.toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
        const h = m[1]!.toLowerCase();
        return { hex6: `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`, alpha: 1 };
    }
    const rgba = /^rgba?\(([^)]+)\)/i.exec(s);
    if (rgba) {
        const p = rgba[1]!.split(',').map((v) => v.trim());
        const hx = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        const a = p[3] != null ? Math.max(0, Math.min(1, parseFloat(p[3]))) : 1;
        return { hex6: `#${hx(parseInt(p[0] ?? '0', 10))}${hx(parseInt(p[1] ?? '0', 10))}${hx(parseInt(p[2] ?? '0', 10))}`, alpha: a };
    }
    return { hex6: DEFAULT_DRAWING_COLOR, alpha: 1 };
}

/** Combine a `#RRGGBB` + alpha into `#RRGGBB` (opaque) or `#RRGGBBAA`. */
export function combineColor(hex6: string, alpha: number): string {
    const a = Math.max(0, Math.min(1, alpha));
    if (a >= 0.999) return hex6;
    return `${hex6}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
}

/** Composite `fg` over `bg` at `alpha`, returning an opaque `#rrggbb` — used so an editable
 *  overlay can mimic a translucent fill while staying opaque enough to be readable. */
export function blendOver(fg: string, bg: string, alpha: number): string {
    const rgb = (c: string): [number, number, number] => {
        const n = parseInt(splitColor(c).hex6.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [fr, fgc, fb] = rgb(fg);
    const [br, bgc, bb] = rgb(bg);
    const a = Math.max(0, Math.min(1, alpha));
    const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
    return `#${h(fr * a + br * (1 - a))}${h(fgc * a + bgc * (1 - a))}${h(fb * a + bb * (1 - a))}`;
}

/** HSL (h 0-360, s/l 0-100) → `#rrggbb`. */
function hslHex(h: number, s: number, l: number): string {
    const sn = s / 100;
    const ln = l / 100;
    const k = (n: number): number => (n + h / 30) % 12;
    const a = sn * Math.min(ln, 1 - ln);
    const f = (n: number): number => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** A swatch palette: a grayscale row, then hue columns × shade rows. */
function buildPalette(): string[][] {
    const grays = [100, 90, 80, 68, 56, 45, 35, 25, 14, 0].map((l) => hslHex(0, 0, l));
    const hues = [4, 28, 50, 96, 140, 174, 200, 224, 270, 322];
    const levels: Array<[number, number]> = [
        [82, 56], // vivid
        [58, 84], // light pastel
        [62, 74],
        [66, 62],
        [70, 50],
        [64, 39],
        [54, 29], // dark
    ];
    return [grays, ...levels.map(([s, l]) => hues.map((h) => hslHex(h, s, l)))];
}

const PALETTE = buildPalette();

/** The alpha checkerboard laid under translucent colors. Its grays are fixed on purpose:
 *  it stands for "nothing here", so it must not shift with the theme. */
export function transparencyChecker(size: number): string {
    return `repeating-conic-gradient(#9aa0a6 0% 25%, #d3d6da 0% 50%) 0 0 / ${size}px ${size}px`; // palette-exempt: these grays stand for transparency itself
}

const CHECKER = transparencyChecker(10);

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
 * Emits `#RRGGBB` / `#RRGGBBAA` through `onChange`. Pure DOM, no dependency.
 */
export function buildColorPicker(color: string, theme: VelaTheme, onChange: (v: string) => void): HTMLElement {
    const parsed = splitColor(color);
    let curHex = parsed.hex6;
    let curAlpha = parsed.alpha;

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:9px;width:236px;';

    // ── swatch grid ──
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

    // ── recents + custom "+" ──
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

    // ── opacity ──
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
