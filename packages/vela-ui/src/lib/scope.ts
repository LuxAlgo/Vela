// Component CSS keys on `data-slot`, and a page's own components often carry the same part
// names (`select-trigger`, `popover-content`, `switch`, `button`). Each rule of a component's
// stylesheet is kept to where kit components live, so the page's elements never match it.

/** Kit hosts (`ensureUIHost`), the floating layers they portal (`vela-ui-layer`) and themed
 *  hosts (`applyTheme`), each with everything inside it. `:where()` adds no weight. */
export const KIT_SCOPE = ':where(.vela-ui, .vela-ui *, .vela-ui-layer, .vela-ui-layer *, [data-vela-theme], [data-vela-theme] *)';

// At-rules whose block holds style rules, scoped like the top level. Any other block holds
// no selectors (`@keyframes` steps, `@font-face` descriptors).
const GROUPING = /^@(?:layer|media|supports|container|scope|starting-style)\b/i;
// Pseudo-elements written with one colon: like `::x`, they close a compound.
const LEGACY_PSEUDO_ELEMENT = /^:(?:before|after|first-line|first-letter)(?![\w-])/i;
const SPACE = /\s/;

/** The index after the string, comment or escape at `i`, or `i` when none starts there. */
function skipOpaque(text: string, i: number): number {
    const c = text[i];
    if (c === '\\') return i + 2;
    if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
        return j + 1;
    }
    if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        return end < 0 ? text.length : end + 2;
    }
    return i;
}

function withoutComments(text: string): string {
    let out = '';
    for (let i = 0; i < text.length; ) {
        const next = skipOpaque(text, i);
        if (next === i) out += text[i++];
        else {
            if (text[i] !== '/') out += text.slice(i, next);
            i = next;
        }
    }
    return out;
}

/** A selector list's selectors: its commas outside brackets, parentheses and strings. */
function selectorsOf(list: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; ) {
        const next = skipOpaque(list, i);
        if (next !== i) {
            i = next;
            continue;
        }
        const c = list[i];
        if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (c === ',' && depth === 0) {
            out.push(list.slice(start, i).trim());
            start = i + 1;
        }
        i += 1;
    }
    out.push(list.slice(start).trim());
    return out;
}

/** The selector with the scope joined to its first compound, ahead of any pseudo-element. A
 *  selector the page drops (empty, or opening on a combinator) stays as it is. */
function scopeSelector(selector: string): string {
    if (!selector || /^[>+~]/.test(selector)) return selector;
    let depth = 0;
    let i = 0;
    while (i < selector.length) {
        const next = skipOpaque(selector, i);
        if (next !== i) {
            i = next;
            continue;
        }
        const c = selector[i]!;
        if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (depth === 0 && (SPACE.test(c) || c === '>' || c === '+' || c === '~')) break;
        else if (depth === 0 && c === ':' && (selector[i + 1] === ':' || LEGACY_PSEUDO_ELEMENT.test(selector.slice(i)))) break;
        i += 1;
    }
    return selector.slice(0, i) + KIT_SCOPE + selector.slice(i);
}

/**
 * A stylesheet whose top-level rules apply only where kit components live: {@link KIT_SCOPE}
 * joins the first compound of each of their selectors, so a rule weighs the same and matches
 * the same elements inside a kit host, and none outside. Rules nested in a rule follow their
 * parent; those in `@layer`, `@media`, `@supports` and `@container` blocks are scoped too.
 */
export function scopeToKit(text: string): string {
    let out = '';
    let copied = 0;
    let start = 0;
    let scoping = true;
    const outer: boolean[] = [];
    for (let i = 0; i < text.length; ) {
        const next = skipOpaque(text, i);
        if (next !== i) {
            i = next;
            continue;
        }
        const c = text[i];
        if (c === ';') {
            start = i + 1;
        } else if (c === '{') {
            const prelude = text.slice(start, i);
            const head = withoutComments(prelude).trim();
            outer.push(scoping);
            if (head.startsWith('@')) {
                scoping &&= GROUPING.test(head);
            } else {
                if (scoping && head) {
                    const lead = /^\s*/.exec(prelude)![0];
                    const trail = /\s*$/.exec(prelude)![0];
                    out += text.slice(copied, start) + lead + selectorsOf(head).map(scopeSelector).join(', ') + trail;
                    copied = i;
                }
                scoping = false;
            }
            start = i + 1;
        } else if (c === '}') {
            scoping = outer.pop() ?? true;
            start = i + 1;
        }
        i += 1;
    }
    return out + text.slice(copied);
}
