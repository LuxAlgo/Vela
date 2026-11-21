import { defineConfig } from 'vite';
import { velaUiSource } from './scripts/vela-ui-source.mjs';

/**
 * Playground server: `npm run playground` serves playground/ with Vela imported STRAIGHT
 * from src/ (no build step, hot reload), and the kit from packages/vela-ui/src. Nothing else
 * to configure — Vela ships no scripting engine, so the page carries its own tiny demo engine
 * (playground/demo-engine.ts) and needs no bundler plumbing for it.
 */
export default defineConfig({
    root: 'playground',
    server: { port: 5190, strictPort: true },
    plugins: [velaUiSource()],
});
