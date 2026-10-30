// Tabs STYLES. `filled` is the symbol picker's market strip, `soft` the drawings drawer's
// category strip, `underline` a panel's section tabs, `nav` a vertical settings rail.

export const TABS_STYLE_ID = 'vela-ui-tabs';

export const TABS_CSS = `
.vela-tabs { display: flex; }
.vela-tabs[data-orientation='vertical'] { flex-direction: column; }
.vela-tab { all: unset; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.vela-tab[data-disabled] { cursor: default; opacity: 0.45; }
.vela-tab:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }

.vela-tab[data-variant='filled'] { padding: 3px 10px; border-radius: 5px; color: var(--vela-fg-muted); font-size: 13px; font-weight: 600; }
.vela-tab[data-variant='filled']:not([data-disabled]):hover { color: var(--vela-fg); }
.vela-tab[data-variant='filled'][data-state='active'] { background: var(--vela-selected-bg); color: var(--vela-selected-fg); }

.vela-tab[data-variant='soft'] { flex: none; min-height: 36px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--vela-fg-muted); }
.vela-tab[data-variant='soft'][data-state='active'] { color: var(--vela-fg-bright); background: var(--vela-hover); }

.vela-tabs[data-variant='underline'] { gap: 16px; border-bottom: 1px solid var(--vela-border); }
.vela-tab[data-variant='underline'] { padding-bottom: 8px; margin-bottom: -1px; border-bottom: 2px solid transparent; font-size: 14px; line-height: 20px; color: var(--vela-fg-muted); transition: color var(--vela-dur-fast) ease; }
.vela-tab[data-variant='underline']:not([data-disabled]):hover { color: var(--vela-fg-bright); }
.vela-tab[data-variant='underline'][data-state='active'] { color: var(--vela-fg-bright); border-bottom-color: var(--vela-fg-bright); }

.vela-tabs[data-variant='nav'] { gap: 2px; }
.vela-tab[data-variant='nav'] { padding: 9px 12px; border-radius: var(--vela-radius-md); color: var(--vela-fg-muted); font-size: 13px; font-weight: 600; transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease; }
.vela-tab[data-variant='nav']:not([data-disabled]):hover { background: var(--vela-hover); color: var(--vela-fg-bright); }
.vela-tab[data-variant='nav'][data-state='active'] { background: var(--vela-active); color: var(--vela-fg-bright); }
`;
