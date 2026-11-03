// Writes the generated reference into dist/ after tsup: manifest.json, theme.schema.json and
// llms.txt. Fails when a component's declaration is missing from the theme's ComponentDefs,
// which would leave its settings out of the typed theme.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { componentReference, llmsTxt, missingDefs, PACKAGE_ROOT as root, themeSchema, tokenAccessors } from './reference.mjs';

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const { t } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
const { TOKEN_NAMES } = await import(pathToFileURL(join(root, 'dist/theme.js')).href);

const components = componentReference(root, tokenAccessors(t));
const missing = missingDefs(components, root);
if (missing.length) {
    console.error(`ComponentDefs in src/lib/theme.ts is missing: ${missing.join(', ')}`);
    process.exit(1);
}

writeFileSync(join(root, 'dist/manifest.json'), `${JSON.stringify({ package: '@luxalgo/vela-ui', version, tokens: TOKEN_NAMES, components }, null, 2)}\n`);
writeFileSync(join(root, 'dist/theme.schema.json'), `${JSON.stringify(themeSchema(components, TOKEN_NAMES, version), null, 2)}\n`);
writeFileSync(join(root, 'llms.txt'), llmsTxt(components, version));
console.log(`reference: ${components.length} components, ${TOKEN_NAMES.length} tokens`);
