// Button STYLES — the dialogs' button, generalized. `outline` and `default` at the
// `default` size are the dialog footer's Cancel and OK exactly; `sm` is the compact
// panels' size.

export const BUTTON_STYLE_ID = 'vela-ui-button';

const HOVER = 'background: var(--vela-hover); color: var(--vela-fg-bright); border-color: var(--vela-fg-muted);';

export const BUTTON_CSS = `
.vela-btn {
    cursor: pointer;
    height: 34px;
    padding: 0 11px;
    border-radius: 6px;
    border: 1px solid var(--vela-border-strong);
    background: transparent;
    color: var(--vela-fg);
    font-weight: 400;
    font-size: 14px;
    font-family: inherit;
    transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease, opacity var(--vela-dur-fast) ease, border-color var(--vela-dur-fast) ease;
}
.vela-btn[hidden] { display: none !important; }
.vela-btn:has(> [data-icon]) { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.vela-btn > [data-icon] { width: 16px; height: 16px; flex: none; }
.vela-btn[data-size='sm'], .vela-btn[data-size='icon-sm'] { height: 30px; font-size: 13px; }
.vela-btn[data-size='xs'], .vela-btn[data-size='icon-xs'] { height: 26px; padding: 0 8px; font-size: 12px; border-radius: var(--vela-radius-sm); }
.vela-btn[data-size='lg'], .vela-btn[data-size='icon-lg'] { height: 40px; padding: 0 14px; }
.vela-btn[data-size='icon'] { width: 34px; padding: 0; }
.vela-btn[data-size='icon-sm'] { width: 30px; padding: 0; }
.vela-btn[data-size='icon-xs'] { width: 26px; padding: 0; }
.vela-btn[data-size='icon-lg'] { width: 40px; padding: 0; }
.vela-btn:not(:disabled):hover, .vela-btn[aria-expanded='true'] { ${HOVER} }
.vela-btn[data-variant='default'] { border-color: var(--vela-selected-bg); background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-btn[data-variant='default']:not(:disabled):hover, .vela-btn[data-variant='default'][aria-expanded='true'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); opacity: 0.85; border-color: var(--vela-selected-bg); }
.vela-btn[data-variant='secondary'] { background: var(--vela-surface-sunken); border-color: var(--vela-border); }
.vela-btn[data-variant='secondary']:not(:disabled):hover, .vela-btn[data-variant='secondary'][aria-expanded='true'] { border-color: var(--vela-border-strong); }
.vela-btn[data-variant='ghost'] { border-color: transparent; color: var(--vela-fg-muted); }
.vela-btn[data-variant='ghost']:not(:disabled):hover, .vela-btn[data-variant='ghost'][aria-expanded='true'] { border-color: transparent; }
.vela-btn[data-variant='destructive'] { border-color: transparent; background: color-mix(in srgb, var(--vela-danger) 14%, transparent); color: var(--vela-danger); }
.vela-btn[data-variant='destructive']:not(:disabled):hover { border-color: transparent; background: color-mix(in srgb, var(--vela-danger) 24%, transparent); color: var(--vela-danger); }
.vela-btn[data-variant='link'] { border-color: transparent; background: transparent; color: var(--vela-accent); padding-left: 0; padding-right: 0; text-underline-offset: 4px; }
.vela-btn[data-variant='link']:not(:disabled):hover { border-color: transparent; background: transparent; color: var(--vela-accent); text-decoration: underline; }
.vela-btn[data-pressed] { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-btn:disabled { cursor: default; opacity: 0.5; }
.vela-btn:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }
`;
