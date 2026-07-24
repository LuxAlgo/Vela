/**
 * `inline-worker:<path>` imports yield the fully-bundled worker source as a string,
 * inlined at build time by the tsup `inline-worker` esbuild plugin (and stubbed to
 * `""` under vitest, where the proxy is driven by a fake worker).
 */
declare module 'inline-worker:*' {
    const workerCode: string;
    export default workerCode;
}
