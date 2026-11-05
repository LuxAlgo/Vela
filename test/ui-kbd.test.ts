// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createKbd, shortcutKeys } from '@luxalgo/vela-ui/kbd';

describe('kbd', () => {
    it('draws one key as a keycap', () => {
        const { el } = createKbd({ text: 'Alt' });
        expect(el.tagName).toBe('KBD');
        expect(el.getAttribute('data-slot')).toBe('kbd');
        expect(el.textContent).toBe('Alt');
    });

    it('splits a shortcut into one keycap per key', () => {
        expect(shortcutKeys('Ctrl+Shift+K').map((k) => k.textContent)).toEqual(['Ctrl', 'Shift', 'K']);
    });
});
