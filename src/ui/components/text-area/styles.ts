export const TEXTAREA_STYLE_ID = 'vela-ui-textarea';

export const TEXTAREA_CSS = `
.vela-textarea { display: block; width: 100%; min-width: 0; }
.vela-textarea-field {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 64px;
    background: transparent;
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    color: var(--vela-fg-bright);
    padding: 8px;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.4;
    resize: vertical;
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
    /* Selectable even under a user-select:none host (chart wrapper, .vela-ui). */
    user-select: text;
    -webkit-user-select: text;
}
.vela-textarea-field:hover { border-color: var(--vela-fg-muted); }
.vela-textarea-field:focus { border-color: var(--vela-focus); box-shadow: 0 0 0 3px var(--vela-focus-soft); }
.vela-textarea-field::placeholder { color: currentColor; opacity: 0.4; }
.vela-textarea[data-autogrow] .vela-textarea-field { resize: none; overflow-y: hidden; min-height: 46px; }
.vela-textarea[data-size='sm'] .vela-textarea-field {
    font-size: 13px;
    min-height: 46px;
    padding: 6px 9px;
    line-height: 18px;
}
`;
