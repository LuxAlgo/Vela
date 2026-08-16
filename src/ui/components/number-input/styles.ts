export const NUMBER_STYLE_ID = 'vela-ui-number-3';

export const NUMBER_CSS = `
.vela-num { position: relative; display: inline-block; min-width: 0; }
.vela-num[data-fill] { width: 100%; }
.vela-num:not([data-fill]) { width: 100px; flex: none; justify-self: start; }
.vela-num:not([data-fill])[data-compact] { width: 80px; }
.vela-num input {
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
    -moz-appearance: textfield;
    appearance: textfield;
}
.vela-num input::-webkit-inner-spin-button, .vela-num input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.vela-num input:hover { border-color: var(--vela-fg-muted); }
.vela-num input:focus { border-color: var(--vela-focus); box-shadow: 0 0 0 3px var(--vela-focus-soft); }
/* The stepper gutter exists only while the steppers do (hover) — an idle field keeps
   its full width so long values aren't cut under an invisible arrow column. */
.vela-num[data-steppers]:hover input { padding-right: 26px; }
.vela-num[data-size='sm'] { width: 64px; flex: none; }
.vela-num[data-size='sm'][data-compact] { width: 56px; }
.vela-num[data-size='sm'] input {
    height: 28px;
    background: var(--vela-surface-elev);
    border-radius: var(--vela-radius-sm);
    color: var(--vela-fg);
    font-size: 13px;
    box-shadow: none;
}
.vela-num[data-size='sm'] input:focus { box-shadow: none; }
.vela-num-step {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 22px;
    display: none;
    flex-direction: column;
    justify-content: center;
    box-sizing: border-box;
    padding: 2px 6px 2px 0;
    line-height: 0;
}
.vela-num[data-steppers]:hover .vela-num-step { display: flex; }
.vela-num-step button {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: none;
    background: transparent;
    color: var(--vela-fg-muted);
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}
.vela-num-step button:hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-num-step .vela-icon, .vela-num-step svg { width: 12px; height: 12px; display: block; }
`;
