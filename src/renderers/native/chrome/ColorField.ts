// The shared color-field control — the reference settings' color picker: a swatch
// trigger (alpha checkerboard under the color) opening a floating popover with the SAME
// swatch grid + recents + opacity slider the drawing tools use (`buildColorPicker`).
// Replaces the OS `input[type=color]` everywhere in the settings dialog.
import type { VelaTheme } from '../../../core/options';
import { applyChromeTokens } from '../../shared/theme-tokens';
import { buildColorPicker, transparencyChecker } from '../drawings/colorPicker';

const CHECKER = transparencyChecker(8);
const STYLE_ID = 'vela-color-field';

function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.vela-color-field{width:24px;height:24px;padding:2px;border:1px solid var(--vela-border);border-radius:0;background:var(--vela-surface-sunken);cursor:pointer;display:inline-flex;flex:none;}
.vela-color-field:hover{border-color:var(--vela-fg-muted);}
.vela-color-field-swatch{display:block;width:100%;height:100%;border-radius:0;box-shadow:inset 0 0 0 1px rgba(0,0,0,0.25);}
.vela-color-field-pop{position:fixed;z-index:6000;background:var(--vela-surface-overlay);border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);padding:10px;}
`;
    document.head.appendChild(st);
}

let openPopover: { el: HTMLElement; trigger: HTMLElement; onOutside: (e: Event) => void; reflow: () => void } | null = null;

function closeOpen(): void {
    if (!openPopover) return;
    document.removeEventListener('pointerdown', openPopover.onOutside, true);
    window.removeEventListener('resize', openPopover.reflow, true);
    openPopover.el.remove();
    openPopover = null;
}

/** Position the popover under (or above) the trigger, clamped to the viewport. */
function place(pop: HTMLElement, trigger: HTMLElement): void {
    const r = trigger.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = r.right - w; // right-align to the swatch (controls sit at the row's right edge)
    let top = r.bottom + 6;
    if (left < 6) left = 6;
    if (left + w > window.innerWidth - 6) left = window.innerWidth - w - 6;
    if (top + h > window.innerHeight - 6) top = r.top - h - 6; // flip above
    if (top < 6) top = 6;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

/** Build a color field bound to `getVal()`/`onVal(v)` — returns the trigger swatch. */
export function colorField(theme: VelaTheme, getVal: () => string, onVal: (v: string) => void): HTMLElement {
    ensureStyles();
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vela-color-field';
    const swatch = document.createElement('span');
    swatch.className = 'vela-color-field-swatch';
    trigger.appendChild(swatch);

    const paint = (): void => {
        const v = getVal();
        swatch.style.background = `linear-gradient(${v}, ${v}), ${CHECKER}`;
    };
    paint();

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openPopover && openPopover.trigger === trigger) {
            closeOpen();
            return;
        }
        closeOpen();
        const pop = document.createElement('div');
        pop.className = 'vela-color-field-pop';
        // The popover portals to <body>, outside the chart's token host — re-apply here.
        applyChromeTokens(pop, theme);
        // Clicks inside the picker must not bubble to a dialog's outside-dismiss.
        pop.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        pop.appendChild(
            buildColorPicker(getVal(), theme, (val) => {
                onVal(val);
                paint();
            }),
        );
        document.body.appendChild(pop);
        place(pop, trigger);

        const onOutside = (ev: Event): void => {
            const t = ev.target as Node;
            if (pop.contains(t) || trigger.contains(t)) return;
            closeOpen();
        };
        const reflow = (): void => place(pop, trigger);
        // Capture phase so the press is seen before other handlers stop it.
        setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
        window.addEventListener('resize', reflow, true);
        openPopover = { el: pop, trigger, onOutside, reflow };
    });
    return trigger;
}

/** Close any open color popover (dialog close). */
export function closeColorPopover(): void {
    closeOpen();
}
