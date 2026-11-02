// HEADLESS parts for the primitives with no behavior to run (Button, Badge): what a
// controller hands its root part — the role, ARIA state and `data-*` hooks as one plain
// record. The vanilla views apply it with {@link applyProps}; another view layer spreads the
// same record onto its own elements (`aria-*`, `data-*` and `role` keep their names). The
// interactive primitives (Tabs, ToggleGroup) run Zag machines instead; see `zag.ts`.

/** Attributes for one part. `false` and `undefined` mean "absent"; `true` is the empty value. */
export type PartProps = Readonly<Record<string, string | number | boolean | undefined>>;

/** Write a part's attributes onto its element, removing the ones that turned absent. */
export function applyProps(el: Element, props: PartProps): void {
    for (const [name, value] of Object.entries(props)) {
        if (value === false || value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, value === true ? '' : String(value));
    }
}
