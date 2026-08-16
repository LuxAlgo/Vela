export const SWITCH_STYLE_ID = 'vela-ui-switch';

export const SWITCH_CSS = `
.vela-switch {
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--vela-border);
    border-radius: 5px;
    background: transparent;
    color: transparent;
    cursor: pointer;
    line-height: 0;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.vela-switch .vela-icon, .vela-switch svg { display: block; width: 12px; height: 12px; }
.vela-switch[data-size='sm'] .vela-icon, .vela-switch[data-size='sm'] svg { width: 11px; height: 11px; }
.vela-switch:hover { border-color: var(--vela-fg-muted); }
.vela-switch[data-checked] {
    background: var(--vela-fg-bright);
    border-color: var(--vela-fg-bright);
    color: var(--vela-bg);
}
.vela-switch[data-size='sm'] { width: 18px; height: 18px; border-color: var(--vela-border-strong); }
.vela-switch[data-size='sm']:hover { border-color: var(--vela-fg-muted); }
.vela-switch[data-size='sm'][data-checked] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
    color: var(--vela-selected-fg);
}
.vela-switch[data-tone='selected'][data-checked] {
    background: var(--vela-selected-bg);
    border-color: var(--vela-selected-bg);
    color: var(--vela-selected-fg);
}
.vela-switch[disabled] { opacity: 0.4; cursor: default; }
`;
