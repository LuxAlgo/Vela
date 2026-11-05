// Checks the agent skills both packages ship (skills/*/SKILL.md): the Agent Skills
// specification's frontmatter rules, a body short enough to load whole, and every
// node_modules/@luxalgo/... path a skill points an agent at existing in, and shipping with, its
// package. `node scripts/check-skills.mjs` prints the problems; the test suite runs it too.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = { '@luxalgo/vela': ROOT, '@luxalgo/vela-ui': join(ROOT, 'packages/vela-ui') };
const MAX_BODY_LINES = 500;

/** Every skill folder: `skills/<name>` at the repo root and in the kit. */
export function skillDirs(root = ROOT) {
    return [join(root, 'skills'), join(root, 'packages/vela-ui/skills')]
        .filter((d) => existsSync(d))
        .flatMap((d) => readdirSync(d).map((name) => join(d, name)))
        .filter((d) => existsSync(join(d, 'SKILL.md')));
}

function frontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (!m) return null;
    const fields = {};
    for (const line of m[1].split(/\r?\n/)) {
        const f = /^([a-z-]+):\s*(.*)$/.exec(line);
        if (f) fields[f[1]] = f[2].trim();
    }
    return { fields, body: m[2] };
}

/** The problems with every skill, as `skills/<name>: <problem>` lines (empty when all is well). */
export function checkSkills(root = ROOT) {
    const problems = [];
    for (const dir of skillDirs(root)) {
        const folder = dir.split(/[\\/]/).pop();
        const where = dir.slice(root.length + 1).replace(/\\/g, '/');
        const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
        const parsed = frontmatter(text);
        if (!parsed) {
            problems.push(`${where}: SKILL.md has no frontmatter`);
            continue;
        }
        const { name = '', description = '' } = parsed.fields;
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) problems.push(`${where}: name "${name}" must be 1-64 lowercase letters, digits and single hyphens`);
        if (name !== folder) problems.push(`${where}: name "${name}" must match its folder "${folder}"`);
        if (/anthropic|claude/.test(name)) problems.push(`${where}: name "${name}" uses a reserved word`);
        if (!description) problems.push(`${where}: description is empty`);
        if (description.length > 1024) problems.push(`${where}: description is ${description.length} characters (at most 1024)`);
        if (/[<>]/.test(description)) problems.push(`${where}: description must not contain XML tags`);
        if (!/\bUse when\b/.test(description)) problems.push(`${where}: description must say when to use the skill ("Use when …")`);
        const lines = parsed.body.split(/\r?\n/).length;
        if (lines > MAX_BODY_LINES) problems.push(`${where}: body is ${lines} lines (at most ${MAX_BODY_LINES}; move detail into references/)`);
        if (/node_modules\\/.test(text)) problems.push(`${where}: use forward slashes in paths`);
        for (const m of text.matchAll(/node_modules\/(@luxalgo\/vela(?:-ui)?)\/([\w./*<>-]+)/g)) {
            const [, pkg, rest] = m;
            const path = rest.replace(/[.,:;)]+$/, '');
            const pkgRoot = PACKAGES[pkg];
            const top = path.split('/')[0];
            const files = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).files ?? [];
            if (!files.some((f) => f.replace(/\/$/, '') === top)) problems.push(`${where}: ${pkg}/${path} is not in the package's files, so it does not ship`);
            const concrete = path.split(/[*<]/)[0].replace(/\/$/, '');
            if (concrete && !existsSync(join(pkgRoot, concrete))) problems.push(`${where}: ${pkg}/${concrete} does not exist`);
        }
        for (const m of parsed.body.matchAll(/\]\(([^)\s]+)\)/g)) {
            const link = m[1];
            if (/^(https?:|#)/.test(link)) continue;
            if (!existsSync(join(dir, link.split('#')[0]))) problems.push(`${where}: broken link ${link}`);
        }
    }
    return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const dirs = skillDirs();
    const problems = checkSkills();
    console.log(`${dirs.length} skills checked`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(problems.length ? 1 : 0);
}
