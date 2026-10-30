// Button STYLES — the dialogs' button, generalized. `md` secondary/primary are the dialog
// footer's Cancel/OK exactly; `sm` is the compact panels' size.

export const BUTTON_STYLE_ID = 'vela-ui-button';

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
.vela-btn[data-size='sm'] { height: 30px; font-size: 13px; }
.vela-btn[data-size='xs'] { height: 26px; padding: 0 8px; font-size: 12px; border-radius: var(--vela-radius-sm); }
.vela-btn[data-has-icon] { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.vela-btn .vela-icon { width: 16px; height: 16px; flex: none; }
.vela-btn[data-icon-only] { padding: 0; width: 34px; }
.vela-btn[data-icon-only][data-size='sm'] { width: 30px; }
.vela-btn[data-icon-only][data-size='xs'] { width: 26px; }
.vela-btn:not(:disabled):hover { background: var(--vela-hover); color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-btn[data-variant='primary'] { border-color: var(--vela-selected-bg); background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-btn[data-variant='primary']:not(:disabled):hover { background: var(--vela-selected-bg); color: var(--vela-selected-fg); opacity: 0.85; border-color: var(--vela-selected-bg); }
.vela-btn[data-variant='ghost'] { border-color: transparent; color: var(--vela-fg-muted); }
.vela-btn[data-variant='ghost']:not(:disabled):hover { border-color: transparent; }
.vela-btn[data-variant='subtle'] { background: var(--vela-surface-sunken); border-color: var(--vela-border); }
.vela-btn[data-variant='subtle']:not(:disabled):hover { border-color: var(--vela-border-strong); }
.vela-btn[data-pressed] { background: var(--vela-active); color: var(--vela-fg-bright); }
.vela-btn:disabled { cursor: default; opacity: 0.5; }
.vela-btn:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: 1px; }
`;
