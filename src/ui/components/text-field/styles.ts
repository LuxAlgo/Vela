export const TEXT_STYLE_ID = 'vela-ui-text';

export const TEXT_CSS = `
.vela-text {
    display: inline-block;
    min-width: 0;
}
.vela-text[data-fill] { width: 100%; }
.vela-text-field {
    width: 100%;
    box-sizing: border-box;
    height: 34px;
    background: transparent;
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    color: var(--vela-fg-bright);
    padding: 0 8px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.vela-text-field:hover { border-color: var(--vela-fg-muted); }
.vela-text-field:focus { border-color: var(--vela-focus); box-shadow: 0 0 0 3px var(--vela-focus-soft); }
.vela-text[data-size='sm'] .vela-text-field {
    height: 28px;
    background: var(--vela-surface-elev);
    border-radius: var(--vela-radius-sm);
    color: var(--vela-fg);
    font-size: 13px;
}
`;
