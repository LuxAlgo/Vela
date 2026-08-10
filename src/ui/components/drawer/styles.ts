export const DRAWER_STYLE_ID = 'vela-ui-drawer';

export const DRAWER_CSS = `
.vela-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: var(--vela-backdrop);
    z-index: var(--vela-z-dialog);
}
.vela-drawer-positioner {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: var(--vela-z-dialog);
}
/* Inside a shell that declares a size class, the sheet scopes to the SHELL's bounds
   (the widget root is position:relative) instead of the whole viewport — an embedded
   chart must not curtain the host page. */
[data-layout] .vela-drawer-backdrop, [data-layout] .vela-drawer-positioner { position: absolute; }
.vela-drawer {
    background: var(--vela-surface);
    color: var(--vela-fg);
    border: 1px solid var(--vela-border-strong);
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    box-shadow: var(--vela-shadow-dialog);
    font-size: 13px;
    width: 100%;
    max-height: 85%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
}
.vela-drawer[data-state='open'] { animation: vela-drawer-in var(--vela-dur-med) var(--vela-ease); }
@keyframes vela-drawer-in {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}
/* The grab zone owns its touches (drag-to-dismiss), so the browser must not scroll it. */
.vela-drawer-grab {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 0 6px;
    cursor: grab;
    touch-action: none;
    user-select: none;
}
.vela-drawer-grab::before {
    content: '';
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--vela-border-strong);
}
.vela-drawer-title {
    flex: none;
    padding: 0 16px 10px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--vela-fg-bright);
    user-select: none;
}
.vela-drawer-title:empty { display: none; }
.vela-drawer-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0 var(--vela-space-3) calc(var(--vela-space-3) + env(safe-area-inset-bottom, 0px));
}
.vela-drawer-body::-webkit-scrollbar { width: 8px; }
.vela-drawer-body::-webkit-scrollbar-thumb {
    background: var(--vela-scroll);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
}
`;
