// The vela-ui CLI's engine, exported (`@luxalgo/vela-ui/cli`) so another CLI can reuse it: the
// catalog (the manifest and registry this package ships), dependency checks, source copies
// with their lock and base files, upstream diffs, and the project check.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const PACKAGE = '@luxalgo/vela-ui';
export const CONFIG_FILE = 'vela-ui.json';
export const LOCK_FILE = 'vela-ui.lock.json';
/** Where each copy's upstream version is kept, the base `diff` compares against. */
export const BASE_DIR = '.vela-ui';

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/** The catalog a command reads: this package, or a checkout's (`--from`). */
export function readCatalog(from) {
    const own = resolve(import.meta.dirname, '..');
    const root = from ? (existsSync(join(from, 'packages/vela-ui/package.json')) ? join(from, 'packages/vela-ui') : resolve(from)) : own;
    const manifestPath = join(root, 'dist/manifest.json');
    if (!existsSync(manifestPath)) throw new Error(`No manifest at ${manifestPath}: build the package first (npm run build -w ${PACKAGE}).`);
    const { version } = readJson(join(root, 'package.json'));
    return { root, version, manifest: readJson(manifestPath) };
}

/** A catalog item by its file name or its component name. */
export function findItem(catalog, name) {
    return catalog.manifest.components.find((c) => c.name === name || c.component === name) ?? null;
}

export function detectPackageManager(cwd) {
    if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
    if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
    if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
    return 'npm';
}

export function installCommand(pm, spec) {
    return pm === 'npm' ? `npm install ${spec}` : `${pm} add ${spec}`;
}

/** Whether the project lists the package itself (pnpm only lets a project import those). */
export function isDirectDependency(cwd) {
    const pkg = readJson(join(cwd, 'package.json'), {});
    return Boolean(pkg.dependencies?.[PACKAGE] ?? pkg.devDependencies?.[PACKAGE] ?? pkg.peerDependencies?.[PACKAGE]);
}

export function readConfig(cwd) {
    return readJson(join(cwd, CONFIG_FILE), {});
}

/** The folder copies go to: `aliases.ui`, a path or a package.json `imports` alias (`#ui`). */
export function copyFolder(cwd, config = readConfig(cwd)) {
    const alias = config.aliases?.ui ?? 'src/ui';
    if (!alias.startsWith('#')) return resolve(cwd, alias);
    const imports = readJson(join(cwd, 'package.json'), {}).imports ?? {};
    const target = imports[`${alias}/*`];
    const path = typeof target === 'string' ? target : target?.default;
    if (!path) throw new Error(`${CONFIG_FILE} sends copies to ${alias}, but package.json has no "imports" entry for "${alias}/*".`);
    return resolve(cwd, path.slice(0, path.indexOf('*')).replace(/\/$/, ''));
}

/** A component's source under a new name: its parts, its settings' variables and its sheet
 *  follow the name, so the copy and the package's component never style each other. */
export function renameComponent(source, from, to) {
    if (from === to) return source;
    // Component names are lowercase words joined by dashes: nothing in them needs escaping.
    for (const name of [from, to]) if (!COMPONENT_NAME.test(name)) throw new Error(`"${name}" is not a component name (lowercase words joined by dashes).`);
    return source
        .replace(new RegExp(`(name:\\s*)(['"])${from}\\2`), `$1$2${to}$2`)
        .replace(new RegExp(`(\\[data-slot~?=)(['"])${from}(?=['"-])`, 'g'), `$1$2${to}`)
        .replace(new RegExp(`(['"])vela-ui-${from}\\1`, 'g'), `$1vela-ui-${to}$1`);
}

export const COMPONENT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The registry file of an item, renamed. */
export function itemSource(catalog, item, as) {
    const path = join(catalog.root, 'registry', `${item.name}.ts`);
    if (!existsSync(path)) throw new Error(`No registry file for ${item.name} in ${catalog.root}: build the package first.`);
    return renameComponent(readFileSync(path, 'utf8'), item.component ?? item.name, as);
}

/** Copy an item's source into the project, recording it in the lock and keeping its base. */
export function copyItem({ cwd, catalog, item, as, force = false }) {
    const folder = copyFolder(cwd);
    const file = join(folder, `${as}.ts`);
    if (existsSync(file) && !force) throw new Error(`${relative(cwd, file)} exists. Pass --force to overwrite it, or --as <name> for another copy.`);
    const source = itemSource(catalog, item, as);
    const header = `// Copied from ${PACKAGE} ${catalog.version} (${item.name}) by \`vela-ui add --source\`. Yours to change;\n// \`vela-ui diff ${as}\` shows what changed upstream since.\n`;
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, header + source);
    mkdirSync(join(cwd, BASE_DIR), { recursive: true });
    writeFileSync(join(cwd, BASE_DIR, `${as}.ts`), source);
    const lock = readJson(join(cwd, LOCK_FILE), { items: {} });
    lock.items[as] = { item: item.name, version: catalog.version, file: relative(cwd, file).split('\\').join('/') };
    writeJson(join(cwd, LOCK_FILE), lock);
    return { file };
}

/** Line diff (longest common subsequence), as unified hunks with `context` lines around. */
export function diffLines(before, after, context = 3) {
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    const n = a.length;
    const m = b.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) {
            ops.push(` ${a[i]}`);
            i += 1;
            j += 1;
        } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(`-${a[i++]}`);
        else ops.push(`+${b[j++]}`);
    }
    const shown = new Uint8Array(ops.length);
    ops.forEach((op, k) => {
        if (op[0] !== ' ') for (let c = Math.max(0, k - context); c <= Math.min(ops.length - 1, k + context); c += 1) shown[c] = 1;
    });
    const out = [];
    ops.forEach((op, k) => {
        if (!shown[k]) return;
        if (k > 0 && !shown[k - 1] && out.length) out.push('@@');
        out.push(op);
    });
    return out.join('\n');
}

/** What changed upstream since a copy was made: its base against the catalog's version. */
export function upstreamDiff({ cwd, catalog, as }) {
    const entry = readJson(join(cwd, LOCK_FILE), { items: {} }).items[as];
    if (!entry) throw new Error(`${as} is not a copy recorded in ${LOCK_FILE}.`);
    const item = findItem(catalog, entry.item);
    if (!item) throw new Error(`${entry.item} is no longer in ${PACKAGE} ${catalog.version}.`);
    const base = readFileSync(join(cwd, BASE_DIR, `${as}.ts`), 'utf8');
    const next = itemSource(catalog, item, as);
    return { entry, base, next, diff: base === next ? '' : diffLines(base, next) };
}

/** Record that a copy has taken the upstream changes in: its base and version move up. */
export function acceptUpstream({ cwd, catalog, as }) {
    const { next } = upstreamDiff({ cwd, catalog, as });
    writeFileSync(join(cwd, BASE_DIR, `${as}.ts`), next);
    const lock = readJson(join(cwd, LOCK_FILE), { items: {} });
    lock.items[as].version = catalog.version;
    writeJson(join(cwd, LOCK_FILE), lock);
}

const MARK_BEGIN = '<!-- BEGIN:vela-ui-agent-rules -->';
const MARK_END = '<!-- END:vela-ui-agent-rules -->';

export function agentsBlock() {
    return `${MARK_BEGIN}
## ${PACKAGE}

Before writing UI with \`${PACKAGE}\`, read \`node_modules/${PACKAGE}/llms.txt\`: it indexes the
component manifest, the theme schema and the guides of the installed version. Themes go
through \`createTheme\`; restyle a component through its parts, never its class names.
${MARK_END}
`;
}

export function hasAgentsBlock(cwd) {
    const path = join(cwd, 'AGENTS.md');
    return existsSync(path) && readFileSync(path, 'utf8').includes(MARK_BEGIN);
}

export function writeAgentsBlock(cwd) {
    const path = join(cwd, 'AGENTS.md');
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (text.includes(MARK_BEGIN)) return false;
    writeFileSync(path, `${text}${text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : ''}${agentsBlock()}`);
    return true;
}

/** Every installed copy of the package under the project's node_modules. */
export function installedCopies(cwd) {
    const found = [];
    const visit = (dir, depth) => {
        if (depth > 5 || !existsSync(dir)) return;
        const own = join(dir, '@luxalgo', 'vela-ui', 'package.json');
        if (existsSync(own)) found.push({ path: dirname(own), version: readJson(own).version });
        for (const name of readdirSync(dir)) {
            if (name === '.bin') continue;
            const sub = join(dir, name);
            if (name.startsWith('@')) {
                for (const inner of existsSync(sub) ? readdirSync(sub) : []) visit(join(sub, inner, 'node_modules'), depth + 1);
            } else if (name === '.pnpm') {
                for (const inner of readdirSync(sub)) if (inner.startsWith('@luxalgo+vela-ui@')) visit(join(sub, inner, 'node_modules'), depth + 1);
            } else visit(join(sub, 'node_modules'), depth + 1);
        }
    };
    visit(join(cwd, 'node_modules'), 0);
    const seen = new Set();
    return found.filter((c) => !seen.has(c.path) && seen.add(c.path));
}

const compareVersions = (x, y) => {
    const p = (v) => v.split(/[.-]/).map((s) => (Number.isNaN(Number(s)) ? 0 : Number(s)));
    const [a, b] = [p(x), p(y)];
    for (let k = 0; k < Math.max(a.length, b.length); k += 1) if ((a[k] ?? 0) !== (b[k] ?? 0)) return (a[k] ?? 0) - (b[k] ?? 0);
    return 0;
};

/** Validates a value against the subset of JSON Schema the theme schema uses. */
export function validate(schema, value, root = schema, at = '') {
    if (schema.$ref) return validate(schema.$ref.slice(2).split('/').reduce((s, k) => s[k], root), value, root, at);
    if (schema.oneOf) {
        const ok = schema.oneOf.filter((s) => validate(s, value, root, at).length === 0);
        return ok.length === 1 ? [] : [`${at || '/'}: matches ${ok.length} of the allowed shapes, not one`];
    }
    if (schema.enum && !schema.enum.includes(value)) return [`${at || '/'}: must be one of ${schema.enum.join(', ')}`];
    if (schema.type === 'string') {
        if (typeof value !== 'string') return [`${at}: must be a string`];
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) return [`${at}: "${value}" is not a color (#rrggbb, rgb() or var())`];
        return [];
    }
    if (schema.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${at || '/'}: must be an object`];
        const errors = [];
        for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${at}/${key}: is required`);
        for (const [key, v] of Object.entries(value)) {
            const sub = schema.properties?.[key];
            if (sub) errors.push(...validate(sub, v, root, `${at}/${key}`));
            else if (schema.additionalProperties === false) errors.push(`${at}/${key}: is not a known field`);
        }
        return errors;
    }
    return [];
}

/** The project's health: one copy of the package, copies of components not behind it, and
 *  the theme file valid (against the schema, then `checkTheme`, the package's own, when
 *  given). Each finding is `{ level: 'error' | 'warn', text }`. */
// The caller loads `checkTheme`: a computed `import()` in this file hangs Vite's SSR
// transform, which the tests load it through.
export function checkProject({ cwd, catalog, checkTheme }) {
    const findings = [];
    const copies = installedCopies(cwd);
    const versions = [...new Set(copies.map((c) => c.version))];
    if (copies.length === 0) findings.push({ level: 'error', text: `${PACKAGE} is not installed (${installCommand(detectPackageManager(cwd), PACKAGE)}).` });
    else if (copies.length > 1)
        findings.push({ level: 'error', text: `${copies.length} copies of ${PACKAGE} are installed (${versions.join(', ')}): a page would carry every component twice. Align the versions that depend on it.\n${copies.map((c) => `  ${relative(cwd, c.path)} ${c.version}`).join('\n')}` });
    if (copies.length && !isDirectDependency(cwd)) findings.push({ level: 'warn', text: `${PACKAGE} is installed but not a direct dependency; pnpm will not let the project import it.` });
    const installed = copies[0]?.version ?? catalog.version;
    const lock = readJson(join(cwd, LOCK_FILE), { items: {} });
    for (const [as, entry] of Object.entries(lock.items)) {
        if (!existsSync(join(cwd, entry.file))) findings.push({ level: 'warn', text: `${as}: ${entry.file} is gone; remove it from ${LOCK_FILE}.` });
        else if (compareVersions(entry.version, installed) < 0) findings.push({ level: 'warn', text: `${as} was copied from ${entry.version}; ${installed} is installed. \`vela-ui diff ${as}\` shows what changed.` });
    }
    const config = readConfig(cwd);
    if (config.theme) {
        const themeFile = resolve(cwd, config.theme);
        if (!existsSync(themeFile)) findings.push({ level: 'error', text: `The theme file ${config.theme} does not exist.` });
        else {
            let input;
            try {
                input = JSON.parse(readFileSync(themeFile, 'utf8'));
            } catch (e) {
                findings.push({ level: 'error', text: `${config.theme} is not valid JSON: ${e.message}` });
            }
            if (input) {
                const schema = readJson(join(catalog.root, 'dist/theme.schema.json'));
                for (const text of validate(schema, input)) findings.push({ level: 'error', text: `${config.theme}${text}` });
                const theme = { ...input };
                delete theme.$schema;
                for (const text of checkTheme?.(theme) ?? []) findings.push({ level: 'warn', text: `${config.theme}: ${text}` });
            }
        }
    }
    return findings;
}
