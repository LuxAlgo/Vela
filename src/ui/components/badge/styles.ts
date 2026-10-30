// Badge STYLES — a tinted label, or a round count.

export const BADGE_STYLE_ID = 'vela-ui-badge';

export const BADGE_CSS = `
.vela-badge {
    display: inline-flex; align-items: center; gap: 4px; box-sizing: border-box; height: 20px; padding: 0 6px; border-radius: 5px;
    font-size: 12px; font-weight: 500; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums;
    background: var(--vela-hover); color: var(--vela-fg-muted);
}
.vela-badge[hidden] { display: none !important; }
.vela-badge[data-count] { min-width: 18px; height: 18px; padding: 0 5px; justify-content: center; border-radius: 999px; font-size: 11px; }
.vela-badge[data-tone='accent'] { background: color-mix(in srgb, var(--vela-accent) 18%, transparent); color: var(--vela-accent); }
.vela-badge[data-tone='up'] { background: color-mix(in srgb, var(--vela-up) 18%, transparent); color: var(--vela-up); }
.vela-badge[data-tone='down'] { background: color-mix(in srgb, var(--vela-down) 18%, transparent); color: var(--vela-down); }
`;
