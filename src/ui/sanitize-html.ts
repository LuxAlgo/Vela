// A conservative HTML allowlist for host-supplied rich text (the timeline-mark popups).
// The policy is pure string logic (node-testable); `sanitizeHtml` applies it with the
// real DOM parser — a `<template>` parses without executing anything — and rebuilds a
// fragment from allowed elements and attributes only, so scripts, styles, frames,
// event handlers and `javascript:` URLs never reach the page. Escaping would defeat the
// point (the markup would show as source); filtering keeps the formatting and drops the
// hazards.

/** Elements kept as-is (with their allowed attributes). */
const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
    's', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]);

/** Elements dropped WITH their content — anything active, embedded, or form-shaped. */
const DROPPED_TAGS = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'textarea', 'button',
    'select', 'option', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'audio', 'video', 'canvas', 'dialog', 'head', 'title',
]);

/** Per-element attributes kept, beyond the global `title`. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
    a: new Set(['href']),
    img: new Set(['src', 'alt', 'width', 'height']),
    td: new Set(['colspan', 'rowspan']),
    th: new Set(['colspan', 'rowspan']),
    ol: new Set(['start']),
};

/** URL schemes that run code or smuggle content; a URL with any of these is dropped. */
const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'file', 'blob']);

/** Whether an element survives (kept or unwrapped) or is dropped with its content. */
export function tagDisposition(tag: string): 'keep' | 'unwrap' | 'drop' {
    const t = tag.toLowerCase();
    if (DROPPED_TAGS.has(t)) return 'drop';
    return ALLOWED_TAGS.has(t) ? 'keep' : 'unwrap';
}

/** Whether an attribute is kept on an element. Event handlers (`on*`) and `style` never are. */
export function attributeAllowed(tag: string, name: string): boolean {
    const n = name.toLowerCase();
    if (n.startsWith('on') || n === 'style') return false;
    if (n === 'title') return true;
    return ALLOWED_ATTRS[tag.toLowerCase()]?.has(n) ?? false;
}

/**
 * A URL cleared for `href`/`src`, or `null`. Scheme-less (relative, `#anchor`) URLs pass;
 * `absoluteOnly` (image sources) additionally requires `http(s):`, so a page can never
 * be made to load an inline or local resource through a mark.
 */
export function safeUrl(value: string, absoluteOnly = false): string | null {
    // Control characters and whitespace are stripped first: a scheme split by a tab or a
    // newline (`java\tscript:`) still runs once the browser normalizes it.
    let url = '';
    for (const ch of value) if (ch.charCodeAt(0) > 32) url += ch;
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    const scheme = m ? m[1]!.toLowerCase() : null;
    if (scheme !== null && BLOCKED_SCHEMES.has(scheme)) return null;
    if (absoluteOnly && scheme !== 'http' && scheme !== 'https') return null;
    return url;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Parse untrusted HTML and return a fragment carrying only the allowed subset. Links
 * open in a new browsing context with `rel="noopener noreferrer"` — a mark's link must
 * never navigate the chart's page nor reach back into it.
 */
export function sanitizeHtml(html: string, doc: Document): DocumentFragment {
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    const out = doc.createDocumentFragment();
    copyChildren(tpl.content, out, doc);
    return out;
}

function copyChildren(from: Node, to: Node, doc: Document): void {
    for (const child of Array.from(from.childNodes)) {
        if (child.nodeType === TEXT_NODE) {
            to.appendChild(doc.createTextNode(child.textContent ?? ''));
            continue;
        }
        if (child.nodeType !== ELEMENT_NODE) continue; // comments, processing instructions
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        const disposition = tagDisposition(tag);
        if (disposition === 'drop') continue;
        if (disposition === 'unwrap') {
            copyChildren(el, to, doc);
            continue;
        }
        const clean = doc.createElement(tag);
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (!attributeAllowed(tag, name)) continue;
            let value = attr.value;
            if (name === 'href' || name === 'src') {
                const safe = safeUrl(value, name === 'src');
                if (safe === null) continue;
                value = safe;
            }
            clean.setAttribute(name, value);
        }
        if (tag === 'a') {
            clean.setAttribute('target', '_blank');
            clean.setAttribute('rel', 'noopener noreferrer');
        }
        copyChildren(el, clean, doc);
        to.appendChild(clean);
    }
}
