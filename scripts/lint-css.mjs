// Lints the kit's component CSS. postcss-lit skips a template it cannot parse with only a
// console warning, and skips one under a disable comment silently: both would leave the
// template unchecked, so both fail the run.
import { readFileSync } from 'node:fs';
import stylelint from 'stylelint';

const FILES = process.argv.length > 2 ? process.argv.slice(2) : ['src/ui/components/*.ts'];

const skipped = [];
const warn = console.warn;
console.warn = (...args) => {
    if (String(args[0]).includes('[postcss-lit]')) skipped.push(args.slice(1).join(' '));
    else warn(...args);
};
const { results, report: output } = await stylelint.lint({ files: FILES, formatter: 'string' });
console.warn = warn;

for (const r of results) if (readFileSync(r.source, 'utf8').includes('postcss-lit-disable')) skipped.push(`${r.source} turns a template's checks off.`);

if (output.trim()) console.log(output);
for (const s of skipped) console.error(`stylelint: a css template was not checked. ${s}`);
const errored = results.some((r) => r.errored) || skipped.length > 0;
if (!errored) console.log(`stylelint: ${results.length} component files clean.`);
process.exit(errored ? 1 : 0);
