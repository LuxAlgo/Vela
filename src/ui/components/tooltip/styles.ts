export const TOOLTIP_STYLE_ID = 'vela-ui-tooltip';

export const TOOLTIP_CSS = `
.vela-tooltip {
    background: var(--vela-bg);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-soft);
    border-radius: var(--vela-radius-md);
    box-shadow: var(--vela-shadow);
    font-size: var(--vela-font-size-md);
    line-height: 1.4;
    padding: var(--vela-space-1) var(--vela-space-2);
    max-width: 280px;
    pointer-events: none;
    z-index: var(--vela-z-tooltip);
}
.vela-tooltip[data-interactive] { pointer-events: auto; }
.vela-tooltip[data-state='open'] { animation: vela-tooltip-in 0.12s ease; }
/* Title over a muted description line — the same values the renderer's chrome tooltips write inline. */
.vela-tooltip-title { font-weight: 600; }
.vela-tooltip-desc {
    margin-top: 2px;
    width: max-content;
    max-width: 260px;
    white-space: normal;
    color: var(--vela-fg-muted);
    font-size: var(--vela-font-size-sm);
    line-height: 1.35;
}
@keyframes vela-tooltip-in {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
}
`;
