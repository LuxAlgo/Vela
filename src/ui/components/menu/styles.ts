export const MENU_STYLE_ID = 'vela-ui-menu';

export const MENU_CSS = `
.vela-menu {
    /* The list is a <ul>: without this, block rows (the separator) paint a ::marker dot. */
    list-style: none;
    margin: 0;
    background: var(--vela-surface-elev);
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
.vela-menu-item .vela-icon { width: 16px; height: 16px; font-size: 16px; justify-content: center; color: var(--vela-fg-muted); }
.vela-menu-item .vela-menu-label { flex: 1 1 auto; }
.vela-menu-item .vela-menu-hint { color: var(--vela-fg-faint); font-size: var(--vela-font-size-sm); }
/* Active entry: the row surface carries the selection — a stronger background wash
   than the hover one, plus bright ink. Declared after the hover rule so a selected
   row stays visibly selected while highlighted. */
.vela-menu-item[data-checked] {
    background: var(--vela-hover-strong);
    color: var(--vela-fg-bright);
}
/* Checkmark mode (context/action menus): every row reserves the leading mark column so
   labels align; a checked row fills it with a ✓ and brightens its ink — the row surface
   stays free for the hover wash. */
.vela-menu-item .vela-menu-mark {
    width: 14px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.vela-menu-item .vela-menu-mark .vela-icon {
    width: 14px;
    height: 14px;
    font-size: 14px;
    color: var(--vela-fg-bright);
}
.vela-menu-item[data-checkmark] { color: var(--vela-fg-bright); }
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
/* Favorite star (rows carrying \`favorite\`): reserved space always — it fades in on row
   hover instead of shifting the layout — and a starred row keeps its filled star visible.
   Same control language as the drawing toolbar's flyout stars. */
.vela-menu-item .vela-menu-star {
    order: 98;
    /* Pad the 16px icon slot into a bigger hit target without moving the row's layout. */
    margin: -3px -5px -3px 0;
    padding: 3px 5px;
    box-sizing: content-box;
    border-radius: var(--vela-radius-sm);
    opacity: 0;
    transition: opacity 0.1s ease, background 0.1s ease;
}
.vela-menu-item[data-highlighted] .vela-menu-star { opacity: 0.55; }
.vela-menu-item .vela-menu-star:hover { opacity: 1; background: var(--vela-hover-strong); }
.vela-menu-item .vela-menu-star.vela-fav { opacity: 0.95; color: var(--vela-highlight); }
.vela-menu-sep { height: 1px; margin: 4px 6px; background: var(--vela-border); }
/* Submenu trigger row: a right-aligned chevron, and it stays highlighted while its own
   list is open so the path you came down remains readable. */
.vela-menu-item .vela-menu-arrow {
    order: 99;
    margin-left: auto;
    width: 12px;
    flex: none;
    font-size: 11px;
    color: var(--vela-fg-faint);
}
.vela-menu-item[data-state='open'] { background: var(--vela-hover); }
`;
