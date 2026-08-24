export const CALLOUT_STYLE_ID = 'vela-ui-callout-bubble';

export const CALLOUT_CSS = `
.vela-callout {
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    flex: none;
    line-height: 0;
    box-sizing: border-box;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
}
.vela-callout[role='button'] { cursor: pointer; }
.vela-callout svg { display: block; }
/* The deployed panel — carries the kit's elevated-card look itself (the popover
   shell is bare positioning chrome). */
.vela-callout-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    max-width: 280px;
    box-sizing: border-box;
    background: var(--vela-surface-elev);
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    box-shadow: var(--vela-shadow);
    color: var(--vela-fg);
    font: var(--vela-font-size-md) var(--vela-font);
}
.vela-callout-title { font-weight: 600; color: var(--vela-fg-bright); }
.vela-callout-text { color: var(--vela-fg-muted); line-height: 1.45; white-space: pre-line; }
.vela-callout-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.vela-callout-btn {
    cursor: pointer;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    border: 1px solid var(--vela-border);
    background: transparent;
    color: var(--vela-fg);
    font-size: var(--vela-font-size-md);
    font-family: inherit;
    transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease, opacity var(--vela-dur-fast) ease, border-color var(--vela-dur-fast) ease;
}
.vela-callout-btn:hover { background: var(--vela-hover); color: var(--vela-fg-bright); border-color: var(--vela-fg-muted); }
.vela-callout-btn-primary { border-color: var(--vela-selected-bg); background: var(--vela-selected-bg); color: var(--vela-selected-fg); }
.vela-callout-btn-primary:hover { background: var(--vela-selected-bg); color: var(--vela-selected-fg); opacity: 0.85; border-color: var(--vela-selected-bg); }
`;
