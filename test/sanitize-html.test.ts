// @vitest-environment jsdom
// The HTML allowlist behind timeline-mark popups (src/ui/sanitize-html): the pure policy
// and the DOM rebuild, proven on the hazards a host-supplied string can carry.
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, safeUrl, tagDisposition, attributeAllowed } from '../src/ui/sanitize-html';

function render(html: string): string {
    const div = document.createElement('div');
    div.appendChild(sanitizeHtml(html, document));
    return div.innerHTML;
}

describe('sanitize-html · policy', () => {
    it('classifies elements: formatting kept, active content dropped, the rest unwrapped', () => {
        expect(tagDisposition('b')).toBe('keep');
        expect(tagDisposition('TABLE')).toBe('keep');
        expect(tagDisposition('script')).toBe('drop');
        expect(tagDisposition('iframe')).toBe('drop');
        expect(tagDisposition('svg')).toBe('drop');
        expect(tagDisposition('section')).toBe('unwrap');
        expect(tagDisposition('font')).toBe('unwrap');
    });

    it('keeps only the per-element attributes, never handlers or styles', () => {
        expect(attributeAllowed('a', 'href')).toBe(true);
        expect(attributeAllowed('a', 'onclick')).toBe(false);
        expect(attributeAllowed('a', 'ONMOUSEOVER')).toBe(false);
        expect(attributeAllowed('p', 'style')).toBe(false);
        expect(attributeAllowed('p', 'title')).toBe(true);
        expect(attributeAllowed('img', 'src')).toBe(true);
        expect(attributeAllowed('img', 'srcset')).toBe(false);
        expect(attributeAllowed('td', 'colspan')).toBe(true);
        expect(attributeAllowed('div', 'class')).toBe(false);
    });

    it('rejects code and content-smuggling URL schemes, whitespace-split ones included', () => {
        expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
        expect(safeUrl('/relative/path')).toBe('/relative/path');
        expect(safeUrl('#anchor')).toBe('#anchor');
        expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
        expect(safeUrl('javascript:alert(1)')).toBeNull();
        expect(safeUrl('JavaScript:alert(1)')).toBeNull();
        expect(safeUrl('java\tscript:alert(1)')).toBeNull();
        expect(safeUrl(' \n javascript:alert(1)')).toBeNull();
        expect(safeUrl('data:text/html,hi')).toBeNull();
        expect(safeUrl('vbscript:x')).toBeNull();
    });

    it('image sources must be absolute http(s)', () => {
        expect(safeUrl('https://cdn.example.com/x.png', true)).toBe('https://cdn.example.com/x.png');
        expect(safeUrl('/x.png', true)).toBeNull();
        expect(safeUrl('data:image/png;base64,AAAA', true)).toBeNull();
    });
});

describe('sanitize-html · DOM rebuild', () => {
    it('keeps formatting and text, drops scripts with their content', () => {
        expect(render('<b>10-for-1 split</b><br>Effective <i>10 Jun</i><script>alert(1)</script>')).toBe('<b>10-for-1 split</b><br>Effective <i>10 Jun</i>');
        expect(render('<p>a<iframe src="https://x"></iframe>b</p>')).toBe('<p>ab</p>');
        expect(render('<style>body{display:none}</style>text')).toBe('text');
    });

    it('strips event handlers, inline styles and unsafe URLs, keeping the element', () => {
        expect(render('<img src="x" onerror="alert(1)">')).toBe('<img>');
        expect(render('<p style="color:red" onclick="x()" title="t">hi</p>')).toBe('<p title="t">hi</p>');
        expect(render('<a href="javascript:alert(1)">x</a>')).toBe('<a target="_blank" rel="noopener noreferrer">x</a>');
        expect(render('<img src="data:image/png;base64,AAAA" alt="a">')).toBe('<img alt="a">');
    });

    it('links open in a new context with noopener; unknown elements unwrap to their content', () => {
        expect(render('<a href="https://example.com/f">Filing</a>')).toBe('<a href="https://example.com/f" target="_blank" rel="noopener noreferrer">Filing</a>');
        expect(render('<section><font color="red">plain</font></section>')).toBe('plain');
        expect(render('<table><tr><td colspan="2" bgcolor="red">c</td></tr></table>')).toBe('<table><tbody><tr><td colspan="2">c</td></tr></tbody></table>');
    });

    it('escapes what is already text', () => {
        expect(render('1 &lt; 2 &amp; <b>ok</b>')).toBe('1 &lt; 2 &amp; <b>ok</b>');
        expect(render('<!-- comment -->x')).toBe('x');
    });
});
