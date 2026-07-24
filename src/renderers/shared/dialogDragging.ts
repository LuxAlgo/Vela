/** Minimum px of a dialog box that must stay on-screen horizontally while dragging. */
const MIN_VISIBLE = 120;

/**
 * Reposition a centered dialog by dragging its header. The box is normally centered by
 * its flex overlay; a translate() offset is layered on top and reset whenever `reset`
 * is called (e.g. on each open).
 */
export function makeDialogDraggable(
    box: HTMLElement,
    header: HTMLElement,
    options?: { closeSelector?: string; onReset?: () => void },
): { reset: () => void } {
    const closeSelector = options?.closeSelector ?? '';
    let tx = 0;
    let ty = 0;
    let originLeft = 0;
    let originTop = 0;
    let boxW = 0;
    let startX = 0;
    let startY = 0;
    let dragging = false;

    const apply = () => { box.style.transform = tx || ty ? `translate(${tx}px, ${ty}px)` : ''; };
    const reset = () => { tx = 0; ty = 0; apply(); options?.onReset?.(); };

    header.style.cursor = 'move';
    header.style.userSelect = 'none';

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (closeSelector && (e.target as Element).closest(closeSelector))) return;
        const r = box.getBoundingClientRect();
        originLeft = r.left - tx;
        originTop = r.top - ty;
        boxW = r.width;
        startX = e.clientX;
        startY = e.clientY;
        dragging = true;
        header.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const headerH = header.offsetHeight || 40;
        let left = originLeft + (e.clientX - startX);
        left = Math.max(MIN_VISIBLE - boxW, Math.min(left, window.innerWidth - MIN_VISIBLE));
        let top = originTop + (e.clientY - startY);
        top = Math.max(0, Math.min(top, window.innerHeight - headerH));
        tx = left - originLeft;
        ty = top - originTop;
        apply();
    });
    const end = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        try { header.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);

    return { reset };
}
