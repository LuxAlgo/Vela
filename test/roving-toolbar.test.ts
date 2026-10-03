// @vitest-environment jsdom
// Roving tabindex on a bar: one Tab stop, arrows move inside and wrap, Home/End jump.
import { describe, it, expect } from 'vitest';
import { rovingToolbar, focusRegion } from '../src/ui/roving';

function bar(n: number): { el: HTMLElement; btns: HTMLButtonElement[] } {
    const el = document.createElement('div');
    const btns = Array.from({ length: n }, (_, i) => {
        const b = document.createElement('button');
        b.textContent = String(i);
        el.appendChild(b);
        return b;
    });
    document.body.appendChild(el);
    // jsdom has no layout: offsetParent is always null there, so stand in for "visible".
    for (const b of btns) Object.defineProperty(b, 'offsetParent', { value: el });
    return { el, btns };
}

const key = (el: HTMLElement, k: string): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
};

describe('rovingToolbar', () => {
    it('leaves one Tab stop and moves focus with the arrows, wrapping at the ends', () => {
        const { el, btns } = bar(3);
        const [b0, b1, b2] = btns;
        if (!b0 || !b1 || !b2) throw new Error('bar(3) built fewer than three buttons');
        const dispose = rovingToolbar(el);
        expect(el.getAttribute('role')).toBe('toolbar');
        expect(btns.map((b) => b.tabIndex)).toEqual([0, -1, -1]);

        b0.focus();
        key(b0, 'ArrowRight');
        expect(document.activeElement).toBe(b1);
        expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);

        key(b1, 'End');
        expect(document.activeElement).toBe(b2);
        key(b2, 'ArrowDown');
        expect(document.activeElement).toBe(b0);
        key(b0, 'ArrowLeft');
        expect(document.activeElement).toBe(b2);
        key(b2, 'Home');
        expect(document.activeElement).toBe(b0);

        dispose();
        key(b0, 'ArrowRight');
        expect(document.activeElement).toBe(b0);
    });

    it('drops focus on Escape, leaving keyboard navigation', () => {
        const { el, btns } = bar(2);
        rovingToolbar(el);
        const b0 = btns[0];
        if (!b0) throw new Error('bar(2) built no buttons');
        b0.focus();
        key(b0, 'Escape');
        expect(document.activeElement).toBe(document.body);
    });
});

describe('focusRegion', () => {
    it('walks the regions in order, wrapping, and enters at the first from outside', () => {
        const a = bar(2),
            b = bar(1),
            c = bar(3);
        for (const r of [a, b, c]) rovingToolbar(r.el);
        const regions = [a.el, b.el, c.el];
        expect(focusRegion(regions, null, 1)).toBe(true);
        expect(document.activeElement).toBe(a.btns[0]);
        focusRegion(regions, document.activeElement, 1);
        expect(document.activeElement).toBe(b.btns[0]);
        focusRegion(regions, document.activeElement, 1);
        expect(document.activeElement).toBe(c.btns[0]);
        focusRegion(regions, document.activeElement, 1);
        expect(document.activeElement).toBe(a.btns[0]);
        focusRegion(regions, document.activeElement, -1);
        expect(document.activeElement).toBe(c.btns[0]);
        expect(focusRegion([], null, 1)).toBe(false);
    });

    it('treats the innermost region holding the focus as the current one', () => {
        const outer = bar(1),
            inner = bar(1),
            after = bar(1);
        outer.el.appendChild(inner.el);
        for (const r of [outer, inner, after]) rovingToolbar(r.el);
        const regions = [outer.el, inner.el, after.el];
        inner.btns[0]?.focus();
        focusRegion(regions, document.activeElement, 1);
        expect(document.activeElement).toBe(after.btns[0]);
    });
});
