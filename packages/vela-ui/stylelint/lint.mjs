// Runs stylelint over CSS written with the kit's `css` tag. postcss-lit skips a template it
// cannot parse with only a console warning, and skips one under a disable comment silently:
// both would leave the template unchecked, so both fail the run.
//
// A baseline records the violations CSS written before the rules carries, per file and rule.
// With one, the run fails when a count grows (a new violation) and when one shrinks (the
// baseline is then rewritten with `update`), so it only ever tightens.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import stylelint from 'stylelint';

/**
 * @param {{ files: string[], baseline?: string, update?: boolean, cwd?: string, updateHint?: string }} opts
 * @returns {Promise<boolean>} Whether the run passed.
 */
export async function lintCss({ files, baseline, update = false, cwd = process.cwd(), updateHint = 'rerun with --update-baseline' }) {
    const rel = (p) => relative(cwd, p).replace(/\\/g, '/');
    const skipped = [];
    const warn = console.warn;
    console.warn = (...args) => {
        if (String(args[0]).includes('[postcss-lit]')) skipped.push(args.slice(1).join(' '));
        else warn(...args);
    };
    let results;
    try {
        ({ results } = await stylelint.lint({ files, cwd }));
    } finally {
        console.warn = warn;
    }
    for (const r of results) if (readFileSync(r.source, 'utf8').includes('postcss-lit-disable')) skipped.push(`${rel(r.source)} turns a template's checks off.`);
    for (const s of skipped) console.error(`stylelint: a css template was not checked. ${s}`);

    const found = {};
    for (const r of results) {
        for (const w of r.warnings) {
            const file = rel(r.source);
            (found[file] ??= {})[w.rule] = (found[file]?.[w.rule] ?? 0) + 1;
        }
    }
    const print = (file, rule) => {
        const r = results.find((x) => rel(x.source) === file);
        for (const w of r?.warnings ?? []) if (w.rule === rule) console.error(`  ${file}:${w.line}:${w.column}  ${w.text}`);
    };

    if (!baseline) {
        for (const [file, rules] of Object.entries(found)) for (const rule of Object.keys(rules)) print(file, rule);
        const clean = Object.keys(found).length === 0 && skipped.length === 0;
        if (clean) console.log(`stylelint: ${results.length} files clean.`);
        return clean;
    }

    const sorted = Object.fromEntries(
        Object.keys(found)
            .sort()
            .map((f) => [f, Object.fromEntries(Object.entries(found[f]).sort(([a], [b]) => a.localeCompare(b)))]),
    );
    const total = (o) => Object.values(o).reduce((a, rules) => a + Object.values(rules).reduce((x, y) => x + y, 0), 0);
    if (update) {
        writeFileSync(baseline, `${JSON.stringify(sorted, null, 4)}\n`);
        console.log(`stylelint: baseline written, ${total(sorted)} known violations in ${Object.keys(sorted).length} of ${results.length} files.`);
        return skipped.length === 0;
    }
    const known = existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : {};
    let grew = 0;
    let shrank = 0;
    for (const file of new Set([...Object.keys(found), ...Object.keys(known)])) {
        for (const rule of new Set([...Object.keys(found[file] ?? {}), ...Object.keys(known[file] ?? {})])) {
            const now = found[file]?.[rule] ?? 0;
            const was = known[file]?.[rule] ?? 0;
            if (now > was) {
                grew++;
                console.error(`stylelint: ${now - was} new "${rule}" in ${file} (${was} known; the file's matches):`);
                print(file, rule);
            } else if (now < was) shrank++;
        }
    }
    if (shrank && !grew) console.error(`stylelint: ${shrank} known violation count(s) went down; shrink the baseline (${updateHint}).`);
    const passed = grew === 0 && shrank === 0 && skipped.length === 0;
    if (passed) console.log(`stylelint: ${results.length} files, no new violations (${total(known)} known, in the baseline).`);
    return passed;
}
