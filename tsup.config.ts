import { defineConfig } from 'tsup';
import * as esbuild from 'esbuild';
import { resolve } from 'node:path';

/**
 * Inlines a worker entry as a string. `import code from 'inline-worker:./worker.ts'`
 * bundles that entry into a self-contained IIFE at build time and yields its source
 * as a default-exported string; `PineWorkerEngine` spawns it from a Blob URL at
 * runtime — no separate file, no URL to configure. The nested build sets no
 * `external`, so the worker carries its own pinets (it's a separate execution context).
 */
const inlineWorker = (): esbuild.Plugin => ({
    name: 'inline-worker',
    setup(build) {
        const PREFIX = 'inline-worker:';
        build.onResolve({ filter: /^inline-worker:/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.slice(PREFIX.length)),
            namespace: 'inline-worker',
        }));
        build.onLoad({ filter: /.*/, namespace: 'inline-worker' }, async (args) => {
            const out = await esbuild.build({
                entryPoints: [args.path],
                bundle: true,
                write: false,
                format: 'iife',
                platform: 'browser',
                minify: true,
                sourcemap: false,
                target: 'es2020',
            });
            return { contents: `export default ${JSON.stringify(out.outputFiles?.[0]?.text ?? '')};`, loader: 'js', watchFiles: [args.path] };
        });
    },
});

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
        external: ['pinets'],
        esbuildPlugins: [inlineWorker()],
    },
    // Browser globals — self-contained IIFEs (bundle pinets + the inlined worker)
    // exposing `window.Vela`, in the reference dev/prod pair: `vela.global.js` is the
    // readable development build, `vela.global.min.js` the minified one for CDN use.
    {
        name: 'browser-dev',
        entry: { vela: 'src/browser.ts' },
        format: ['iife'],
        globalName: 'Vela',
        platform: 'browser',
        sourcemap: false,
        clean: false,
        treeshake: true,
        minify: false,
        esbuildPlugins: [inlineWorker()],
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
        minify: true,
        esbuildPlugins: [inlineWorker()],
    },
]);
