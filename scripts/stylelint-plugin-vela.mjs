// Stylelint rules for kit component CSS (the `css` templates of src/ui/components/*.ts,
// parsed by postcss-lit, which turns each `${…}` into a POSTCSS_LIT_<n> placeholder and keeps
// the expression's text).
import stylelint from 'stylelint';

const {
    createPlugin,
    utils: { report, ruleMessages, validateOptions },
} = stylelint;

const isString = (v) => typeof v === 'string';

/** The source text of the `${…}` a placeholder stands for, or null. */
function expressionOf(node, value) {
    const m = /^POSTCSS_LIT_(\d+)$/.exec(value.trim());
    if (!m) return null;
    const text = node.root().raws.litTemplateExpressions?.[Number(m[1])];
    return typeof text === 'string' ? text.replace(/^\$\{/, '').replace(/\}$/, '').trim() : null;
}

/** The whole file a template came from (postcss-lit keeps it on the document). */
function fileSource(root) {
    return root.document?.source?.input?.css ?? root.source?.input?.css ?? '';
}

const insideRule = (node) => {
    for (let p = node.parent; p; p = p.parent) if (p.type === 'rule') return true;
    return false;
};

/** A `from` / `to` / percentage step of an `@keyframes` block, not a selector. */
const keyframeStep = (rule) => rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name);

// vela/layer: every rule sits inside `@layer <name>`, and no other layer opens a block.
const layerName = 'vela/layer';
const layerMessages = ruleMessages(layerName, {
    outside: (layer) => `Put component CSS inside "@layer ${layer} { … }"`,
    other: (found, layer) => `Use "@layer ${layer}", not "@layer ${found}"`,
});
const layer = createPlugin(layerName, (expected) => (root, result) => {
    if (!validateOptions(result, layerName, { actual: expected, possible: [isString] })) return;
    root.walkAtRules('layer', (at) => {
        if (at.nodes && at.params.trim() !== expected) report({ ruleName: layerName, result, node: at, message: layerMessages.other(at.params.trim(), expected) });
    });
    root.walkRules((rule) => {
        let inLayer = false;
        for (let p = rule.parent; p; p = p.parent) if (p.type === 'atrule' && p.name === 'layer' && p.params.trim() === expected) inLayer = true;
        if (!inLayer) report({ ruleName: layerName, result, node: rule, message: layerMessages.outside(expected) });
    });
});

// vela/slot-scope: a top-level selector starts with one of the component's own parts,
// `[data-slot='<name>']` or `[data-slot='<name>-<part>']`, as its `defineComponent` declares.
const slotName = 'vela/slot-scope';
const slotMessages = ruleMessages(slotName, {
    noDef: () => 'Declare the component with defineComponent({ name, parts }) in the same file',
    scope: (selector, allowed) => `Start "${selector}" with one of the component's parts: ${allowed.map((s) => `[data-slot='${s}']`).join(', ')}`,
});
const slotScope = createPlugin(slotName, (enabled) => (root, result) => {
    if (!validateOptions(result, slotName, { actual: enabled, possible: [true] })) return;
    const def = /defineComponent\(\s*\{\s*name:\s*'([a-z0-9-]+)',\s*parts:\s*\[([^\]]*)\]/s.exec(fileSource(root));
    if (!def) {
        const first = root.first;
        if (first) report({ ruleName: slotName, result, node: first, message: slotMessages.noDef() });
        return;
    }
    const name = def[1];
    const parts = [...def[2].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    const allowed = parts.map((p) => (p === 'root' ? name : `${name}-${p}`));
    root.walkRules((rule) => {
        if (insideRule(rule) || keyframeStep(rule)) return;
        for (const selector of rule.selectors) {
            const m = /^\[data-slot='([a-z0-9-]+)'\]/.exec(selector.trim());
            if (!m || !allowed.includes(m[1])) report({ ruleName: slotName, result, node: rule, message: slotMessages.scope(selector.trim(), allowed) });
        }
    });
});

// vela/token-values: the properties a theme owns take a token (`${t.…}`) or one of the
// component's settings (`${<name>Def.vars.…}`), never a literal.
const tokenName = 'vela/token-values';
const tokenMessages = ruleMessages(tokenName, {
    literal: (prop, value) => `"${prop}: ${value}": use a token (\${t.…}) or a component setting (\${…Def.vars.…})`,
});
const TOKEN_PROPS = /^(z-index|font-family|box-shadow|border-radius|border-(top|bottom|start|end)-(left|right|start|end)-radius)$/;
// Pills and circles are shapes, not theme choices.
const KEYWORDS = new Set(['0', 'none', 'inherit', 'initial', 'unset', 'revert', 'auto', '999px', '50%']);
const tokenValues = createPlugin(tokenName, (enabled) => (root, result) => {
    if (!validateOptions(result, tokenName, { actual: enabled, possible: [true] })) return;
    root.walkDecls((decl) => {
        if (!TOKEN_PROPS.test(decl.prop)) return;
        const value = decl.value.trim();
        if (KEYWORDS.has(value)) return;
        const expr = expressionOf(decl, value);
        if (expr && (/^t\./.test(expr) || /^\w+Def\.vars(\.|\[)/.test(expr))) return;
        report({ ruleName: tokenName, result, node: decl, message: tokenMessages.literal(decl.prop, value) });
    });
});

// vela/no-raw-token-var: tokens are read through `t` (a typo then fails the typecheck), never
// as hand-written `var(--vela-…)`; component CSS defines no `--vela-*` property either.
const rawName = 'vela/no-raw-token-var';
const rawMessages = ruleMessages(rawName, {
    raw: () => 'Read tokens through t (`${t.radius.md}`), not as var(--vela-…)',
    define: (prop) => `"${prop}": component CSS does not define --vela-* properties (a theme or a host's CSS sets them)`,
});
const noRawTokenVar = createPlugin(rawName, (enabled) => (root, result) => {
    if (!validateOptions(result, rawName, { actual: enabled, possible: [true] })) return;
    root.walkDecls((decl) => {
        if (decl.prop.startsWith('--vela-')) report({ ruleName: rawName, result, node: decl, message: rawMessages.define(decl.prop) });
        else if (decl.value.includes('var(--vela-')) report({ ruleName: rawName, result, node: decl, message: rawMessages.raw() });
    });
});

export default [layer, slotScope, tokenValues, noRawTokenVar];
