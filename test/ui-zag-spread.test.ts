// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { spreadProps } from '@luxalgo/vela-ui/zag';

describe('spreadProps', () => {
    it('leaves alone the styles a part does not set, such as the z-index the popper writes', () => {
        const el = document.createElement('div');
        spreadProps(el, { style: { position: 'absolute', zIndex: undefined } }, 'm');
        el.style.setProperty('z-index', 'var(--z-index)');
        spreadProps(el, { style: { position: 'absolute', zIndex: undefined, top: '0px' } }, 'm');
        expect(el.style.getPropertyValue('z-index')).toBe('var(--z-index)');
        expect(el.style.top).toBe('0px');
    });

    it('still removes a style the part set and then dropped', () => {
        const el = document.createElement('div');
        spreadProps(el, { style: { position: 'absolute', visibility: 'hidden' } }, 'm');
        expect(el.style.visibility).toBe('hidden');
        spreadProps(el, { style: { position: 'absolute', visibility: undefined } }, 'm');
        expect(el.style.visibility).toBe('');
        expect(el.style.position).toBe('absolute');
    });
});
