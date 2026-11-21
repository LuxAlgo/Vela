// What a page shows or announces, for the tests that check which language it reads in.

/** Every string the page shows or announces: text, accessible names, tooltips, placeholders. */
export function shownStrings(root: Element): string[] {
    const out: string[] = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (n.parentElement?.closest('style, script, svg')) continue;
        out.push(n.textContent ?? '');
    }
    for (const el of root.querySelectorAll('*')) {
        for (const attr of ['aria-label', 'title', 'placeholder']) {
            const v = el.getAttribute(attr);
            if (v) out.push(v);
        }
    }
    return out;
}
