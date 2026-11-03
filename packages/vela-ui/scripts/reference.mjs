// The package's generated reference, read from the source so it cannot drift: every component
// (its declaration, variants, props, the tokens it reads, the attributes its CSS styles by),
// the theme input's JSON Schema, and llms.txt. `build-reference.mjs` writes them into dist/.
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The package's folder. */
export const PACKAGE_ROOT = resolve(import.meta.dirname, '..');

/** The components whose declaration `ComponentDefs` (src/lib/theme.ts) does not list, which
 *  would leave their settings and parts out of the typed theme. */
export function missingDefs(components, root = PACKAGE_ROOT) {
    const theme = readFileSync(join(root, 'src/lib/theme.ts'), 'utf8');
    return components.filter((c) => c.declaration && !theme.includes(`typeof ${c.declaration};`)).map((c) => `${c.component} (typeof ${c.declaration})`);
}

/** Token accessor paths (`fg.muted`, `space.3`) to token names (`fg-muted`), from `t`. */
export function tokenAccessors(t) {
    const out = new Map();
    const walk = (v, path) => {
        if (!v || typeof v !== 'object') return;
        if (typeof v.name === 'string') out.set(path.join('.'), v.name.slice('--vela-'.length));
        for (const [k, sub] of Object.entries(v)) if (k !== 'name' && k !== 'var') walk(sub, [...path, k]);
    };
    walk(t, []);
    return out;
}

const fileComment = (text) => {
    const lines = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('//')) break;
        lines.push(line.replace(/^\/\/ ?/, ''));
    }
    return lines.join(' ').replace(/\s+/g, ' ').trim();
};

const stringsOf = (node) => (node && ts.isArrayLiteralExpression(node) ? node.elements.filter(ts.isStringLiteralLike).map((e) => e.text) : []);

const propName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) || ts.isNumericLiteral(p.name)) ? p.name.text : null);

function callOf(node, name) {
    return node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name ? node : null;
}

/** Every component in `src/components`, from its source. */
export function componentReference(root, accessors) {
    const dir = join(root, 'src/components');
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.ts'))
        .sort();
    const program = ts.createProgram(
        files.map((f) => join(dir, f)),
        { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [] },
    );
    const checker = program.getTypeChecker();
    const readToken = (text) => {
        const m = /^t\.([A-Za-z]+)(?:\.([A-Za-z]+)|\[(\d+)\])?$/.exec(text.trim());
        if (!m) return null;
        const path = m[2] ?? m[3] ? `${m[1]}.${m[2] ?? m[3]}` : m[1];
        return accessors.get(path) ?? null;
    };
    return files.map((file) => {
        const path = join(dir, file);
        const text = readFileSync(path, 'utf8');
        const source = program.getSourceFile(path);
        const entry = { name: file.slice(0, -3), import: `@luxalgo/vela-ui/${file.slice(0, -3)}`, description: fileComment(text) };
        const exportsList = [];
        for (const stmt of source.statements) {
            const exported = ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
            if (!exported) continue;
            if (ts.isVariableStatement(stmt)) {
                for (const decl of stmt.declarationList.declarations) {
                    const id = decl.name.getText(source);
                    exportsList.push(id);
                    const def = callOf(decl.initializer, 'defineComponent');
                    if (def && ts.isObjectLiteralExpression(def.arguments[0])) {
                        const props = Object.fromEntries(def.arguments[0].properties.filter(ts.isPropertyAssignment).map((p) => [propName(p), p.initializer]));
                        const name = props.name && ts.isStringLiteralLike(props.name) ? props.name.text : entry.name;
                        const parts = stringsOf(props.parts);
                        const settings = {};
                        if (props.settings && ts.isObjectLiteralExpression(props.settings)) {
                            for (const p of props.settings.properties.filter(ts.isPropertyAssignment)) {
                                const init = p.initializer;
                                const token = readToken(init.getText(source));
                                settings[propName(p)] = token ? { default: `var(--vela-${token})`, token } : { default: ts.isStringLiteralLike(init) ? init.text : init.getText(source) };
                            }
                        }
                        entry.component = name;
                        entry.declaration = id;
                        entry.parts = Object.fromEntries(parts.map((part) => [part, part === 'root' ? name : `${name}-${part}`]));
                        entry.settings = settings;
                    }
                    const vars = callOf(decl.initializer, 'variants');
                    if (vars && ts.isObjectLiteralExpression(vars.arguments[0])) {
                        entry.variants = Object.fromEntries(vars.arguments[0].properties.filter(ts.isPropertyAssignment).map((p) => [propName(p), stringsOf(p.initializer)]));
                    }
                }
            } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name) {
                exportsList.push(stmt.name.text);
                if (ts.isFunctionDeclaration(stmt) && /^create[A-Z]/.test(stmt.name.text) && !entry.factory) {
                    const param = stmt.parameters[0];
                    entry.factory = stmt.name.text;
                    entry.returns = stmt.type?.getText(source);
                    if (param?.type) {
                        entry.propsType = param.type.getText(source).replace(/<.*>$/, '');
                        const type = checker.getTypeAtLocation(param.type);
                        entry.props = checker.getPropertiesOfType(type).map((sym) => {
                            const decl = sym.valueDeclaration ?? sym.declarations?.[0];
                            const propType = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getDeclaredTypeOfSymbol(sym);
                            const doc = ts.displayPartsToString(sym.getDocumentationComment(checker)).replace(/\s+/g, ' ').trim();
                            return {
                                name: sym.getName(),
                                type: checker.typeToString(checker.getNonNullableType(propType), undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope),
                                required: !(sym.flags & ts.SymbolFlags.Optional),
                                ...(doc ? { doc } : {}),
                            };
                        });
                    }
                }
            }
        }
        entry.exports = exportsList;
        const tokens = new Set(Object.values(entry.settings ?? {}).flatMap((s) => (s.token ? [s.token] : [])));
        for (const m of text.matchAll(/\bt\.([A-Za-z]+)(?:\.([A-Za-z]+)|\[(\d+)\])?/g)) {
            const token = accessors.get(m[2] ?? m[3] ? `${m[1]}.${m[2] ?? m[3]}` : m[1]) ?? accessors.get(m[1]);
            if (token) tokens.add(token);
        }
        entry.tokens = [...tokens].sort();
        const attributes = new Set();
        for (const m of text.matchAll(/\[((?:data|aria)-[a-z-]+)/g)) if (!['data-slot', 'data-variant', 'data-size'].includes(m[1])) attributes.add(m[1]);
        entry.attributes = [...attributes].sort();
        if (entry.factory) {
            const required = (entry.props ?? []).filter((p) => p.required).map((p) => `${p.name}: /* ${p.type} */`);
            const handle = entry.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const args = required.length ? `{ ${required.join(', ')} }` : '';
            entry.example = `import { ${entry.factory} } from '${entry.import}';\n\nconst ${handle} = ${entry.factory}(${args});\nhost.append(${handle}.el);`;
        }
        return entry;
    });
}

const COLOR = { type: 'string', pattern: '^(#[0-9a-fA-F]{3,8}|rgba?\\(.*\\)|var\\(.*\\))$' };
const CHART_FIELDS = ['background', 'textColor', 'gridColor', 'borderColor', 'upColor', 'downColor', 'fontFamily'];

/** The JSON Schema of `createTheme`'s input. */
export function themeSchema(components, tokenNames, version) {
    const byComponent = {};
    for (const c of components) {
        if (!c.component) continue;
        const properties = Object.fromEntries(Object.entries(c.settings).map(([k, s]) => [k, { type: 'string', description: `--vela-${c.component}-${k}, default ${s.default}` }]));
        properties.css = {
            type: 'object',
            additionalProperties: false,
            description: "CSS by part, applied after every layer of the kit. From a file, it applies only when the host passes { allowCss: true }.",
            properties: Object.fromEntries(Object.entries(c.parts).map(([part, slot]) => [part, { type: 'string', description: `[data-slot~="${slot}"]` }])),
        };
        byComponent[c.component] = { type: 'object', additionalProperties: false, properties };
    }
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        title: `@luxalgo/vela-ui ${version} theme`,
        description: 'The input of createTheme. Every field is optional: an empty theme is the dark theme.',
        type: 'object',
        additionalProperties: false,
        properties: {
            $schema: { type: 'string' },
            base: { description: 'The theme to start from.', oneOf: [{ enum: ['dark', 'light'] }, { $ref: '#/$defs/chart' }] },
            colors: {
                description: 'A theme from colors alone: everything else derives from them, light or dark read from the background.',
                type: 'object',
                additionalProperties: false,
                properties: Object.fromEntries(['background', 'text', 'grid', 'border', 'up', 'down', 'accent'].map((k) => [k, COLOR])),
            },
            accent: { ...COLOR, description: 'The brand color; its readable ink derives from it.' },
            radius: { enum: ['none', 'sm', 'md', 'lg'], description: 'Scales every radius token.' },
            font: { type: 'string' },
            tokens: { type: 'object', additionalProperties: false, properties: Object.fromEntries(tokenNames.map((n) => [n, { type: 'string', description: `--vela-${n}` }])) },
            components: { type: 'object', additionalProperties: false, properties: byComponent },
        },
        $defs: {
            chart: {
                type: 'object',
                additionalProperties: false,
                required: CHART_FIELDS,
                properties: Object.fromEntries(CHART_FIELDS.map((k) => [k, k === 'fontFamily' ? { type: 'string' } : COLOR])),
            },
        },
    };
}

/** llms.txt: what the package is, and where each answer lives. */
export function llmsTxt(components, version) {
    const list = components
        .map((c) => `- ${c.factory ?? c.exports[0]} (\`${c.import}\`): ${c.description.split('. ')[0].replace(/\.$/, '')}.`)
        .join('\n');
    return `# @luxalgo/vela-ui ${version}

> The component kit of Vela: one file per component, Zag state machines for behavior, CSS in
> cascade layers over design tokens, and one typed theme config.

Every component is a function, \`create<Name>(props)\`, imported from its own path, that returns
a handle with \`el\` (the element to append) and \`destroy()\`. Every part of a component carries
a \`data-slot\`; variants and sizes are \`data-variant\` and \`data-size\`.

## Reference (in this package)

- [Components](dist/manifest.json): every component's import, props, variants, parts and
  their slots, settings, the tokens it reads, the attributes its CSS styles by, an example.
- [Theme schema](dist/theme.schema.json): the JSON Schema of a theme written to a file.
- [Theming](docs/theming.md): createTheme, applyTheme, colors-only themes, component settings
  and part CSS.
- [What to change, and where](docs/what-to-change.md): one table, a kind of change per row.
- [Writing a component](docs/writing-a-component.md): the one-file shape and its rules.
- Plain CSS themes: \`dist/themes/dark.css\`, \`dist/themes/light.css\`.
- Command line: \`npx @luxalgo/vela-ui add <component>\` prints its import, \`--source\` copies it
  as a component of the project's own, \`check\` validates the project (see README.md).

## Components

${list}
`;
}
