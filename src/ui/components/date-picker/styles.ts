// DatePicker styles — the calendar content only; the host (a popover, a panel) owns the
// surface around it (background, border, shadow, padding).
export const DATE_PICKER_STYLE_ID = 'vela-date-picker-styles';

export const DATE_PICKER_CSS = `
.vela-date-picker{color:var(--vela-fg);font:14px var(--vela-font);user-select:none;}
.vela-date-picker [hidden]{display:none !important;}
.vela-date-picker-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;}
.vela-date-picker-title{flex:1;display:flex;align-items:center;justify-content:center;gap:2px;min-width:0;}
.vela-date-picker-switch{border:none;background:transparent;color:var(--vela-fg-bright);font:inherit;font-weight:600;font-size:14px;padding:2px 6px;border-radius:4px;cursor:pointer;}
.vela-date-picker-switch:not(:disabled):hover{background:var(--vela-hover);}
.vela-date-picker-switch:disabled{cursor:default;}
.vela-date-picker-nav{width:24px;height:24px;border:none;background:transparent;color:var(--vela-fg-muted);border-radius:4px;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:14px;}
.vela-date-picker-nav:hover{background:var(--vela-hover);color:var(--vela-fg-bright);}
.vela-date-picker-week,.vela-date-picker-grid{display:grid;grid-template-columns:repeat(7,28px);gap:2px;}
.vela-date-picker-week{margin-bottom:4px;color:var(--vela-fg-muted);font-size:11px;text-align:center;}
.vela-date-picker-week span{line-height:20px;}
.vela-date-picker-blank{width:28px;height:28px;}
.vela-date-picker-day{width:28px;height:28px;border:none;background:transparent;color:inherit;border-radius:4px;padding:0;cursor:pointer;font:inherit;font-size:14px;}
.vela-date-picker-day:hover{background:var(--vela-hover);}
.vela-date-picker-day[data-checked]{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-date-picker-day[data-today]:not([data-checked]){box-shadow:inset 0 0 0 1px var(--vela-border-strong);}
.vela-date-picker-cells{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:calc(7 * 28px + 6 * 2px);}
.vela-date-picker-cell{height:36px;border:none;background:transparent;color:inherit;border-radius:4px;padding:0 4px;cursor:pointer;font:inherit;font-size:14px;}
.vela-date-picker-cell:hover{background:var(--vela-hover);}
.vela-date-picker-cell[data-checked]{background:var(--vela-hover-strong);color:var(--vela-fg-bright);}
.vela-date-picker-cell[data-today]:not([data-checked]){box-shadow:inset 0 0 0 1px var(--vela-border-strong);}
.vela-date-picker-cell[data-outside]{opacity:0.45;}
`;
