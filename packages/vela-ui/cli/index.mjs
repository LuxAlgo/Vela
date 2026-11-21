#!/usr/bin/env node
// vela-ui: add a component to a project, copy its source for a variant of your own, see what
// changed upstream since, and check the project.
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as engine from './engine.mjs';

const USAGE = `Usage: vela-ui <command> [options]

  list                        the components
  add <component>             make ${engine.PACKAGE} a direct dependency and print the import
  add <component> --source    copy the component's source, for a variant of your own
      --as <name>             the copy's component name (default: app-<component>)
      --force                 overwrite an existing copy
  diff <copy>                 what changed upstream since the copy was made
      --accept                record that the copy has taken those changes in
  check                       one copy of the package, no copy behind it, the theme file valid

  --cwd <path>                the project (default: the current folder)
  --from <path>               read the catalog from a checkout instead of this package
  --agents                    add the note for coding agents to AGENTS.md without asking
  --no-install                print the install command instead of running it`;

const say = (text = '') => process.stdout.write(`${text}\n`);
const fail = (text) => {
    process.stderr.write(`vela-ui: ${text}\n`);
    process.exit(1);
};

let parsed;
try {
    parsed = parseArgs({
        allowPositionals: true,
        options: {
            source: { type: 'boolean' },
            as: { type: 'string' },
            force: { type: 'boolean' },
            accept: { type: 'boolean' },
            from: { type: 'string' },
            cwd: { type: 'string' },
            agents: { type: 'boolean' },
            'no-install': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
    });
} catch (e) {
    fail(`${e.message}\n\n${USAGE}`);
}
const { values, positionals } = parsed;
const [command, name] = positionals;
if (!command || values.help) {
    say(USAGE);
    process.exit(command || values.help ? 0 : 1);
}

const cwd = resolve(values.cwd ?? process.cwd());
let catalog;
try {
    catalog = engine.readCatalog(values.from);
} catch (e) {
    fail(e.message);
}

async function offerAgentsNote() {
    if (engine.hasAgentsBlock(cwd)) return;
    let yes = values.agents === true;
    if (!yes && process.stdin.isTTY) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question('Add a note to AGENTS.md pointing coding agents at the kit\'s reference? [Y/n] ');
        rl.close();
        yes = !/^n/i.test(answer.trim());
    }
    if (yes) {
        engine.writeAgentsBlock(cwd);
        say('Added the note to AGENTS.md.');
    } else if (!process.stdin.isTTY) say('Tip: `vela-ui add <component> --agents` adds a note to AGENTS.md pointing coding agents at the kit\'s reference.');
}

function ensureDependency() {
    if (engine.isDirectDependency(cwd)) return;
    const cmd = engine.installCommand(engine.detectPackageManager(cwd), `${engine.PACKAGE}@^${catalog.version}`);
    if (values['no-install']) {
        say(`${engine.PACKAGE} is not a dependency of this project yet: ${cmd}`);
        return;
    }
    say(`$ ${cmd}`);
    const run = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
    if (run.status !== 0) fail(`the install failed (${cmd}).`);
}

switch (command) {
    case 'list': {
        for (const c of catalog.manifest.components) say(`${c.name.padEnd(16)} ${c.factory ?? ''}`.trimEnd());
        break;
    }
    case 'add': {
        if (!name) fail('add needs a component: `vela-ui list` shows them.');
        const item = engine.findItem(catalog, name);
        if (!item) fail(`no component "${name}" in ${engine.PACKAGE} ${catalog.version}: \`vela-ui list\` shows them.`);
        ensureDependency();
        const factory = item.factory ?? item.exports[0];
        if (values.source) {
            const as = values.as ?? `app-${item.component ?? item.name}`;
            if (!/^[a-z][a-z0-9-]*$/.test(as)) fail(`--as takes a lowercase name with dashes ("${as}").`);
            let file;
            try {
                ({ file } = engine.copyItem({ cwd, catalog, item, as, force: values.force }));
            } catch (e) {
                fail(e.message);
            }
            const alias = engine.readConfig(cwd).aliases?.ui;
            const from = alias?.startsWith('#') ? `${alias}/${as}` : `./${relative(cwd, file).split('\\').join('/').replace(/\.ts$/, '')}`;
            say(`Copied ${item.name} to ${relative(cwd, file)}, as the component "${as}" (its parts are data-slot="${as}…").`);
            say(`Vela and the plugins keep rendering the package's ${item.name}.`);
            say();
            say(`import { ${factory} } from '${from}';`);
        } else {
            say(item.example ?? `import { ${factory} } from '${item.import}';`);
        }
        await offerAgentsNote();
        break;
    }
    case 'diff': {
        if (!name) fail('diff needs a copy: the names are in vela-ui.lock.json.');
        try {
            const { entry, diff } = engine.upstreamDiff({ cwd, catalog, as: name });
            if (!diff) say(`${name}: no change upstream since ${entry.version}.`);
            else {
                say(`${name}: ${entry.item}, ${entry.version} -> ${catalog.version} (- upstream when copied, + upstream now)\n`);
                say(diff);
            }
            if (values.accept) {
                engine.acceptUpstream({ cwd, catalog, as: name });
                say(`\nRecorded ${name} as up to date with ${catalog.version}.`);
            }
        } catch (e) {
            fail(e.message);
        }
        break;
    }
    case 'check': {
        const { checkTheme } = await import(pathToFileURL(join(catalog.root, 'dist/theme.js')).href);
        const findings = engine.checkProject({ cwd, catalog, checkTheme });
        if (!findings.length) say('vela-ui check: all good.');
        for (const f of findings) say(`${f.level === 'error' ? 'error' : 'warn '}  ${f.text}`);
        process.exit(findings.some((f) => f.level === 'error') ? 1 : 0);
        break;
    }
    default:
        fail(`unknown command "${command}".\n\n${USAGE}`);
}
