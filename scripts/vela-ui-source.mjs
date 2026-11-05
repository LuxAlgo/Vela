// Resolve `@luxalgo/vela-ui` imports to the workspace package's source, so the playground and
// the tests run the kit's live code with no build step (the typecheck does the same through
// tsconfig paths). A subpath names a component or a library module.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '../packages/vela-ui/src');

export function velaUiSource() {
    return {
        name: 'vela-ui-source',
        enforce: 'pre',
        resolveId(id) {
            if (id === '@luxalgo/vela-ui') return resolve(SRC, 'index.ts');
            const m = /^@luxalgo\/vela-ui\/([a-z0-9-]+)$/.exec(id);
            if (!m) return null;
            for (const dir of ['components', 'lib']) {
                const file = resolve(SRC, dir, `${m[1]}.ts`);
                if (existsSync(file)) return file;
            }
            return null;
        },
    };
}
