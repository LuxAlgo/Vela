// Lints the CSS written with the kit's `css` tag: the kit's components, which must be clean,
// and Vela's chrome, held to a baseline of what it carried before the rules
// (stylelint-baseline.json, which may only shrink). `--update-baseline` rewrites it.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lintCss } from '../packages/vela-ui/stylelint/lint.mjs';

const update = process.argv.includes('--update-baseline');
const tracked = execSync('git ls-files src', { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.ts') && readFileSync(f, 'utf8').includes('css`'));

const kit = await lintCss({ files: ['packages/vela-ui/src/components/*.ts'] });
const chrome = await lintCss({ files: tracked, baseline: 'stylelint-baseline.json', update, updateHint: 'npm run lint:css -- --update-baseline' });
process.exit(kit && chrome ? 0 : 1);
