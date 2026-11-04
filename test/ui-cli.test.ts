// The vela-ui CLI's engine: a copy gets its own component name, diffs read as diffs, a theme
// file is checked against the shipped schema, and one install counts as one copy.
import { describe, expect, it } from 'vitest';
import { t } from '@luxalgo/vela-ui';
import { TOKEN_NAMES } from '@luxalgo/vela-ui/theme';
// @ts-expect-error -- the CLI, plain JavaScript
import { diffLines, installedCopies, renameComponent, validate } from '../packages/vela-ui/cli/engine.mjs';
// @ts-expect-error -- a build script, plain JavaScript
import { componentReference, PACKAGE_ROOT, themeSchema, tokenAccessors } from '../packages/vela-ui/scripts/reference.mjs';
// @ts-expect-error -- a test helper, plain JavaScript
import { withProject } from './support/kit-installs.mjs';

describe('a source copy', () => {
    const source = [
        "export const buttonDef = defineComponent({ name: 'button', parts: ['root', 'icon'] });",
        "const injectStyles = defineStyles('vela-ui-button', css`",
        "    [data-slot='button'] { color: red; }",
        "    [data-slot~='button-icon'] { width: 16px; }",
        "    [data-slot='button-group'] { gap: 0; }",
        "    [data-slot='buttons'] { gap: 0; }",
        '`);',
    ].join('\n');

    it('takes its own component name, so it never styles the package component', () => {
        const out = renameComponent(source, 'button', 'app-button') as string;
        expect(out).toContain("name: 'app-button'");
        expect(out).toContain("defineStyles('vela-ui-app-button'");
        expect(out).toContain("[data-slot='app-button'] {");
        expect(out).toContain("[data-slot~='app-button-icon']");
        expect(out).toContain("[data-slot='app-button-group']");
        // Another component whose name merely starts the same stays.
        expect(out).toContain("[data-slot='buttons']");
        expect(out).not.toMatch(/'vela-ui-button'|name: 'button'/);
    });
});

describe('diffLines', () => {
    it('shows removed lines before added ones, with context and hunk breaks', () => {
        const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\r\n');
        const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'K'].join('\n');
        expect(diffLines(before, after, 1)).toBe([' a', '-b', '+B', ' c', '@@', ' j', '-k', '+K'].join('\n'));
        expect(diffLines('same', 'same')).toBe('');
    });
});

describe('a theme file', () => {
    const schema = themeSchema(componentReference(PACKAGE_ROOT, tokenAccessors(t)), TOKEN_NAMES, '0.0.0');

    it('passes when it uses only real fields and colors', () => {
        expect(validate(schema, { $schema: './theme.schema.json', base: 'light', accent: '#7c3aed', radius: 'sm', tokens: { 'surface-elev': '#1b1c22' }, components: { button: { radius: '2px', css: { root: 'x' } } } })).toEqual([]);
        expect(validate(schema, { base: { background: '#000', textColor: '#fff', gridColor: '#111', borderColor: '#222', upColor: '#0f0', downColor: '#f00', fontFamily: 'Inter' } })).toEqual([]);
    });

    it('names each field it gets wrong', () => {
        const errors = validate(schema, { radius: 'xl', colors: { accent: 'hotpink' }, tokens: { 'surface-raised': '#000' }, components: { button: { gap: '40px', css: { icn: 'x' } } }, base: { background: '#000' } }) as string[];
        expect(errors).toEqual(
            expect.arrayContaining([
                '/radius: must be one of none, sm, md, lg',
                '/colors/accent: "hotpink" is not a color (#rrggbb, rgb() or var())',
                '/tokens/surface-raised: is not a known field',
                '/components/button/gap: is not a known field',
                '/components/button/css/icn: is not a known field',
            ]),
        );
        expect(errors.some((e) => e.startsWith('/base'))).toBe(true);
    });
});

describe('the installed copies', () => {
    const versions = (cwd: string): string[] => installedCopies(cwd).map((c: { version: string }) => c.version);

    it('count a pnpm install once: the link at the top and the store folder it points to', () => {
        const store = 'node_modules/.pnpm/@luxalgo+vela-ui@0.1.0/node_modules/@luxalgo/vela-ui';
        withProject({ copies: { [store]: '0.1.0' }, links: { 'node_modules/@luxalgo/vela-ui': store } }, (cwd: string) => {
            expect(versions(cwd)).toEqual(['0.1.0']);
        });
    });

    it('count two installed versions as two copies', () => {
        const copies = { 'node_modules/@luxalgo/vela-ui': '0.1.0', 'node_modules/some-plugin/node_modules/@luxalgo/vela-ui': '0.2.0' };
        withProject({ copies }, (cwd: string) => {
            expect(versions(cwd).sort()).toEqual(['0.1.0', '0.2.0']);
        });
    });
});
