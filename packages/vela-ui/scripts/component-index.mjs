// Writes src/lib/component-index.ts: every kit component's parts and settings, read from its
// declaration, which `checkTheme` checks a theme's `components` against. The build and
// `new-component` run it, and a test fails while the file is behind the declarations.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { componentReference, PACKAGE_ROOT } from './reference.mjs';

export const INDEX_FILE = join(PACKAGE_ROOT, 'src/lib/component-index.ts');

/** Each declared component's parts and settings, by name. */
export function componentIndex(root = PACKAGE_ROOT) {
    const out = {};
    for (const c of componentReference(root, new Map())) {
        if (c.component) out[c.component] = { parts: Object.keys(c.parts ?? {}), settings: Object.keys(c.settings ?? {}) };
    }
    return out;
}

/** The index as the TypeScript module the kit imports. */
export function componentIndexSource(index) {
    const key = (name) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`);
    const list = (names) => `[${names.map((n) => `'${n}'`).join(', ')}]`;
    const rows = Object.keys(index)
        .sort()
        .map((name) => `    ${key(name)}: {\n        parts: ${list(index[name].parts)},\n        settings: ${list(index[name].settings)},\n    },`);
    return [
        "// Generated from each component's declaration by scripts/component-index.mjs, which the build",
        '// and `new-component` run: do not edit.',
        '',
        "/** Every kit component's parts and settings, by name: what `checkTheme` checks a theme's",
        ' *  `components` against. */',
        'export const KIT_COMPONENTS: Readonly<Record<string, { readonly parts: readonly string[]; readonly settings: readonly string[] }>> = {',
        ...rows,
        '};',
        '',
    ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    writeFileSync(INDEX_FILE, componentIndexSource(componentIndex()));
    console.log('component index written');
}
