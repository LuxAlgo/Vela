export const SELECT_STYLE_ID = 'vela-ui-select-3';

export const SELECT_CSS = `
.vela-select { position: relative; display: inline-block; min-width: 0; }
.vela-select[data-fill] { width: 100%; }
/* Closed trigger matches NumberInput / TextField (100px). Long labels ellipsis;
   the open list still sizes to the longest item. */
.vela-select:not([data-fill]) { width: 100px; flex: none; justify-self: start; }
.vela-select-trigger {
    display: flex;
    align-items: center;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    height: 34px;
    padding: 0 26px 0 8px;
    background: transparent;
    border: 1px solid var(--vela-border-strong);
    border-radius: 6px;
    color: var(--vela-fg-bright);
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    outline: none;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.vela-select-trigger:hover { border-color: var(--vela-fg-muted); }
.vela-select-trigger:focus { border-color: var(--vela-focus); box-shadow: 0 0 0 3px var(--vela-focus-soft); }
.vela-select[data-size='sm'] .vela-select-trigger {
    height: 28px;
    background: var(--vela-surface-elev);
    border-radius: var(--vela-radius-sm);
    color: var(--vela-fg);
    font-size: 13px;
    box-shadow: none;
}
.vela-select[data-size='sm'] .vela-select-trigger:focus { box-shadow: none; border-color: var(--vela-fg-muted); }
.vela-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Compact toolbar selects still hug the widest option (no 100px kit column). */
.vela-select[data-size='sm']:not([data-fill]) { width: auto; max-width: 200px; }
.vela-select-sizer { visibility: hidden; height: 0; overflow: hidden; font-size: 13px; }
.vela-select-sizer span { display: block; height: 0; white-space: nowrap; padding: 0 26px 0 8px; border-inline: 1px solid transparent; }
.vela-select-chevron {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    display: flex;
    opacity: 0.55;
    line-height: 0;
    color: inherit;
}
.vela-select-chevron .vela-icon, .vela-select-chevron svg { width: 12px; height: 12px; display: block; }
.vela-select-list {
    width: max-content;
    background: var(--vela-bg);
    color: var(--vela-fg);
    border: none;
    border-radius: 6px;
    box-shadow: var(--vela-shadow);
    font: 14px var(--vela-font);
    padding: 4px;
    overflow: hidden;
}
.vela-select-list[data-size='sm'] { font-size: 13px; background: var(--vela-surface-overlay); }
.vela-select-items { width: max-content; min-width: 100%; max-height: none; overflow: hidden; }
.vela-select-list.is-scroll { display: flex; align-items: stretch; gap: 2px; }
.vela-select-list.is-scroll .vela-select-items {
    flex: 1 1 auto;
    min-width: min-content;
    max-height: 240px;
    overflow-y: auto;
    scrollbar-width: none;
}
.vela-select-list.is-scroll .vela-select-items::-webkit-scrollbar { display: none; width: 0; height: 0; }
.vela-select-rail { position: relative; flex: none; width: 3px; margin: 2px 1px 2px 0; pointer-events: none; }
.vela-select-thumb { width: 3px; border-radius: 2px; background: var(--vela-scroll); }
.vela-select-item {
    display: block;
    width: auto;
    min-width: 100%;
    white-space: nowrap;
    text-align: left;
    padding: 7px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-weight: 400;
}
.vela-select-item:hover { background: var(--vela-hover); }
.vela-select-item[data-checked] { background: var(--vela-hover-strong); color: var(--vela-fg-bright); }
.vela-select-item[data-checked]:hover { background: var(--vela-hover-strong); }
`;
