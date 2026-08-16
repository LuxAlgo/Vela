export const POPOVER_STYLE_ID = 'vela-ui-popover';

export const POPOVER_CSS = `
.vela-popover {
    position: fixed;
    z-index: var(--vela-z-popover);
    box-sizing: border-box;
    /* Never serve as a scroll anchor: the shell is portaled and re-placed between
       gestures, and anchoring against it jumps the scroller underneath. */
    overflow-anchor: none;
}
.vela-popover[data-position='absolute'] { position: absolute; }
.vela-popover[hidden] { display: none !important; }
`;
