/** Marks a stubbed code path during phased implementation. */
export function notImplemented(what: string): never {
    throw new Error(`[vela] not implemented yet: ${what}`);
}
