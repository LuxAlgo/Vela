import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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
const LIB = ['color', 'palette', 'tokens', 'theme', 'icons', 'styles', 'zag', 'headless', 'surface-events', 'surface-exit', 'kit-text', 'i18n', 'calendar'];

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
    // The built-in themes as plain CSS, for a page that uses the kit without Vela: written
    // from the built theme module, so they cannot drift from `createTheme`.
    async onSuccess() {
        const { createTheme, themeCss } = await import(pathToFileURL('dist/theme.js').href);
        const { LAYER_ORDER } = await import(pathToFileURL('dist/index.js').href);
        mkdirSync('dist/themes', { recursive: true });
        for (const base of ['dark', 'light']) {
            const head = `/* @luxalgo/vela-ui: the built-in ${base} theme, every token on the page root. */\n`;
            writeFileSync(`dist/themes/${base}.css`, `${head}${LAYER_ORDER}\n${themeCss(createTheme({ base }), ':root')}\n`);
        }
    },
});
