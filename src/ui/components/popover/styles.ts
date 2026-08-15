export const POPOVER_STYLE_ID = 'vela-ui-popover';

export const POPOVER_CSS = `
.vela-popover {
    position: fixed;
    z-index: var(--vela-z-popover);
    box-sizing: border-box;
}
.vela-popover[data-position='absolute'] { position: absolute; }
.vela-popover[hidden] { display: none !important; }
`;
