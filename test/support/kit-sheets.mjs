// The kit's component stylesheets read from their source files, for the tests that check what
// every sheet does. Plain JavaScript: the repo's TypeScript config types the browser, not Node.
import { readdirSync, readFileSync } from 'node:fs';
import { transform } from 'lightningcss';

const COMPONENTS = 'packages/vela-ui/src/components';

/** Every `css` sheet of the component files, `{ file, text }`, each interpolation stood in for
 *  by a custom property (its bare name right after `var(`). */
export function componentSheets() {
    return readdirSync(COMPONENTS).flatMap((file) =>
        [...readFileSync(`${COMPONENTS}/${file}`, 'utf8').matchAll(/\bcss`([^`]*)`/g)].map((m) => ({
            file,
            text: m[1].replace(/\$\{[^{}]*\}/g, (_, offset, all) => (/var\(\s*$/.test(all.slice(0, offset)) ? '--vela-x' : 'var(--vela-x)')),
        })),
    );
}

/** Throws when Lightning CSS cannot read `text` as a stylesheet. */
export function parseStrictly(text) {
    transform({ filename: 'sheet.css', code: Buffer.from(text), errorRecovery: false });
}
