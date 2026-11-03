import { readdirSync } from 'node:fs';
import { defineConfig } from 'tsup';
import { flattenCss } from './scripts/flatten-css.mjs';

// Locale packs: one entry per `src/locales/<tag>.ts`, each published on its own as
// `@luxalgo/vela/locales/<tag>` (one plain object; nothing registers on import).
const localeEntries = Object.fromEntries(
    readdirSync('src/locales')
        .filter((f) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*\.ts$/.test(f))
        .map((f) => [`locales/${f.slice(0, -'.ts'.length)}`, `src/locales/${f}`]),
);

export default defineConfig([
    // Library build — ESM + CJS + types, backends external (consumer provides them).
    {
        name: 'lib',
        entry: {
            index: 'src/index.ts',
            plugin: 'src/plugin.ts',
            ui: 'src/ui/index.ts',
            widget: 'src/widget/index.ts',
            workspace: 'src/workspace/index.ts',

            'providers/binance': 'src/data/providers/binance/index.ts',
            'providers/hyperliquid': 'src/data/providers/hyperliquid/index.ts',
            'providers/coinbase': 'src/data/providers/coinbase/index.ts',
            ...localeEntries,
        },
        format: ['esm', 'cjs'],
        dts: true,
        // No sourcemaps in the published package (the peer norm — the reference
        // charting libs ship none): maps only cost download size, they play no role
        // in the consumer's tree-shaking or minification. Deep debugging = clone the
        // repo and run the playground (serves src/ directly).
        sourcemap: false,
        clean: true,
        treeshake: true,
        esbuildPlugins: [flattenCss()],
        // Write non-ASCII text as UTF-8 rather than `\uXXXX` escapes, which roughly double the
        // size of a locale pack in a non-Latin script. Module files are read as UTF-8 by Node
        // and by bundlers; the script-tag builds below keep ASCII output, since a page that is
        // not UTF-8 would decode them in its own charset.
        esbuildOptions(options) {
            options.charset = 'utf8';
        },
    },
    // Browser globals — self-contained IIFEs exposing `window.Vela`, in the reference
    // dev/prod pair: `vela.global.js` is the readable development build,
    // `vela.global.min.js` the minified one for CDN use. An addon (e.g.
    // `vela-pinets.global.js`) loads AFTER one of them and resolves `@luxalgo/vela`
    // to that same `window.Vela` — never a second copy of the library.
    {
        name: 'browser-dev',
        entry: { vela: 'src/browser.ts' },
        format: ['iife'],
        globalName: 'Vela',
        platform: 'browser',
        sourcemap: false,
        clean: false,
        treeshake: true,
        esbuildPlugins: [flattenCss()],
        minify: false,
    },
    {
        name: 'browser-min',
        entry: { vela: 'src/browser.ts' },
        format: ['iife'],
        globalName: 'Vela',
        platform: 'browser',
        outExtension: () => ({ js: '.global.min.js' }),
        sourcemap: false,
        clean: false,
        treeshake: true,
        esbuildPlugins: [flattenCss()],
        minify: true,
    },
]);
