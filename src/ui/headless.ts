// HEADLESS parts: what a component controller hands each of its parts — the role, ARIA
// state, tab stop and `data-*` hooks as one plain record. The vanilla views apply it with
// {@link applyProps}; another view layer spreads the same record onto its own elements
// (`aria-*`, `data-*` and `role` keep their names; `tabindex` maps to `tabIndex`).

/** Attributes for one part. `false` and `undefined` mean "absent"; `true` is the empty value. */
export type PartProps = Readonly<Record<string, string | number | boolean | undefined>>;

/** Write a part's attributes onto its element, removing the ones that turned absent. */
export function applyProps(el: Element, props: PartProps): void {
    for (const [name, value] of Object.entries(props)) {
        if (value === false || value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, value === true ? '' : String(value));
    }
}

let uid = 0;
/** A document-unique id for linking parts (`aria-controls`, `aria-labelledby`). Kept apart
 *  from the Zag helpers so a primitive never pulls a state machine into its bundle. */
export function nextPartId(prefix: string): string {
    return `${prefix}-${++uid}`;
}

/** The navigation keys a roving list answers, mapped to a move. */
export type RovingMove = 'next' | 'prev' | 'first' | 'last';

/** The move a key makes in a list laid out along `orientation` (null: not a navigation key). */
export function rovingMove(key: string, orientation: 'horizontal' | 'vertical', dir: 'ltr' | 'rtl' = 'ltr'): RovingMove | null {
    if (key === 'Home') return 'first';
    if (key === 'End') return 'last';
    if (orientation === 'vertical') return key === 'ArrowDown' ? 'next' : key === 'ArrowUp' ? 'prev' : null;
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    return key === forward ? 'next' : key === back ? 'prev' : null;
}

/** The enabled item a move lands on from `from`, wrapping around (null: nothing enabled). */
export function rovingTarget<T extends { id: string; disabled?: boolean }>(items: readonly T[], from: string | null, move: RovingMove): string | null {
    const enabled = items.filter((i) => !i.disabled);
    if (enabled.length === 0) return null;
    if (move === 'first') return enabled[0]!.id;
    if (move === 'last') return enabled[enabled.length - 1]!.id;
    const at = enabled.findIndex((i) => i.id === from);
    if (at < 0) return enabled[0]!.id;
    const step = move === 'next' ? 1 : -1;
    return enabled[(at + step + enabled.length) % enabled.length]!.id;
}
