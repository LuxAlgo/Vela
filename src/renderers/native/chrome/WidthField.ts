// The shared line-width field — the settings dialog's counterpart to the drawings
// quick bar's width menu: a compact trigger showing the CURRENT weight as a line
// glyph, opening a floating list of the classic 1–5 px weights (line preview + px
// label per option). Same popover lifecycle as `ColorField`.
import type { VelaTheme } from '../../../core/options';
import { applyChromeTokens } from '../../shared/theme-tokens';

/** The selectable weights — the same ladder the drawings' width menu offers. */
export const WIDTH_FIELD_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];

const STYLE_ID = 'vela-width-field';

function ensureStyles(): void {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.vela-width-field{height:24px;padding:0 5px;border:1px solid var(--vela-border);border-radius:0;background:var(--vela-surface-sunken);cursor:pointer;display:inline-flex;align-items:center;gap:3px;flex:none;color:var(--vela-fg);}
.vela-width-field:hover{border-color:var(--vela-fg-muted);}
.vela-width-field-pop{position:fixed;z-index:6000;background:var(--vela-surface-overlay);border:1px solid var(--vela-border);border-radius:var(--vela-radius-lg);box-shadow:var(--vela-shadow);padding:4px;display:flex;flex-direction:column;gap:1px;color:var(--vela-fg);}
.vela-width-field-item{display:flex;align-items:center;gap:8px;min-width:96px;padding:5px 8px;border:none;border-radius:5px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;}
.vela-width-field-item:hover{background:var(--vela-hover-strong);}
.vela-width-field-item[data-active='1']{background:var(--vela-active);}
`;
    document.head.appendChild(st);
}

/** A horizontal line glyph whose stroke IS the previewed weight. */
function lineGlyph(width: number): string {
    return `<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"/></svg>`;
}

const CHEVRON = `<svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
    let left = r.right - w; // right-align to the trigger (controls sit at the row's right edge)
    let top = r.bottom + 6;
    if (left < 6) left = 6;
    if (left + w > window.innerWidth - 6) left = window.innerWidth - w - 6;
    if (top + h > window.innerHeight - 6) top = r.top - h - 6; // flip above
    if (top < 6) top = 6;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}

/** Build a width field bound to `getVal()`/`onVal(v)` — returns the trigger button. */
export function widthField(theme: VelaTheme, getVal: () => number, onVal: (v: number) => void): HTMLElement {
    ensureStyles();
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vela-width-field';

    const paint = (): void => {
        trigger.innerHTML = `<span style="display:flex;">${lineGlyph(getVal())}</span><span style="display:flex;opacity:0.55;">${CHEVRON}</span>`;
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
        pop.className = 'vela-width-field-pop';
        // The popover portals to <body>, outside the chart's token host — re-apply here.
        applyChromeTokens(pop, theme);
        pop.style.font = `var(--vela-font-size-md) ${theme.fontFamily}`;
        // Clicks inside the list must not bubble to a dialog's outside-dismiss.
        pop.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        for (const w of WIDTH_FIELD_OPTIONS) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'vela-width-field-item';
            item.dataset.active = w === getVal() ? '1' : '0';
            item.innerHTML = `<span style="display:flex;flex:none;">${lineGlyph(w)}</span><span style="flex:1;font-variant-numeric:tabular-nums;">${w}px</span>`;
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closeOpen();
                onVal(w);
                paint();
            });
            pop.appendChild(item);
        }
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

/** Close any open width popover (dialog close). */
export function closeWidthPopover(): void {
    closeOpen();
}
