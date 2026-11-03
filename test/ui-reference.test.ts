// The kit's generated reference (manifest.json, theme.schema.json) agrees with the components
// and the theme it describes.
import { describe, expect, it } from 'vitest';
import { t } from '@luxalgo/vela-ui';
import { TOKEN_NAMES } from '@luxalgo/vela-ui/theme';
import { buttonDef } from '@luxalgo/vela-ui/button';
import { selectDef } from '@luxalgo/vela-ui/select';
// @ts-expect-error -- a build script, plain JavaScript
import { componentReference, missingDefs, PACKAGE_ROOT, themeSchema, tokenAccessors } from '../packages/vela-ui/scripts/reference.mjs';

interface Entry {
    name: string;
    component?: string;
    declaration?: string;
    factory?: string;
    parts?: Record<string, string>;
    settings?: Record<string, { default: string; token?: string }>;
    variants?: Record<string, string[]>;
    props?: Array<{ name: string; required: boolean }>;
    tokens: string[];
    example?: string;
}

const components = componentReference(PACKAGE_ROOT, tokenAccessors(t)) as Entry[];
const byName = (name: string) => components.find((c) => c.name === name)!;

describe('the component manifest', () => {
    it('lists every component with its declaration, read from the source', () => {
        expect(components.length).toBeGreaterThanOrEqual(19);
        const button = byName('button');
        expect(button.factory).toBe('createButton');
        expect(button.parts).toEqual({ root: buttonDef.slot('root'), icon: buttonDef.slot('icon') });
        expect(button.settings?.radius).toEqual({ default: 'var(--vela-radius-md)', token: 'radius-md' });
        expect(button.settings?.['height-sm']).toEqual({ default: '30px' });
        expect(button.variants?.size).toContain('icon-sm');
        expect(button.props?.map((p) => p.name)).toEqual(expect.arrayContaining(['text', 'variant', 'size', 'onClick']));
        expect(button.example).toContain("createButton();");
        expect(byName('select').parts?.content).toBe(selectDef.slot('content'));
        expect(byName('tabs').props?.find((p) => p.name === 'items')?.required).toBe(true);
    });

    it('names only real tokens', () => {
        const known = new Set<string>(TOKEN_NAMES);
        for (const c of components) expect(c.tokens.filter((n) => !known.has(n)), c.name).toEqual([]);
    });

    it('has every declaration in the typed theme', () => {
        expect(missingDefs(components)).toEqual([]);
    });
});

describe('the theme schema', () => {
    const schema = themeSchema(components, TOKEN_NAMES, '0.0.0') as {
        properties: { tokens: { properties: Record<string, unknown> }; components: { properties: Record<string, { properties: Record<string, unknown> }> } };
    };

    it('takes every token and every component setting and part', () => {
        expect(Object.keys(schema.properties.tokens.properties).sort()).toEqual([...TOKEN_NAMES].sort());
        const button = schema.properties.components.properties.button!;
        expect(Object.keys(button.properties)).toEqual(expect.arrayContaining(['css', 'radius', 'height', 'height-sm', 'font-size-xs']));
        expect(Object.keys((button.properties.css as { properties: object }).properties)).toEqual(['root', 'icon']);
    });
});
