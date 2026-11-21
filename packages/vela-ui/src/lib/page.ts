// State every copy of the kit on a page must share. A host whose dependencies resolve to two
// versions of the kit loads it twice; with module-level state each copy would keep its own
// icons, written CSS, element ids and teardowns, and the controls of one copy would miss what
// the other registered (blank icons, dropped theme CSS, colliding ids). Each entry's name ends
// in its shape version: a copy that stores something else under a name uses a new version.

const ROOT = Symbol.for('@luxalgo/vela-ui');

type Bag = Record<string, unknown>;

/** The page-wide value under `name`, created by `init` on first use. */
export function pageState<T>(name: string, init: () => T): T {
    const holder = globalThis as unknown as Record<symbol, Bag | undefined>;
    const bag = (holder[ROOT] ??= Object.create(null) as Bag);
    if (!(name in bag)) bag[name] = init();
    return bag[name] as T;
}

/** An element id no other copy of the kit hands out (Zag finds its parts by id; SVG
 *  gradients are referenced by id). */
export function pageUid(prefix: string): string {
    const counter = pageState('uid@1', () => ({ n: 0 }));
    return `${prefix}-${++counter.n}`;
}
