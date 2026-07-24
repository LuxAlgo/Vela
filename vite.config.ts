import { defineConfig } from 'vite';
import * as esbuild from 'esbuild';
import { dirname, resolve } from 'node:path';

/**
 * Playground server: `npm run playground` serves playground/ with Vela imported STRAIGHT
 * from src/ (no build step, hot reload). The `inline-worker:` scheme is resolved FOR
 * REAL here (same semantics as the production tsup plugin): the worker entry is bundled
 * into a self-contained IIFE string — so `PineWorkerEngine` is fully functional in the
 * playground and the worker path can be exercised end to end. (vitest keeps its empty
 * stub; unit tests inject fake workers instead.)
 */
export default defineConfig({
    root: 'playground',
    server: { port: 5190, strictPort: true },
    plugins: [
        {
            name: 'inline-worker',
            resolveId(id: string, importer?: string) {
                if (!id.startsWith('inline-worker:')) return undefined;
                const entry = resolve(dirname(importer ?? ''), id.slice('inline-worker:'.length));
                return `\0inline-worker\0${entry}`;
            },
            async load(id: string) {
                if (!id.startsWith('\0inline-worker\0')) return undefined;
                const entry = id.slice('\0inline-worker\0'.length);
                const out = await esbuild.build({
                    entryPoints: [entry],
                    bundle: true,
                    write: false,
                    format: 'iife',
                    platform: 'browser',
                    minify: false, // dev: fast + debuggable; the production build minifies
                    sourcemap: false,
                    target: 'es2020',
                });
                this.addWatchFile(entry);
                return `export default ${JSON.stringify(out.outputFiles?.[0]?.text ?? '')};`;
            },
        },
    ],
});
