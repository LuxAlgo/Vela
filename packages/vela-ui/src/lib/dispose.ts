// Teardown that outlives an element. A control with a running state machine must be stopped,
// not only detached: some machines register page-wide listeners that keep running, and keep
// their memory, after the element is gone. Each such control ties its teardown to its root
// element, so whoever discards a subtree releases every control in it with one call, whether
// or not it kept the handles. The kit's dialog, drawer and popover do it when destroyed.
import { pageState } from './page';

const owned = pageState('teardowns@1', () => new WeakMap<Element, Set<() => void>>());

/** Tie `teardown` to `el` and return its release, which runs it once: a control's `destroy()`
 *  calls the release, and so does {@link disposeWithin} on any of its ancestors. */
export function ownTeardown(el: Element, teardown: () => void): () => void {
    let set = owned.get(el);
    if (!set) owned.set(el, (set = new Set()));
    const own = set;
    const release = (): void => {
        if (!own.delete(release)) return;
        teardown();
    };
    own.add(release);
    return release;
}

const releaseAt = (el: Element): void => {
    const set = owned.get(el);
    if (set) for (const release of [...set]) release();
};

/** Release every kit control inside `root`, `root` included. Call it on a subtree you are
 *  discarding: a dialog body you rebuild, a row you remove. A released control no longer
 *  responds, so never call it on content you will show again. */
export function disposeWithin(root: Element | DocumentFragment | null | undefined): void {
    if (!root) return;
    if (root.nodeType === 1) releaseAt(root as Element);
    for (const el of root.querySelectorAll('*')) releaseAt(el);
}
