// Types for scripts/vela-ui-source.mjs, so the Vite and Vitest configs can use it.
export function velaUiSource(): { name: string; enforce: 'pre'; resolveId(id: string): string | null };
