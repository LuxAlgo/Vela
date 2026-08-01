import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // `.mjs` tests cover the framework-free playground modules (plain JS, outside the
        // TS build) — e.g. the keyboard-shortcut policy in `playground/modules/shortcuts-core.js`.
        include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
        environment: 'node',
    },
});
