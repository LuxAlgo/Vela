// The shared line-width field — the settings dialog's counterpart to the drawings
// quick bar's width menu: a trigger styled like the dialog's standard selects
// showing the CURRENT weight as a line glyph, opening a floating list of the
// classic 1–5 px weights (line preview + px label per option).
import type { VelaTheme } from '../../../core/options';
import { injectStyles } from '../../../ui/styles';
import { Popover, closeOpenPopovers, openPopoverTrigger } from '../../../ui/components/popover';

/** The selectable weights — the same ladder the drawings' width menu offers. */
export const WIDTH_FIELD_OPTIONS: readonly number[] = [1, 2, 3, 4, 5];

const STYLE_ID = 'vela-width-field-2';

const WIDTH_CSS = `
.vela-width-field{height:34px;padding:0 26px 0 8px;border:1px solid var(--vela-border-strong);border-radius:6px;background:transparent;cursor:pointer;display:inline-flex;align-items:center;gap:8px;flex:none;justify-self:start;color:var(--vela-fg-bright);font-size:14px;font-family:inherit;outline:none;position:relative;transition:border-color 0.12s ease,box-shadow 0.12s ease;}
.vela-width-field:hover{border-color:var(--vela-fg-muted);}
.vela-width-field:focus{border-color:var(--vela-focus);box-shadow:0 0 0 3px var(--vela-focus-soft);}
.vela-width-field-caret{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:flex;opacity:0.55;color:inherit;line-height:0;pointer-events:none;}
.vela-width-field-pop{background:var(--vela-bg);border:none;border-radius:6px;box-shadow:var(--vela-shadow);padding:4px;display:flex;flex-direction:column;gap:1px;color:var(--vela-fg);font:14px var(--vela-font);}
.vela-width-field-item{display:flex;align-items:center;gap:8px;min-width:96px;padding:7px 10px;border:none;border-radius:4px;background:transparent;color:inherit;cursor:pointer;text-align:left;font:inherit;}
.vela-width-field-item:hover{background:var(--vela-hover);}
.vela-width-field-item[data-active='1']{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
`;

/** A horizontal line glyph whose stroke IS the previewed weight. */
function lineGlyph(width: number): string {
    return `<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><line x1="2" y1="7" x2="20" y2="7" stroke="currentColor" stroke-width="${width}" stroke-linecap="round"/></svg>`;
}

const CHEVRON = `<svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Build a width field bound to `getVal()`/`onVal(v)` — returns the trigger button. */
export function widthField(theme: VelaTheme, getVal: () => number, onVal: (v: number) => void): HTMLElement {
    injectStyles(STYLE_ID, WIDTH_CSS, document);
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'vela-width-field';

    const paint = (): void => {
        trigger.innerHTML = `<span style="display:flex;">${lineGlyph(getVal())}</span><span class="vela-width-field-caret">${CHEVRON}</span>`;
    };
    paint();

    // Suppress the default mousedown focus: when this press outside-dismisses an open
    // popover, Chrome's focus action can scroll the dialog body under the pointer.
    trigger.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        trigger.focus({ preventScroll: true });
    });
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (openPopoverTrigger() === trigger) {
            closeOpenPopovers();
            return;
        }
        const pop = new Popover({
            trigger,
            theme,
            align: 'end',
            gap: 6,
            className: 'vela-width-field-pop',
            content: (el) => {
                el.style.font = `var(--vela-font-size-md) ${theme.fontFamily}`;
                for (const w of WIDTH_FIELD_OPTIONS) {
                    const item = document.createElement('button');
                    item.type = 'button';
                    item.className = 'vela-width-field-item';
                    item.dataset.active = w === getVal() ? '1' : '0';
                    item.innerHTML = `<span style="display:flex;flex:none;">${lineGlyph(w)}</span><span style="flex:1;font-variant-numeric:tabular-nums;">${w}px</span>`;
                    item.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        pop.hide();
                        onVal(w);
                        paint();
                    });
                    el.appendChild(item);
                }
            },
        });
        pop.show();
    });
    return trigger;
}

/** Close any open width (or other kit) popover — dialog teardown. */
export function closeWidthPopover(): void {
    closeOpenPopovers();
}
