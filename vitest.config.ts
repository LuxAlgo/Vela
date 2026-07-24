import { defineConfig } from 'vitest/config';

export default defineConfig({
    // Stub the build-time-inlined worker source (`inline-worker:*`) — tests drive
    // PineWorkerEngine with a fake worker, so the real bundled string isn't needed.
    // Production inlining is done by the tsup `inline-worker` plugin.
    plugins: [
        {
            name: 'inline-worker-stub',
            resolveId(id: string) {
                return id.startsWith('inline-worker:') ? '\0inline-worker-stub' : undefined;
            },
            load(id: string) {
                return id === '\0inline-worker-stub' ? 'export default "";' : undefined;
            },
        },
    ],
    test: {
        // `.mjs` tests cover the framework-free playground modules (plain JS, outside the
        // TS build) — e.g. the keyboard-shortcut policy in `playground/modules/shortcuts-core.js`.
        include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
        environment: 'node',
    },
});
