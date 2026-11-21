// @vitest-environment jsdom
// The kit styles its parts by `data-slot`, and a page's own components carry the same names
// (shadcn's select-trigger, popover-content, switch, button…). The kit's rules reach its own
// elements only: those of a kit host, its floating layers and themed hosts.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom lays nothing out; an open select list scrolls its checked option into view.
Element.prototype.scrollIntoView ??= function () {};

import { createBadge } from '@luxalgo/vela-ui/badge';
import { createButton } from '@luxalgo/vela-ui/button';
import { createCheckbox } from '@luxalgo/vela-ui/checkbox';
import { createDialog } from '@luxalgo/vela-ui/dialog';
import { createDropdownMenu } from '@luxalgo/vela-ui/dropdown-menu';
import { createEmpty } from '@luxalgo/vela-ui/empty';
import { createInput } from '@luxalgo/vela-ui/input';
import { createKbd } from '@luxalgo/vela-ui/kbd';
import { createNumberInput } from '@luxalgo/vela-ui/number-input';
import { createSelect } from '@luxalgo/vela-ui/select';
import { createFigure } from '@luxalgo/vela-ui/figure';
import { createSwitch } from '@luxalgo/vela-ui/switch';
import { createTabs } from '@luxalgo/vela-ui/tabs';
import { createTextArea } from '@luxalgo/vela-ui/text-area';
import { createToggleGroup } from '@luxalgo/vela-ui/toggle-group';
import { createTheme, ensureUIHost } from '@luxalgo/vela-ui/theme';
import { KIT_SCOPE, scopeToKit } from '@luxalgo/vela-ui/scope';
import { flattenTemplates } from '../scripts/flatten-css.mjs';
// @ts-expect-error -- a test helper, plain JavaScript
import { componentSheets, parseStrictly } from './support/kit-sheets.mjs';

beforeAll(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => document.body.replaceChildren());

/** The style rules of the kit's sheets that key on a part, wherever they are nested. */
function partRules(): CSSStyleRule[] {
    const rules: CSSStyleRule[] = [];
    const walk = (list: CSSRuleList): void => {
        for (const rule of Array.from(list)) {
            if ('selectorText' in rule) {
                const style = rule as CSSStyleRule;
                if (style.selectorText.includes('data-slot')) rules.push(style);
            } else if ('cssRules' in rule && !('appendRule' in rule)) {
                walk((rule as CSSGroupingRule).cssRules);
            }
        }
    };
    for (const style of document.querySelectorAll<HTMLStyleElement>('style[id^="vela-ui-"]')) if (style.sheet) walk(style.sheet.cssRules);
    return rules;
}

/** How many elements of `root`'s subtree, `root` included, `rule` styles (a pseudo-element
 *  styles a box of its element). */
function styled(rule: CSSStyleRule, root: Element): number {
    const selector = rule.selectorText.replace(/::?(?:-webkit-[\w-]+|before|after|placeholder|selection|backdrop)(?![\w-])(?:\([^)]*\))?/g, '');
    return (root.matches(selector) ? 1 : 0) + root.querySelectorAll(selector).length;
}

/** A kit host showing many components, their floating layers open inside it. */
function renderKit(): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    ensureUIHost(host, createTheme());
    const select = createSelect({ options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], value: 'a', name: 'pick' });
    const compact = createSelect({ options: [{ value: '1', label: 'One' }], size: 'sm' });
    const menuTrigger = createButton({ text: 'Menu', variant: 'outline', icon: 'chevron-down' });
    host.append(
        select.el,
        compact.el,
        menuTrigger.el,
        createSwitch({ checked: true }).el,
        createCheckbox({ checked: true }).el,
        createBadge({ text: 'New' }).el,
        createKbd({ text: 'K' }).el,
        createTabs({ items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }).el,
        createToggleGroup({ items: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }).el,
        createInput({ value: 'text' }).el,
        createTextArea({ value: 'notes' }).el,
        createNumberInput({ value: 1 }).el,
        createEmpty({ title: 'Nothing yet', description: 'Add one' }).el,
        createFigure({ label: 'P&L', value: '+1' }).el,
    );
    select.el.querySelector('button')!.click();
    createDialog({ title: 'Settings', host, content: createButton({ text: 'Apply' }).el }).show();
    createDropdownMenu({ items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two', separatorBefore: true }], trigger: menuTrigger.el, host }).open();
    return host;
}

/** The page's own components: the kit's markup, parts and nesting, outside any kit host. */
function pageCopy(host: HTMLElement): HTMLElement {
    const page = host.cloneNode(true) as HTMLElement;
    for (const el of [page, ...page.querySelectorAll('*')]) {
        el.classList.remove('vela-ui', 'vela-ui-layer');
        el.removeAttribute('data-vela-theme');
    }
    document.body.append(page);
    return page;
}

const S = KIT_SCOPE;

describe('scopeToKit', () => {
    it('joins the scope to the first compound of each top-level selector', () => {
        expect(scopeToKit("[data-slot='select-trigger'] { height: 34px; }")).toBe(`[data-slot='select-trigger']${S} { height: 34px; }`);
        expect(scopeToKit('[data-slot=a]:hover,[data-slot=b][data-x]>span{color:red}')).toBe(`[data-slot=a]:hover${S}, [data-slot=b][data-x]${S}>span{color:red}`);
        expect(scopeToKit("[data-slot='switch'][data-state='checked'] [data-slot='switch-thumb'] { left: 0; }")).toBe(
            `[data-slot='switch'][data-state='checked']${S} [data-slot='switch-thumb'] { left: 0; }`,
        );
        expect(scopeToKit("[data-slot~='select-content']:not([data-x] > *) ~ [data-slot=y] { gap: 0; }")).toBe(`[data-slot~='select-content']:not([data-x] > *)${S} ~ [data-slot=y] { gap: 0; }`);
    });

    it('puts the scope ahead of a pseudo-element', () => {
        expect(scopeToKit('[data-slot=a]::-webkit-scrollbar{display:none}[data-slot=b]:after{content:""}')).toBe(`[data-slot=a]${S}::-webkit-scrollbar{display:none}[data-slot=b]${S}:after{content:""}`);
        expect(scopeToKit("[data-slot='a'][data-scroll] [data-slot='b']::-webkit-scrollbar { width: 0; }")).toBe(`[data-slot='a'][data-scroll]${S} [data-slot='b']::-webkit-scrollbar { width: 0; }`);
    });

    it('leaves nested rules to their parent', () => {
        const nested = "@layer vela.ui {\n    [data-slot='a'] {\n        color: red;\n        &:hover { color: blue; }\n        & svg { width: 1px; }\n        > b { margin: 0; }\n    }\n}";
        expect(scopeToKit(nested)).toBe(nested.replace("[data-slot='a'] {", `[data-slot='a']${S} {`));
    });

    it('scopes the rules of @layer, @media and @supports blocks, never @keyframes steps', () => {
        const sheet = '@layer x, y; @media (hover: hover) { [data-slot=a] { color: red; } } @supports (display: grid) { [data-slot=b] { display: grid; } } @keyframes pop { from { opacity: 0; } to { opacity: 1; } }';
        expect(scopeToKit(sheet)).toBe(sheet.replace('[data-slot=a]', `[data-slot=a]${S}`).replace('[data-slot=b]', `[data-slot=b]${S}`));
    });

    it('leaves a selector list the page would drop as invalid', () => {
        expect(scopeToKit('[data-slot=a], { color: red; }')).toBe(`[data-slot=a]${S},  { color: red; }`);
    });

    it('reads past comments and strings', () => {
        expect(scopeToKit('/* a { b } ; */ [data-slot="x{"] { content: "}"; } [data-slot=y] { color: red; }')).toBe(`[data-slot="x{"]${S} { content: "}"; } [data-slot=y]${S} { color: red; }`);
    });

    it('scopes a sheet as the build flattens it', () => {
        const source = "export const a = css`@layer vela.ui { [data-slot='gauge'] { color: red; &:hover { color: blue; } } }`;";
        const flat = /css`([^`]*)`/.exec(flattenTemplates(source, 'gauge.ts'))![1]!;
        const scoped = scopeToKit(flat);
        expect(scoped).toContain(`[data-slot=gauge]${S}{`);
        expect(scoped).toContain(`[data-slot=gauge]:hover${S}{`);
    });
});

/** The top-level style rules of a sheet, as the page's CSS parser reads it. */
function topLevelRules(text: string): CSSStyleRule[] {
    const style = document.createElement('style');
    style.textContent = text;
    document.head.append(style);
    const rules: CSSStyleRule[] = [];
    const walk = (list: CSSRuleList): void => {
        for (const rule of Array.from(list)) {
            if ('selectorText' in rule) rules.push(rule as CSSStyleRule);
            else if ('cssRules' in rule && !('appendRule' in rule)) walk((rule as CSSGroupingRule).cssRules);
        }
    };
    walk(style.sheet!.cssRules);
    style.remove();
    return rules;
}

/** How many selectors a selector list holds. */
function listLength(selectorText: string): number {
    let depth = 0;
    let n = 1;
    for (const c of selectorText) {
        if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (c === ',' && depth === 0) n += 1;
    }
    return n;
}

describe('every component sheet, as written and as built', () => {
    const sheets = componentSheets() as Array<{ file: string; text: string }>;
    const norm = (s: string): string => s.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();

    it.each(sheets.flatMap(({ file, text }) => [
        [`${file} (nested)`, text],
        [`${file} (flattened)`, /css`([^`]*)`/.exec(flattenTemplates(`css\`${text}\``, file))![1]!],
    ]))('%s keeps every rule, each selector scoped once', (_, text) => {
        const before = topLevelRules(text);
        const after = topLevelRules(scopeToKit(text));
        expect(before.length).toBeGreaterThan(0);
        expect(after.map((r) => norm(r.selectorText.split(S).join('')))).toEqual(before.map((r) => norm(r.selectorText)));
        expect(after.map((r) => r.selectorText.split(S).length - 1)).toEqual(before.map((r) => listLength(r.selectorText)));
        expect(() => parseStrictly(scopeToKit(text))).not.toThrow();
    });
});

describe('the kit stylesheets', () => {
    it("style none of the page's own elements that carry the kit's part names", () => {
        const page = pageCopy(renderKit());
        const rules = partRules();
        expect(rules.length).toBeGreaterThan(50);
        expect(rules.filter((rule) => styled(rule, page) > 0).map((rule) => rule.selectorText)).toEqual([]);
    });

    it('style the same kit elements as their rules written unscoped, layers portaled to the body included', () => {
        const host = renderKit();
        createDialog({ title: 'Portaled' }).show();
        const trigger = createButton({ text: 'More' });
        host.append(trigger.el);
        createDropdownMenu({ items: [{ id: 'a', label: 'A' }], trigger: trigger.el, host: document.body }).open();
        expect(document.querySelectorAll('body > .vela-ui-layer').length).toBeGreaterThan(1);
        const rules = partRules();
        const unscoped = (rule: CSSStyleRule): CSSStyleRule => ({ selectorText: rule.selectorText.split(S).join('') }) as CSSStyleRule;
        expect(rules.every((rule) => rule.selectorText.includes(S))).toBe(true);
        expect(rules.filter((rule) => styled(rule, document.body) > 0).length).toBeGreaterThan(40);
        expect(rules.filter((rule) => styled(rule, document.body) !== styled(unscoped(rule), document.body)).map((rule) => rule.selectorText)).toEqual([]);
    });

    it('leave a select trigger of the page unstyled once a kit select is created (#346)', () => {
        renderKit();
        const own = document.createElement('button');
        own.setAttribute('data-slot', 'select-trigger');
        own.append(Object.assign(document.createElement('span'), { textContent: 'BTC' }));
        own.firstElementChild!.setAttribute('data-slot', 'select-value');
        document.body.append(own);
        const select = document.getElementById('vela-ui-select-3') as HTMLStyleElement;
        const rules = partRules().filter((rule) => rule.parentStyleSheet === select.sheet);
        expect(rules.length).toBeGreaterThan(0);
        expect(rules.filter((rule) => styled(rule, own) > 0).map((rule) => rule.selectorText)).toEqual([]);
    });
});
