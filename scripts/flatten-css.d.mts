// Types for scripts/flatten-css.mjs, so a test can drive it.
export const TARGETS: Record<string, number>;
export function flattenTemplates(source: string, filename: string): string;
export function flattenFile(path: string): string;
export function flattenCss(): { name: string; setup(build: unknown): void };
