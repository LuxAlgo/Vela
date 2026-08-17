export const GLYPH_SELECT_STYLE_ID = 'vela-ui-glyph-select';

export const GLYPH_SELECT_CSS = `
.vela-glyph-select {
    height: 34px;
    padding: 0 26px 0 8px;
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
    justify-self: start;
    color: var(--vela-fg-bright);
    font-size: 14px;
    font-family: inherit;
    outline: none;
    position: relative;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.vela-glyph-select:hover { border-color: var(--vela-fg-muted); }
.vela-glyph-select:focus { border-color: var(--vela-focus); box-shadow: 0 0 0 3px var(--vela-focus-soft); }
.vela-glyph-select-caret {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    opacity: 0.55;
    color: inherit;
    line-height: 0;
    pointer-events: none;
}
.vela-glyph-select-pop {
    background: var(--vela-bg);
    border: none;
    border-radius: 6px;
    box-shadow: var(--vela-shadow);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    color: var(--vela-fg);
    font: 14px var(--vela-font);
}
.vela-glyph-select-item {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 96px;
    padding: 7px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
}
.vela-glyph-select-item:hover { background: var(--vela-hover); }
.vela-glyph-select-item[data-active='1'] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
`;
