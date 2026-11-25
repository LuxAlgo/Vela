// Exit animations for the chart's chrome. A closing surface is marked `data-closing` and
// kept on screen, inert, until the CSS animations and transitions that the mark started
// have run — so a host animates closes in its own stylesheet, with no element cloning.
// Without exit CSS nothing starts and the close completes at once, as it always did.

/** The attribute a closing surface carries while its exit animation runs. */
const CLOSING_ATTR = 'data-closing';

/** The longest a close waits for its exit animation before it completes anyway. */
export const SURFACE_EXIT_CAP_MS = 1000;

/** A close held for its exit animation. */
export interface SurfaceExit {
    /** The surface reopened: unmark it and make it interactive again, without completing the close. */
    cancel(): void;
    /** Complete the close now (a teardown cannot wait for the animation). */
    finish(): void;
}

export interface SurfaceExitOptions {
    /** Elements to keep inert during the exit without marking them — a full-viewport
     *  positioner around the surface must not swallow clicks meant for the page. */
    inert?: readonly HTMLElement[];
}

function animationsOf(els: readonly HTMLElement[]): Animation[] {
    return els.flatMap((el) => el.getAnimations({ subtree: true }));
}

/** An infinite animation inside the surface (a spinner) would hold the close until the cap. */
function ends(a: Animation): boolean {
    return Number.isFinite(a.effect?.getComputedTiming().endTime ?? Number.POSITIVE_INFINITY);
}

/**
 * Close `els` (one surface, or a surface and its scrim) through their exit animation, then
 * run `done` — the caller's hide or removal. The elements get `data-closing` and turn inert;
 * `done` runs once every finite CSS animation or transition that attribute started on them
 * or their descendants has finished, or after {@link SURFACE_EXIT_CAP_MS}, whichever comes
 * first. Returns null when the close completed synchronously (no exit animation started, or
 * the DOM cannot report animations); otherwise the handle to cancel or finish the exit.
 */
export function holdForExit(els: HTMLElement | readonly HTMLElement[], done: () => void, opts: SurfaceExitOptions = {}): SurfaceExit | null {
    const list = Array.isArray(els) ? (els as readonly HTMLElement[]) : [els as HTMLElement];
    if (list.length === 0 || !list.every((el) => typeof el.getAnimations === 'function')) {
        done();
        return null;
    }
    // Reading animations flushes style: what runs now is the surface's own business (an
    // open animation still playing, a hover fading), not the exit.
    const before = new Set(animationsOf(list));
    for (const el of list) el.setAttribute(CLOSING_ATTR, '');
    const exit = animationsOf(list).filter((a) => !before.has(a) && ends(a));
    if (exit.length === 0) {
        for (const el of list) el.removeAttribute(CLOSING_ATTR);
        done();
        return null;
    }
    // Inert only now: losing hover under the pointer could start a transition of its own,
    // which must not pass for an exit animation.
    const frozen = [...list, ...(opts.inert ?? [])];
    const wasInert = frozen.map((el) => el.inert);
    for (const el of frozen) el.inert = true;

    let settled = false;
    const settle = (complete: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(cap);
        for (const el of list) el.removeAttribute(CLOSING_ATTR);
        frozen.forEach((el, i) => {
            el.inert = wasInert[i]!;
        });
        if (complete) done();
    };
    const cap = setTimeout(() => settle(true), SURFACE_EXIT_CAP_MS);
    let pending = exit.length;
    // A cancelled animation rejects `finished`; it is over all the same.
    const one = (): void => {
        if (--pending === 0) settle(true);
    };
    for (const a of exit) a.finished.then(one, one);
    return {
        cancel: () => settle(false),
        finish: () => settle(true),
    };
}
