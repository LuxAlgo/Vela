export const MENU_STYLE_ID = 'vela-ui-menu';

export const MENU_CSS = `
.vela-menu {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    box-shadow: var(--vela-shadow);
    padding: 6px;
    min-width: 180px;
    max-height: 60vh;
    overflow-y: auto;
    font-size: 13px;
    z-index: var(--vela-z-menu);
    outline: none;
}
.vela-menu[data-state='open'] { animation: vela-menu-in var(--vela-dur-fast) var(--vela-ease); }
@keyframes vela-menu-in {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
}
.vela-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 4px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
}
.vela-menu-item[data-highlighted] { background: var(--vela-hover); }
.vela-menu-item[data-disabled] { opacity: 0.4; cursor: default; }
.vela-menu-item .vela-icon { width: 18px; justify-content: center; color: var(--vela-fg-muted); }
.vela-menu-item .vela-menu-label { flex: 1 1 auto; }
.vela-menu-item .vela-menu-hint { color: var(--vela-fg-faint); font-size: var(--vela-font-size-sm); }
/* Active entry: accent text + right-aligned accent check (the reference menu language). */
.vela-menu-item .vela-menu-check {
    order: 99;
    margin-left: auto;
    width: 14px;
    text-align: center;
    flex: none;
    color: var(--vela-accent);
}
.vela-menu-item[data-checked] { color: var(--vela-accent); }
.vela-menu-item[data-checked] .vela-icon { color: var(--vela-accent); }
/* Switch rows (boolean settings in a dropdown): a right-aligned toggle pill — the
   same control language as the settings dialog's toggles. */
.vela-menu-switch {
    order: 99;
    margin-left: auto;
    position: relative;
    flex: none;
    width: 34px;
    height: 18px;
    border-radius: 9px;
    background: var(--vela-surface-overlay);
    border: 1px solid var(--vela-border-soft);
    transition: background 0.16s ease, border-color 0.16s ease;
}
.vela-menu-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vela-fg-muted);
    transition: transform 0.16s ease, background 0.16s ease;
}
.vela-menu-switch.on { background: var(--vela-accent-bright, var(--vela-accent)); border-color: var(--vela-accent-bright, var(--vela-accent)); }
.vela-menu-switch.on::after { transform: translateX(16px); background: var(--vela-bg); }
.vela-menu-sep { height: 1px; margin: 4px 6px; background: var(--vela-border); }
`;
