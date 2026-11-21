// Types for scripts/i18n-extract.mjs, so the catalog test can drive it.
export const repoRoot: string;
export function collectMessages(root: string): { messages: Map<string, string>; errors: string[] };
export function renderEnJson(messages: Map<string, string>): string;
export function renderCatalog(messages: Map<string, string>): string;
export function generatedFiles(root: string): { errors: string[]; files: Record<string, string> };
export function checkGenerated(root: string): { errors: string[]; stale: string[]; files: Record<string, string> };
