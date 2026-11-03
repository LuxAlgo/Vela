// @vitest-environment jsdom
// Themes: createTheme builds every token from a few choices, applyTheme writes it once per
// document in the theme layer, and Vela takes a theme by value or by registered id.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, checkTheme, createTheme, DARK_CHART, LIGHT_CHART, themeCss, TOKEN_NAMES } from '@luxalgo/vela-ui/theme';
import { STATIC_TOKENS, themeTokens } from '../src/core/tokens';
import { DARK_THEME, LIGHT_THEME, registeredThemeIdOf, registeredThemes, registerTheme, resolveTheme } from '../src/core/theme';

const themeSheets = () => [...document.head.querySelectorAll('style')].filter((s) => s.id.startsWith('vela-theme-'));

afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
});

describe('createTheme', () => {
    it('gives exactly the built-in tokens for dark and light', () => {
        expect(createTheme().tokens).toEqual({ ...STATIC_TOKENS, ...themeTokens(DARK_THEME) });
        expect(createTheme({ base: 'light' }).tokens).toEqual({ ...STATIC_TOKENS, ...themeTokens(LIGHT_THEME) });
        expect(createTheme({ base: 'light' }).chart).toEqual(LIGHT_THEME);
        expect(createTheme().settings).toEqual({});
    });

    it('names every token it writes', () => {
        expect(Object.keys(createTheme().tokens).sort()).toEqual(TOKEN_NAMES.map((n) => `--vela-${n}`).sort());
    });

    it('derives its id from its values', () => {
        expect(createTheme().id).toBe(createTheme({ base: 'dark' }).id);
        expect(createTheme().id).toBe(createTheme({ base: { ...DARK_CHART } }).id);
        expect(createTheme().id).not.toBe(createTheme({ base: 'light' }).id);
        expect(createTheme().id).not.toBe(createTheme({ components: { button: { radius: '2px' } } }).id);
    });

    it('scales every radius', () => {
        expect(createTheme({ radius: 'none' }).tokens['--vela-radius-md']).toBe('0px');
        const lg = createTheme({ radius: 'lg' }).tokens;
        expect(parseFloat(lg['--vela-radius-md']!)).toBe(Math.round(parseFloat(STATIC_TOKENS['--vela-radius-md']!) * 1.5));
        expect(parseFloat(lg['--vela-radius-lg']!)).toBeGreaterThan(parseFloat(STATIC_TOKENS['--vela-radius-lg']!));
    });

    it('sets the accent with the ink that contrasts more on it', () => {
        const navy = createTheme({ accent: '#0a3d91' }).tokens;
        expect(navy['--vela-accent']).toBe('#0a3d91');
        expect(navy['--vela-accent-bright']).toBe('#0a3d91');
        expect(navy['--vela-fg-on-fill']).toBe('#ffffff');
        expect(createTheme({ accent: '#f5d90a' }).tokens['--vela-fg-on-fill']).toBe('#000000');
        // Pink reads at 4.8:1 with black ink and 4.4:1 with white.
        expect(createTheme({ accent: '#e91e63' }).tokens['--vela-fg-on-fill']).toBe('#000000');
    });

    it('builds a whole theme from colors alone', () => {
        const paper = createTheme({ colors: { background: '#fdf6e3' } });
        expect(paper.chart.textColor).toBe(LIGHT_CHART.textColor);
        expect(paper.chart.gridColor).not.toBe(DARK_CHART.gridColor);
        expect(paper.tokens['--vela-bg']).toBe('#fdf6e3');
        const night = createTheme({ base: 'light', colors: { background: '#000814', up: '#00b4d8', accent: '#7c3aed' } });
        expect(night.chart.textColor).toBe(DARK_CHART.textColor);
        expect(night.chart.upColor).toBe('#00b4d8');
        expect(night.chart.downColor).toBe(LIGHT_CHART.downColor);
        expect(night.settings).toEqual({ accent: '#7c3aed' });
    });

    it('takes any token by name and typed component settings', () => {
        const theme = createTheme({ font: 'Inter, sans-serif', tokens: { 'dur-fast': '0ms' }, components: { button: { radius: '2px' }, tabs: { 'track-radius': '4px' } } });
        expect(theme.tokens['--vela-font']).toBe('Inter, sans-serif');
        expect(theme.chart.fontFamily).toBe('Inter, sans-serif');
        expect(theme.tokens['--vela-dur-fast']).toBe('0ms');
        expect(themeCss(theme)).toContain('--vela-button-radius: 2px;');
        expect(themeCss(theme)).toContain('--vela-tabs-track-radius: 4px;');
        // @ts-expect-error -- a setting the button does not declare
        createTheme({ components: { button: { 'track-radius': '4px' } } });
        // @ts-expect-error -- a component that does not exist
        createTheme({ components: { gauge: { radius: '4px' } } });
    });
});

describe('checkTheme', () => {
    it('finds nothing wrong with the built-in themes', () => {
        expect(checkTheme()).toEqual([]);
        expect(checkTheme({ base: 'light' })).toEqual([]);
        expect(checkTheme({ accent: 'var(--primary)', tokens: { bg: 'var(--background)' } })).toEqual([]);
    });

    it('names unknown tokens, unreadable colors and low contrast', () => {
        const problems = checkTheme({ accent: 'hotpink', colors: { background: '#ffffff', text: '#eeeeee' }, tokens: { 'surface-raised': '#000' } as never });
        expect(problems).toHaveLength(3);
        expect(problems[0]).toContain('"surface-raised" is not a token');
        expect(problems[1]).toContain('accent "hotpink"');
        expect(problems[2]).toMatch(/^fg on bg has a contrast of 1\.\d:1/);
    });

    it('is what createTheme warns about, once per problem', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createTheme({ colors: { background: '#ffffff', text: '#f4f4f4' } });
        createTheme({ colors: { background: '#ffffff', text: '#f4f4f4' } });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]![0])).toContain('fg on bg');
        warn.mockRestore();
    });
});

describe('applyTheme', () => {
    it('writes one rule per theme in the theme layer and marks the host', () => {
        const theme = createTheme({ accent: '#0a3d91' });
        const a = document.body.appendChild(document.createElement('div'));
        const b = document.body.appendChild(document.createElement('div'));
        applyTheme(a, theme);
        applyTheme(b, theme);
        expect(a.getAttribute('data-vela-theme')).toBe(theme.id);
        expect(themeSheets()).toHaveLength(1);
        expect(themeSheets()[0]!.textContent).toMatch(new RegExp(`^@layer vela\\.theme \\{ \\[data-vela-theme="${theme.id}"\\]`));
        expect(document.getElementById('vela-layers')?.textContent).toContain('vela.theme');
    });

    it('lets two themes coexist on one page', () => {
        const a = document.body.appendChild(document.createElement('div'));
        const b = document.body.appendChild(document.createElement('div'));
        applyTheme(a, createTheme());
        applyTheme(b, createTheme({ base: 'light' }));
        expect(a.dataset.velaTheme).not.toBe(b.dataset.velaTheme);
        expect(themeSheets()).toHaveLength(2);
    });

    it('takes a chart theme and drops tokens left inline', () => {
        const host = document.body.appendChild(document.createElement('div'));
        host.style.setProperty('--vela-bg', 'red');
        const ui = applyTheme(host, LIGHT_THEME);
        expect(ui.id).toBe(createTheme({ base: 'light' }).id);
        expect(host.style.getPropertyValue('--vela-bg')).toBe('');
    });

    it("keeps a chart theme's settings when its surface is recolored", () => {
        const brand = createTheme({ accent: '#0a3d91', radius: 'none', components: { button: { radius: '2px' } } });
        const chart = resolveTheme(brand);
        expect(resolveTheme(brand)).toBe(chart);
        expect(chart.background).toBe(DARK_CHART.background);
        expect(chart.ui).toEqual({ accent: '#0a3d91', radius: 'none', components: { button: { radius: '2px' } } });
        const host = document.body.appendChild(document.createElement('div'));
        expect(applyTheme(host, chart).id).toBe(brand.id);
        const overlay = applyTheme(host, { ...chart, background: '#ffffff', textColor: '#1e293b' });
        expect(overlay.tokens['--vela-bg']).toBe('#ffffff');
        expect(overlay.tokens['--vela-accent']).toBe('#0a3d91');
        expect(overlay.tokens['--vela-radius-md']).toBe('0px');
        expect(overlay.components).toEqual({ button: { radius: '2px' } });
        expect(applyTheme(host, { ...DARK_THEME, ui: { accent: '#0a3d91' } }).tokens['--vela-accent']).toBe('#0a3d91');
    });

    it('drops rules no element carries once live recoloring piles them up', () => {
        const kept = document.body.appendChild(document.createElement('div'));
        applyTheme(kept, createTheme());
        const host = document.body.appendChild(document.createElement('div'));
        for (let i = 0; i < 80; i += 1) applyTheme(host, { ...DARK_CHART, background: `rgb(${i}, 0, 0)` });
        expect(themeSheets().length).toBeLessThanOrEqual(34);
        expect(document.getElementById(`vela-theme-${kept.dataset.velaTheme}`)).not.toBeNull();
        expect(document.getElementById(`vela-theme-${host.dataset.velaTheme}`)).not.toBeNull();
    });
});

describe('registerTheme', () => {
    it('offers a theme by id until it is unregistered', () => {
        const midnight = createTheme({ colors: { background: '#0f1117', text: '#c9d1d9', accent: '#7c3aed' } });
        const off = registerTheme({ id: 'midnight', label: 'Midnight', theme: midnight });
        expect(registeredThemes().map((t) => t.id)).toEqual(['midnight']);
        expect(resolveTheme('midnight')).toBe(resolveTheme(midnight));
        expect(registeredThemeIdOf(resolveTheme(midnight))).toBe('midnight');
        expect(registeredThemeIdOf({ ...resolveTheme(midnight) })).toBe('midnight');
        expect(registeredThemeIdOf(DARK_THEME)).toBeNull();
        off();
        expect(registeredThemes()).toEqual([]);
        expect(resolveTheme('midnight')).toBe(DARK_THEME);
    });

    it('keeps the built-in ids', () => {
        expect(() => registerTheme({ id: 'dark', label: 'Mine', theme: DARK_THEME })).toThrow(/built-in/);
    });
});
