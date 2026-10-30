// Segmented STYLES — options on one tinted track; the chosen one takes a stronger tint.

export const SEGMENTED_STYLE_ID = 'vela-ui-segmented';

export const SEGMENTED_CSS = `
/* The track and the chosen option are tints of the foreground, so both read on a dark and a light theme. */
.vela-segmented { display: inline-flex; align-items: stretch; gap: 2px; padding: 3px; box-sizing: border-box; height: 32px; border-radius: 8px; background: color-mix(in srgb, var(--vela-fg-bright) 6%, transparent); }
.vela-segmented[hidden] { display: none !important; }
.vela-segmented[data-size='sm'] { height: 28px; padding: 2px; border-radius: 7px; }
.vela-segmented[data-fill] { display: flex; width: 100%; }
.vela-segmented[data-fill] > .vela-segment { flex: 1 1 0; }
.vela-segment {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 0;
    padding: 0 10px; border-radius: 6px; color: var(--vela-fg-muted); font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: background var(--vela-dur-fast) ease, color var(--vela-dur-fast) ease;
}
.vela-segmented[data-size='sm'] > .vela-segment { padding: 0 8px; border-radius: 5px; font-size: 12px; }
.vela-segment .vela-icon { width: 16px; height: 16px; flex: none; }
.vela-segment[data-icon-only] { padding: 0 8px; }
.vela-segment:not([data-disabled]):hover { color: var(--vela-fg-bright); }
.vela-segment[data-state='on'] { background: color-mix(in srgb, var(--vela-fg-bright) 12%, transparent); color: var(--vela-fg-bright); }
.vela-segment[data-disabled] { cursor: default; opacity: 0.45; }
.vela-segment:focus-visible { outline: 2px solid var(--vela-focus); outline-offset: -2px; }
`;
