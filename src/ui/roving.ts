// Roving tabindex for a bar of buttons (the ARIA toolbar pattern): the bar is ONE Tab
// stop, the arrow keys move between its buttons, Home/End jump to the ends. Only the
// current button carries tabindex 0; the rest sit at -1 so Tab leaves the bar.

/** Make `bar` a toolbar for keyboard users. Returns a disposer. */
export function rovingToolbar(bar: HTMLElement, selector = 'button'): () => void {
    const items = (): HTMLElement[] =>
        Array.from(bar.querySelectorAll<HTMLElement>(selector)).filter((b) => !(b as HTMLButtonElement).disabled && b.offsetParent !== null);
    // One tabindex-0 button: the one just focused, else the one that already had it, else the first.
    const settle = (current?: HTMLElement | null): void => {
        const list = items();
        const keep = (current && list.includes(current) ? current : list.find((b) => b.tabIndex === 0)) ?? list[0];
        for (const b of list) b.tabIndex = b === keep ? 0 : -1;
    };
    const onFocusIn = (ev: FocusEvent): void => settle(ev.target as HTMLElement);
    const onKey = (ev: KeyboardEvent): void => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const list = items();
        const idx = list.indexOf(ev.target as HTMLElement);
        if (idx < 0 || list.length === 0) return;
        let next: number;
        switch (ev.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                next = (idx + 1) % list.length;
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                next = (idx - 1 + list.length) % list.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = list.length - 1;
                break;
            case 'Escape':
                // Leave keyboard navigation: nothing focused, like closing a menu.
                (ev.target as HTMLElement).blur();
                return;
            default:
                return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        list[next]?.focus();
    };
    bar.setAttribute('role', 'toolbar');
    bar.addEventListener('focusin', onFocusIn);
    bar.addEventListener('keydown', onKey);
    // Bars rebuild their buttons (layout change, panel toggles): re-settle after any churn.
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => settle());
    mo?.observe(bar, { childList: true, subtree: true });
    settle();
    return () => {
        mo?.disconnect();
        bar.removeEventListener('focusin', onFocusIn);
        bar.removeEventListener('keydown', onKey);
    };
}

/**
 * Move focus to the next (`dir` 1) or previous (-1) region after the one holding `from`,
 * wrapping at the ends; from outside every region, the first (or last) one. A region's
 * head is its roving tabindex-0 element, else its first button or link, else itself.
 * Returns false when there was nothing to focus.
 */
export function focusRegion(regions: HTMLElement[], from: Element | null, dir: 1 | -1): boolean {
    if (regions.length === 0) return false;
    const idx = from ? regions.findIndex((r) => r.contains(from)) : -1;
    const start = idx < 0 ? (dir === 1 ? 0 : regions.length - 1) : (idx + dir + regions.length) % regions.length;
    const region = regions[start];
    if (!region) return false;
    const head = region.querySelector<HTMLElement>('[tabindex="0"], button, a[href]') ?? region;
    head.focus({ preventScroll: true });
    return true;
}
