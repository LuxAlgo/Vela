// The DOM vocabulary of kit components: every element a component builds goes through
// `h()`, typed by its tag. `slot` writes the `data-slot` a host styles against; class names
// are layout hooks, not part of the styling contract.

export type Child = Node | string | number | null | undefined | false | readonly Child[];

type AttrValue = string | number | boolean | null | undefined;

export interface ElementProps {
    className?: string;
    /** The part's `data-slot` (take it from the component's `defineComponent`). */
    slot?: string;
    /** `data-*` attributes (`{ icon: 'inline-start' }` → `data-icon="inline-start"`). `true`
     *  writes an empty value; `false`, `null` and `undefined` write nothing. */
    data?: Record<string, AttrValue>;
    /** Plain attributes, with the same value rules as `data`. */
    attrs?: Record<string, AttrValue>;
    style?: string;
    text?: string;
    on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (props.className) el.className = props.className;
    if (props.slot) el.setAttribute('data-slot', props.slot);
    if (props.data) for (const [k, v] of Object.entries(props.data)) setAttr(el, `data-${k}`, v);
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) setAttr(el, k, v);
    if (props.style) el.style.cssText = props.style;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.on) for (const [type, fn] of Object.entries(props.on)) el.addEventListener(type, fn as EventListener);
    append(el, children);
    return el;
}

export function append(el: Node, children: readonly Child[]): void {
    for (const c of children) {
        if (c == null || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
        else el.appendChild(c as Node);
    }
}

function setAttr(el: Element, name: string, v: AttrValue): void {
    if (v == null || v === false) el.removeAttribute(name);
    else el.setAttribute(name, v === true ? '' : String(v));
}
