// The build step that flattens the kit's nested component CSS for the oldest supported browsers.
import { describe, it, expect } from 'vitest';
import { flattenFile, flattenTemplates } from '../scripts/flatten-css.mjs';

const nested = [
    "export const a = css`",
    '    @layer vela.ui {',
    "        [data-slot='gauge'] {",
    '            color: ${t.fg};',
    "            &[data-size='sm'] { border-radius: ${gaugeDef.vars['track-radius']}; }",
    '            &:hover { background: color-mix(in srgb, ${t.accent} 10%, transparent); }',
    '        }',
    '    }',
    '`;',
].join('\n');

describe('flattenTemplates', () => {
    it('flattens nesting inside the layer and puts the interpolations back', () => {
        const out = flattenTemplates(nested, 'gauge.ts');
        expect(out).not.toContain('&');
        expect(out).toContain('@layer vela.ui{');
        expect(out).toContain("[data-slot=gauge][data-size=sm]{border-radius:${gaugeDef.vars['track-radius']}}");
        expect(out).toContain('[data-slot=gauge]:hover{background:color-mix(in srgb, ${t.accent} 10%, transparent)}');
        expect(out).toContain('color:${t.fg}');
        expect(out.startsWith('export const a = css`')).toBe(true);
    });

    it('carries an interpolated custom property name through var()', () => {
        const out = flattenTemplates("css`[data-slot='x'] { background: var(${t.accent.bright.name}, ${t.accent}); }`", 'x.ts');
        expect(out).toContain('background:var(${t.accent.bright.name},${t.accent})');
    });

    it('refuses what it cannot carry through a template literal', () => {
        expect(() => flattenTemplates('css`a { color: ${{ a: 1 }.a}; }`', 'x.ts')).toThrow(/braces/);
        expect(() => flattenTemplates("css`a::before { content: '\\\\201C'; }`", 'x.ts')).toThrow(/backslash/);
    });

    it('flattens every shipped component', () => {
        for (const file of ['packages/vela-ui/src/components/button.ts', 'packages/vela-ui/src/components/tabs.ts']) {
            const out = flattenFile(file);
            const sheet = /css`([^`]*)`/.exec(out)![1]!;
            expect(sheet.startsWith('@layer vela.ui{')).toBe(true);
            expect(sheet).not.toContain('&');
        }
    });
});
