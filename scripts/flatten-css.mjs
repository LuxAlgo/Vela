// Build step for kit component CSS: each `css` template of packages/vela-ui/src/components/*.ts goes through
// Lightning CSS, which flattens the nesting (and minifies) for the oldest browsers the package
// supports, those that brought `@layer`. The playground and the tests run the nested source.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { transform } from 'lightningcss';

const version = (major, minor = 0) => (major << 16) | (minor << 8);
export const TARGETS = { chrome: version(99), edge: version(99), firefox: version(97), safari: version(15, 4), ios_saf: version(15, 4) };

const PLACEHOLDER = /var\(--vela-interp-(\d+)\)/g;
const NAME_PLACEHOLDER = /--vela-interp-(\d+)/g;

/** Flattens the `css` templates of one source file; interpolations pass through untouched. */
export function flattenTemplates(source, filename) {
    return source.replace(/\bcss`([^`]*)`/g, (_, body) => {
        const exprs = [];
        // A value interpolation stands in as `var(--…)`; one right after `var(` is a custom
        // property name (`var(${t.accent.name}, …)`) and stands in as the bare name.
        const text = body.replace(/\$\{([^{}]*)\}/g, (__, expr, offset) => {
            const i = exprs.push(expr) - 1;
            return /var\(\s*$/.test(body.slice(0, offset)) ? `--vela-interp-${i}` : `var(--vela-interp-${i})`;
        });
        if (text.includes('${')) throw new Error(`${filename}: a css template interpolates an expression with braces; keep interpolations to tokens and settings.`);
        const { code, warnings } = transform({ filename, code: Buffer.from(text), minify: true, targets: TARGETS });
        if (warnings.length) throw new Error(`${filename}: ${warnings.map((w) => w.message).join('; ')}`);
        const flat = code.toString();
        // Re-entering a template literal: an escape or a backtick would change its text.
        if (/[\\`]/.test(flat)) throw new Error(`${filename}: a css template produces a backslash or a backtick; write the value without one.`);
        const restore = (__, i) => `\${${exprs[Number(i)]}}`;
        return `css\`${flat.replace(PLACEHOLDER, restore).replace(NAME_PLACEHOLDER, restore)}\``;
    });
}

/** `flattenTemplates` over a file on disk. */
export function flattenFile(path) {
    return flattenTemplates(readFileSync(path, 'utf8'), path);
}

/** esbuild plugin applying `flattenTemplates` to the kit's component files. */
export function flattenCss() {
    return {
        name: 'vela-flatten-css',
        setup(build) {
            build.onLoad({ filter: /[\\/]vela-ui[\\/]src[\\/]components[\\/][^\\/]+\.ts$/ }, async (args) => {
                const source = await readFile(args.path, 'utf8');
                if (!source.includes('css`')) return undefined;
                return { contents: flattenTemplates(source, args.path), loader: 'ts' };
            });
        },
    };
}
