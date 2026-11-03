// Starts a component: `npm run new-component -- gauge` writes src/components/gauge.ts in the
// kit's shape, adds its declaration to the theme's ComponentDefs, and writes its test in the
// repo's test/ folder.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(root, '../..');
const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    console.error('Usage: npm run new-component -- <name> (lowercase words joined by dashes, like gauge or range-slider)');
    process.exit(1);
}
const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const Pascal = camel[0].toUpperCase() + camel.slice(1);
const file = join(root, 'src/components', `${name}.ts`);
if (existsSync(file)) {
    console.error(`${name} exists: src/components/${name}.ts`);
    process.exit(1);
}

writeFileSync(
    file,
    `// ${Pascal}: … what it is and how it behaves, for the reader of the file.
import { css, defineStyles } from '../lib/css';
import { defineComponent } from '../lib/define';
import { h } from '../lib/h';
import { t } from '../lib/t';
import { variants, type VariantProps } from '../lib/variants';

export const ${camel}Def = defineComponent({
    name: '${name}',
    parts: ['root'],
    settings: { radius: t.radius.md },
});

export const ${camel}Variants = variants({ size: ['md', 'sm'] });

export interface ${Pascal}Props extends VariantProps<typeof ${camel}Variants> {
    /** Extra class names (layout hooks). */
    className?: string;
}

export interface ${Pascal}Handle {
    readonly el: HTMLElement;
    destroy(): void;
}

const injectStyles = defineStyles(
    'vela-ui-${name}',
    css\`
        @layer vela.ui {
            [data-slot='${name}'] {
                border-radius: \${${camel}Def.vars.radius};
                color: \${t.fg};

                &[data-size='sm'] {
                    font-size: \${t.fontSize.sm};
                }
            }
        }
    \`,
);

export function create${Pascal}(props: ${Pascal}Props = {}): ${Pascal}Handle {
    injectStyles(document);
    const el = h('div', { className: props.className, slot: ${camel}Def.slot('root'), attrs: ${camel}Variants(props) });
    return { el, destroy: () => el.remove() };
}
`,
);

const themePath = join(root, 'src/lib/theme.ts');
let theme = readFileSync(themePath, 'utf8');
const imports = [...theme.matchAll(/^import type \{ \w+Def \} from '\.\.\/components\/[\w-]+';$/gm)];
const importLine = `import type { ${camel}Def } from '../components/${name}';`;
const after = imports.filter((m) => m[0] < importLine).pop() ?? null;
const at = after ? after.index + after[0].length : imports[0].index - 1;
theme = `${theme.slice(0, at)}\n${importLine}${theme.slice(at)}`.replace(/^\n/, '');
const defsStart = theme.indexOf('export interface ComponentDefs {');
const defsEnd = theme.indexOf('\n}', defsStart);
const key = /^[a-z]+$/.test(name) ? name : `'${name}'`;
const entries = theme.slice(defsStart, defsEnd).split('\n').slice(1).filter((l) => /typeof \w+Def;/.test(l));
entries.push(`    ${key}: typeof ${camel}Def;`);
entries.sort((a, b) => a.replace(/['\s]/g, '').localeCompare(b.replace(/['\s]/g, '')));
const head = theme.slice(defsStart, defsEnd).split('\n').filter((l) => !/typeof \w+Def;/.test(l));
theme = `${theme.slice(0, defsStart)}${[...head, ...entries].join('\n')}${theme.slice(defsEnd)}`;
writeFileSync(themePath, theme);

const testPath = join(repo, 'test', `ui-${name}.test.ts`);
writeFileSync(
    testPath,
    `// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { create${Pascal} } from '@luxalgo/vela-ui/${name}';

describe('${name}', () => {
    it('renders its root part with its variants', () => {
        const { el } = create${Pascal}({ size: 'sm' });
        expect(el.getAttribute('data-slot')).toBe('${name}');
        expect(el.getAttribute('data-size')).toBe('sm');
    });
});
`,
);

console.log(`Wrote src/components/${name}.ts, its ComponentDefs entry, and test/ui-${name}.test.ts.
Next: describe it at the top of the file, give it its parts, settings, variants and behavior,
then npm run typecheck, npm run lint and npm test. If Vela should re-export it, add its
public names to src/ui/index.ts.`);
