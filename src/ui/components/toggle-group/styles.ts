// ToggleGroup STYLES — options on one tinted track; an option that is on takes a stronger tint.

export const TOGGLE_GROUP_STYLE_ID = 'vela-ui-toggle-group';

/* The track and the on state are tints of the foreground, so both read on a dark and a light theme. */
export const TOGGLE_GROUP_CSS = `
.vela-toggle-group { display: inline-flex; align-items: stretch; gap: 2px; padding: 3px; box-sizing: border-box; height: 32px; border-radius: 8px; background: color-mix(in srgb, var(--vela-fg-bright) 6%, transparent); }
.vela-toggle-group[hidden] { display: none !important; }
.vela-toggle-group[data-size='sm'] { height: 28px; padding: 2px; border-radius: 7px; }
.vela-toggle-group[data-fill] { display: flex; width: 100%; }
.vela-toggle-group[data-fill] > .vela-toggle-group-item { flex: 1 1 0; }
.vela-toggle-group-item {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0;
    padding: 0 10px; border-radius: 6px; color: var(--vela-fg-muted); font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease;
}
.vela-toggle-group[data-size='sm'] > .vela-toggle-group-item { padding: 0 8px; border-radius: 5px; font-size: 12px; }
.vela-toggle-group-item .vela-icon { width: 16px; height: 16px; flex: none; }
.vela-toggle-group-item[data-icon-only] { padding: 0 8px; }
.vela-toggle-group-item[data-state='off']:not([data-disabled]):hover { color: var(--vela-fg-bright); }
.vela-toggle-group-item[data-state='on'] { background: color-mix(in srgb, var(--vela-fg-bright) 12%, transparent); color: var(--vela-fg-bright); }
.vela-toggle-group-item[data-disabled] { cursor: default; opacity: 0.45; }
.vela-toggle-group-item:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
`;
