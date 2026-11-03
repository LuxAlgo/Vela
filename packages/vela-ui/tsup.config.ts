import { readdirSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { flattenCss } from '../../scripts/flatten-css.mjs';

// One entry per component (`@luxalgo/vela-ui/<name>`) and per public library module, so a
// bundle holds only what its imports reach. ESM only: with a CommonJS build beside it, one
// page could load each half through a different path and carry every component twice.
const components = Object.fromEntries(
    readdirSync('src/components')
        .filter((f) => f.endsWith('.ts'))
        .map((f) => [f.slice(0, -3), `src/components/${f}`]),
);
const LIB = ['color', 'palette', 'tokens', 'theme', 'icons', 'styles', 'zag', 'headless', 'surface-events', 'surface-exit', 'kit-text', 'i18n'];

export default defineConfig({
    entry: {
        index: 'src/index.ts',
        ...components,
        ...Object.fromEntries(LIB.map((name) => [name, `src/lib/${name}.ts`])),
    },
    format: ['esm'],
    dts: true,
    sourcemap: false,
    clean: true,
    treeshake: true,
    esbuildPlugins: [flattenCss()],
});
