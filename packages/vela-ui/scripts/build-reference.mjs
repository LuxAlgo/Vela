// Writes the generated reference after tsup: dist/manifest.json, dist/theme.schema.json,
// llms.txt, and registry/ (the sources `vela-ui add --source` copies). Fails when a
// component's declaration is missing from the theme's ComponentDefs, which would leave its
// settings out of the typed theme.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { componentReference, llmsTxt, missingDefs, PACKAGE_ROOT as root, skillsOf, themeSchema, tokenAccessors } from './reference.mjs';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { t } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const { TOKEN_NAMES } = await import(pathToFileURL(join(root, 'dist/theme.js')).href);

const components = componentReference(root, tokenAccessors(t));
const missing = missingDefs(components, root);
if (missing.length) {
    console.error(`ComponentDefs in src/lib/theme.ts is missing: ${missing.join(', ')}`);
    process.exit(1);
}

// The registry: each component's source as a project's copy imports it, from the package.
// A copy can only import what the package publishes, so a library module it reaches must
// be a root export or an entry of its own (LIB in tsup.config.ts).
const ROOT_ENTRY = new Set(['css', 'define', 'h', 't', 'variants']);
const unpublished = new Set();
const toPackage = (source) =>
    source
        .replace(/from '\.\.\/lib\/([\w-]+)'/g, (_, m) => {
            if (ROOT_ENTRY.has(m)) return `from '@luxalgo/vela-ui'`;
            if (!existsSync(join(root, 'dist', `${m}.js`))) unpublished.add(m);
            return `from '@luxalgo/vela-ui/${m}'`;
        })
        .replace(/from '\.\/([\w-]+)'/g, (_, m) => `from '@luxalgo/vela-ui/${m}'`);
rmSync(join(root, 'registry'), { recursive: true, force: true });
mkdirSync(join(root, 'registry'));
for (const c of components) writeFileSync(join(root, 'registry', `${c.name}.ts`), toPackage(readFileSync(join(root, 'src/components', `${c.name}.ts`), 'utf8')));
if (unpublished.size) {
    console.error(`Copied components would import modules the package does not publish: ${[...unpublished].join(', ')}. Add them to LIB in tsup.config.ts.`);
    process.exit(1);
}

writeFileSync(join(root, 'dist/manifest.json'), `${JSON.stringify({ package: '@luxalgo/vela-ui', version, tokens: TOKEN_NAMES, components }, null, 2)}\n`);
writeFileSync(join(root, 'dist/theme.schema.json'), `${JSON.stringify(themeSchema(components, TOKEN_NAMES, version), null, 2)}\n`);
writeFileSync(join(root, 'llms.txt'), llmsTxt(components, version, skillsOf(root)));
console.log(`reference: ${components.length} components, ${TOKEN_NAMES.length} tokens`);
