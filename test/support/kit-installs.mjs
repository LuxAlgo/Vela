// Temporary projects with the kit installed in a given node_modules layout, for the vela-ui
// CLI tests. Plain JavaScript: the repo's TypeScript config types the browser, not Node.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Runs `fn(cwd)` in a project holding the kit at each folder of `copies` (folder →
 *  version) and a link at each key of `links` (link → folder), then removes the project. */
export function withProject({ copies = {}, links = {} }, fn) {
    const cwd = mkdtempSync(join(tmpdir(), 'vela-ui-'));
    try {
        for (const [dir, version] of Object.entries(copies)) {
            mkdirSync(join(cwd, dir), { recursive: true });
            writeFileSync(join(cwd, dir, 'package.json'), JSON.stringify({ name: '@luxalgo/vela-ui', version }));
        }
        for (const [link, target] of Object.entries(links)) {
            mkdirSync(join(cwd, link, '..'), { recursive: true });
            // A junction needs no elevation on Windows; elsewhere the type is ignored.
            symlinkSync(join(cwd, target), join(cwd, link), 'junction');
        }
        return fn(cwd);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}
