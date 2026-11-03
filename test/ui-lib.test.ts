// @vitest-environment jsdom
// The helpers kit components are written with: h(), the css tag, the typed tokens, variants,
// and the component declaration.
import { describe, it, expect } from 'vitest';
import { css, defineComponent, h, t, tokenNames, variants } from '@luxalgo/vela-ui';
import { STATIC_TOKENS, themeTokens } from '../src/core/tokens';
import { DARK_THEME } from '../src/core/theme';

describe('t', () => {
    it('prints tokens as custom property references, groups included', () => {
        expect(`${t.radius.md}`).toBe('var(--vela-radius-md)');
        expect(`${t.fg}`).toBe('var(--vela-fg)');
        expect(`${t.fg.muted}`).toBe('var(--vela-fg-muted)');
        expect(t.space[3].name).toBe('--vela-space-3');
    });

    it('reaches exactly the tokens the theme writes', () => {
        const written = new Set([...Object.keys(STATIC_TOKENS), ...Object.keys(themeTokens(DARK_THEME))]);
        const reachable = new Set(tokenNames());
        expect([...written].filter((n) => !reachable.has(n))).toEqual([]);
        expect([...reachable].filter((n) => !written.has(n))).toEqual([]);
    });
});

describe('css', () => {
    it('joins a template, printing tokens', () => {
        expect(css`a { color: ${t.fg}; }`).toBe('a { color: var(--vela-fg); }');
    });
});

describe('variants', () => {
    const v = variants({ variant: ['solid', 'ghost'], size: ['md', 'sm'], toneKind: ['up', 'down'] });
    it('writes data attributes, defaulting to the first value of each list', () => {
        expect(v()).toEqual({ 'data-variant': 'solid', 'data-size': 'md', 'data-tone-kind': 'up' });
        expect(v({ size: 'sm' })).toEqual({ 'data-variant': 'solid', 'data-size': 'sm', 'data-tone-kind': 'up' });
        expect(v.resolve({ variant: 'ghost' })).toEqual({ variant: 'ghost', size: 'md', toneKind: 'up' });
    });
});

describe('defineComponent', () => {
    const def = defineComponent({ name: 'gauge', parts: ['root', 'needle'], settings: { radius: t.radius.lg, 'track-width': '6px' } });
    it('names the parts: the bare name for root, name-part otherwise', () => {
        expect(def.slot('root')).toBe('gauge');
        expect(def.slot('needle')).toBe('gauge-needle');
    });
    it('turns settings into custom properties with their defaults as fallbacks', () => {
        expect(def.vars.radius).toBe('var(--vela-gauge-radius, var(--vela-radius-lg))');
        expect(def.vars['track-width']).toBe('var(--vela-gauge-track-width, 6px)');
    });
});

describe('h', () => {
    it('builds an element with its slot, data, attributes, listeners and children', () => {
        let clicks = 0;
        const el = h('button', { className: 'x', slot: 'button', data: { variant: 'ghost', pressed: true, off: false }, attrs: { type: 'button' }, on: { click: () => (clicks += 1) } }, 'Go', h('span', { text: '!' }), null, ['a', 1]);
        expect(el.className).toBe('x');
        expect(el.getAttribute('data-slot')).toBe('button');
        expect(el.getAttribute('data-variant')).toBe('ghost');
        expect(el.getAttribute('data-pressed')).toBe('');
        expect(el.hasAttribute('data-off')).toBe(false);
        expect(el.type).toBe('button');
        expect(el.textContent).toBe('Go!a1');
        el.click();
        expect(clicks).toBe(1);
    });
});
