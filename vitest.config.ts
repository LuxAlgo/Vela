import { defineConfig } from 'vitest/config';
import { velaUiSource } from './scripts/vela-ui-source.mjs';

export default defineConfig({
    plugins: [velaUiSource()],
    test: {
        // `.mjs` tests cover the framework-free playground modules (plain JS, outside the
        // TS build) — e.g. the keyboard-shortcut policy in `playground/modules/shortcuts-core.js`.
        include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.mjs'],
        environment: 'node',
    },
});
