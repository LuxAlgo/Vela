// Theming. A theme is data: the chart's colors and font, every UI token, and the settings of
// each component. `createTheme` builds one from a few choices; `applyTheme` writes it once per
// document (or shadow root) as a rule in `@layer vela.theme`, keyed by the host's
// `data-vela-theme`. The layer sits below every other style, so a host's own CSS overrides
// any token without `!important` (`[data-vela-theme] { --vela-accent: … }` reaches every
// themed host, chrome inside the chart included), and several themes coexist on one page.
import type { badgeDef } from '../components/badge';
import type { barChartDef } from '../components/bar-chart';
import type { buttonDef } from '../components/button';
import type { calloutBubbleDef } from '../components/callout-bubble';
import type { cardDef } from '../components/card';
import type { colorPickerDef } from '../components/color-picker';
import type { dataTableDef } from '../components/data-table';
import type { datePickerDef } from '../components/date-picker';
import type { dialogDef } from '../components/dialog';
import type { donutDef } from '../components/donut';
import type { drawerDef } from '../components/drawer';
import type { emptyDef } from '../components/empty';
import type { fieldDef } from '../components/field';
import type { glyphSelectDef } from '../components/glyph-select';
import type { hoverCardDef } from '../components/hover-card';
import type { kbdDef } from '../components/kbd';
import type { lineChartDef } from '../components/line-chart';
import type { dropdownMenuDef } from '../components/dropdown-menu';
import type { numberInputDef } from '../components/number-input';
import type { popoverDef } from '../components/popover';
import type { scatterChartDef } from '../components/scatter-chart';
import type { selectDef } from '../components/select';
import type { sparklineDef } from '../components/sparkline';
import type { statDef } from '../components/stat';
import type { checkboxDef } from '../components/checkbox';
import type { collapsibleDef } from '../components/collapsible';
import type { tabsDef } from '../components/tabs';
import type { textAreaDef } from '../components/text-area';
import type { inputDef } from '../components/input';
import type { inputGroupDef } from '../components/input-group';
import type { itemDef } from '../components/item';
import type { monthGridDef } from '../components/month-grid';
import type { sliderDef } from '../components/slider';
import type { sortButtonDef } from '../components/sort-button';
import type { switchDef } from '../components/switch';
import type { toggleGroupDef } from '../components/toggle-group';
import type { tooltipDef } from '../components/tooltip';
import type { treemapDef } from '../components/treemap';
import { contrastRatio, isDarkColor, mix, parseRgb } from './color';
import { KIT_COMPONENTS } from './component-index';
import { acceptCss, injectLayerOrder, isWrittenCss } from './css';
import { declaredComponents, type ComponentDef, type DeclaredComponent } from './define';
import { BEARISH, BULLISH } from './palette';
import { injectStyles } from './styles';
import { STATIC_TOKENS, themeTokens, type ChartTheme } from './tokens';

/** The built-in dark chart theme. */
export const DARK_CHART: ChartTheme = {
    background: '#151619',
    textColor: '#b2b5be',
    gridColor: '#20222c',
    borderColor: '#2a2b30',
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

/** The built-in light chart theme. Candle hues are shared across themes: switching themes
 *  recolors surfaces and text, never the series. */
export const LIGHT_CHART: ChartTheme = {
    background: '#ffffff',
    textColor: '#1e293b',
    // Soft chrome on white: grid is a neutral wash; pane separator / axis border sit a
    // step darker so stacked panes stay distinct.
    gridColor: '#cccccc',
    borderColor: '#d4dae3',
    upColor: BULLISH,
    downColor: BEARISH,
    fontFamily: 'sans-serif',
};

/** Every token, by name without the `--vela-` prefix. A test checks the list against what
 *  `createTheme` writes. */
export const TOKEN_NAMES = [
    'space-1',
    'space-2',
    'space-3',
    'space-4',
    'radius-sm',
    'radius-md',
    'radius-lg',
    'z-tooltip',
    'z-menu',
    'z-dialog',
    'z-popover',
    'ease',
    'dur-fast',
    'dur-med',
    'font-size-sm',
    'font-size-md',
    'font-size-lg',
    'scroll-size',
    'font',
    'bg',
    'fg',
    'fg-muted',
    'fg-faint',
    'fg-bright',
    'surface',
    'surface-elev',
    'surface-overlay',
    'surface-sunken',
    'border',
    'border-strong',
    'border-soft',
    'border-faint',
    'hover',
    'active',
    'hover-strong',
    'focus',
    'focus-soft',
    'separator-hover-band',
    'separator-hover-line',
    'scroll',
    'accent',
    'accent-bright',
    'highlight',
    'selected-bg',
    'selected-fg',
    'fg-on-fill',
    'up',
    'down',
    'profit',
    'loss',
    'danger',
    'shadow',
    'shadow-dialog',
    'backdrop',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/** The components a theme can set, by name: each one's declaration. A package with
 *  components of its own adds them here by declaration merging. */
export interface ComponentDefs {
    badge: typeof badgeDef;
    'bar-chart': typeof barChartDef;
    button: typeof buttonDef;
    'callout-bubble': typeof calloutBubbleDef;
    card: typeof cardDef;
    checkbox: typeof checkboxDef;
    collapsible: typeof collapsibleDef;
    'color-picker': typeof colorPickerDef;
    'data-table': typeof dataTableDef;
    'date-picker': typeof datePickerDef;
    dialog: typeof dialogDef;
    donut: typeof donutDef;
    drawer: typeof drawerDef;
    'dropdown-menu': typeof dropdownMenuDef;
    empty: typeof emptyDef;
    field: typeof fieldDef;
    'glyph-select': typeof glyphSelectDef;
    'hover-card': typeof hoverCardDef;
    'input-group': typeof inputGroupDef;
    input: typeof inputDef;
    item: typeof itemDef;
    kbd: typeof kbdDef;
    'line-chart': typeof lineChartDef;
    'month-grid': typeof monthGridDef;
    'number-input': typeof numberInputDef;
    popover: typeof popoverDef;
    'scatter-chart': typeof scatterChartDef;
    select: typeof selectDef;
    slider: typeof sliderDef;
    'sort-button': typeof sortButtonDef;
    sparkline: typeof sparklineDef;
    stat: typeof statDef;
    switch: typeof switchDef;
    tabs: typeof tabsDef;
    'text-area': typeof textAreaDef;
    'toggle-group': typeof toggleGroupDef;
    tooltip: typeof tooltipDef;
    treemap: typeof treemapDef;
}

type SettingsOf<D> = D extends ComponentDef<string, string, infer S> ? S : never;
type PartsOf<D> = D extends ComponentDef<string, infer P, string> ? P : never;

/** Settings by component, then by setting (`{ button: { radius: '2px' } }`), each written
 *  as `--vela-<component>-<setting>`. `css` restyles the component's parts completely: each
 *  part's CSS, written with the `css` tag, applies to that part under the theme, after every
 *  other layer of the kit. */
export type ComponentSettings = {
    [K in keyof ComponentDefs]?: { [S in SettingsOf<ComponentDefs[K]>]?: string } & {
        css?: { [P in PartsOf<ComponentDefs[K]>]?: string };
    };
};

export interface CreateThemeOptions {
    /** Apply part CSS that was not written with the `css` tag (a theme loaded from data).
     *  Off by default: CSS from someone else can restyle the page to mislead, and load
     *  remote images that leak what the page shows. */
    allowCss?: boolean;
}

/** A theme's settings beyond the chart's colors. */
export interface ThemeSettings {
    /** The brand color; its readable ink derives from it. */
    accent?: string;
    /** Scales every radius token: `none`, `sm`, `md` (default), `lg`. */
    radius?: 'none' | 'sm' | 'md' | 'lg';
    font?: string;
    /** Any token, by name. */
    tokens?: Partial<Record<TokenName, string>>;
    components?: ComponentSettings;
}

/** The choices a theme is built from. Every field is optional: `createTheme()` is the dark theme. */
export interface ThemeInput extends ThemeSettings {
    /** The theme to start from: `dark` (default), `light`, or a chart theme's seven fields. */
    base?: 'dark' | 'light' | ChartTheme;
    /** A theme from colors alone: everything else derives from them, light or dark read
     *  from the background. */
    colors?: {
        background?: string;
        text?: string;
        grid?: string;
        border?: string;
        up?: string;
        down?: string;
        accent?: string;
    };
}

/** A theme built by {@link createTheme}. */
export interface UiTheme {
    /** Derived from the values: equal themes share one rule. */
    readonly id: string;
    /** The chart's colors and font. */
    readonly chart: ChartTheme;
    /** Every token, by custom property (`--vela-accent`). */
    readonly tokens: Readonly<Record<string, string>>;
    /** Component settings, by component then setting. */
    readonly components: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Part CSS, by component then part. */
    readonly css: Readonly<Record<string, Readonly<Record<string, string>>>>;
    /** Its settings beyond the chart's colors: with {@link chart}, they rebuild the theme. */
    readonly settings: Readonly<ThemeSettings>;
}

/** A chart theme with optional settings: its seven fields seed the UI theme and `ui`
 *  adjusts it. Chrome that recolors its surface (an overlay following the plot's
 *  background) keeps the settings. */
export type ThemedChart = ChartTheme & { readonly ui?: ThemeSettings };

const RADIUS_SCALE = { none: 0, sm: 0.5, md: 1, lg: 1.5 } as const;

function chartOf(input: ThemeInput): ChartTheme {
    const base = input.base === 'light' ? LIGHT_CHART : input.base === undefined || input.base === 'dark' ? DARK_CHART : input.base;
    const colors = input.colors;
    const font = input.font ?? base.fontFamily;
    if (!colors) return { ...base, fontFamily: font };
    const background = colors.background ?? base.background;
    const textColor = colors.text ?? (colors.background ? (isDarkColor(background) ? DARK_CHART.textColor : LIGHT_CHART.textColor) : base.textColor);
    const surfaceChanged = colors.background !== undefined || colors.text !== undefined;
    return {
        background,
        textColor,
        gridColor: colors.grid ?? (surfaceChanged ? mix(background, textColor, 0.08) : base.gridColor),
        borderColor: colors.border ?? (surfaceChanged ? mix(background, textColor, 0.14) : base.borderColor),
        upColor: colors.up ?? base.upColor,
        downColor: colors.down ?? base.downColor,
        fontFamily: font,
    };
}

/** A short stable id for a theme's values. */
function themeId(values: string): string {
    let h = 5381;
    for (let i = 0; i < values.length; i += 1) h = ((h << 5) + h + values.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

/** The ink that reads best on a fill. */
function inkOn(fill: string): string {
    return (contrastRatio(fill, '#ffffff') ?? 21) >= (contrastRatio(fill, '#000000') ?? 0) ? '#ffffff' : '#000000';
}

function build(input: ThemeInput, options: CreateThemeOptions): { theme: UiTheme; dropped: string[] } {
    const chart = chartOf(input);
    const tokens: Record<string, string> = { ...STATIC_TOKENS, ...themeTokens(chart) };
    if (input.radius) {
        const f = RADIUS_SCALE[input.radius];
        for (const name of ['radius-sm', 'radius-md', 'radius-lg']) tokens[`--vela-${name}`] = `${Math.round(parseFloat(STATIC_TOKENS[`--vela-${name}`]!) * f)}px`;
    }
    const accent = input.accent ?? input.colors?.accent;
    if (accent) {
        tokens['--vela-accent'] = accent;
        tokens['--vela-accent-bright'] = accent;
        tokens['--vela-fg-on-fill'] = inkOn(accent);
    }
    for (const [name, value] of Object.entries(input.tokens ?? {})) if (value !== undefined) tokens[`--vela-${name}`] = value;
    const components: Record<string, Record<string, string>> = {};
    const partCss: Record<string, Record<string, string>> = {};
    const dropped: string[] = [];
    const entries = Object.entries(input.components ?? {}) as Array<[string, Record<string, unknown>]>;
    for (const [name, values] of entries) {
        const set: Record<string, string> = {};
        for (const [key, value] of Object.entries(values)) if (key !== 'css' && typeof value === 'string') set[key] = value;
        if (Object.keys(set).length) components[name] = set;
        const parts: Record<string, string> = {};
        for (const [part, text] of Object.entries((values.css ?? {}) as Record<string, unknown>)) {
            if (typeof text !== 'string') continue;
            if (options.allowCss) acceptCss(text);
            if (isWrittenCss(text)) parts[part] = text;
            else dropped.push(`components.${name}.css.${part}`);
        }
        if (Object.keys(parts).length) partCss[name] = parts;
    }
    const settings: ThemeSettings = {};
    if (accent) settings.accent = accent;
    if (input.radius) settings.radius = input.radius;
    if (input.font) settings.font = input.font;
    if (input.tokens) settings.tokens = { ...input.tokens };
    const both = new Set([...Object.keys(components), ...Object.keys(partCss)]);
    if (both.size) {
        const merged: Record<string, Record<string, unknown>> = {};
        for (const name of both) merged[name] = { ...components[name], ...(partCss[name] ? { css: { ...partCss[name] } } : {}) };
        settings.components = merged as ComponentSettings;
    }
    const theme = { id: themeId(JSON.stringify([tokens, components, partCss])), chart, tokens, components, css: partCss, settings };
    return { theme, dropped };
}

const isCssVar = (value: string) => value.trim().startsWith('var(');

/** A component's parts and settings: as declared on the page, else as the kit declares them
 *  (a kit component a page never imported is declared nowhere yet). */
function componentNamed(name: string): DeclaredComponent | undefined {
    return declaredComponents().get(name) ?? (Object.prototype.hasOwnProperty.call(KIT_COMPONENTS, name) ? KIT_COMPONENTS[name] : undefined);
}

function componentProblems(input: ThemeInput): string[] {
    const problems: string[] = [];
    for (const [name, values] of Object.entries(input.components ?? {}) as Array<[string, Record<string, unknown> | undefined]>) {
        const def = componentNamed(name);
        if (!def) {
            problems.push(`components.${name}: no component has that name (declare a component of your own with defineComponent before creating the theme)`);
            continue;
        }
        for (const key of Object.keys(values ?? {})) {
            if (key === 'css' || def.settings.includes(key)) continue;
            problems.push(`components.${name}.${key} is not a setting of ${name} (${def.settings.length ? `its settings: ${def.settings.join(', ')}` : 'it has none'})`);
        }
        for (const part of Object.keys((values?.css ?? {}) as Record<string, unknown>)) {
            if (!def.parts.includes(part)) problems.push(`components.${name}.css.${part} is not a part of ${name} (its parts: ${def.parts.join(', ')})`);
        }
    }
    return problems;
}

function problemsOf(input: ThemeInput, theme: UiTheme): string[] {
    const problems: string[] = [];
    const known = new Set<string>(TOKEN_NAMES);
    for (const name of Object.keys(input.tokens ?? {})) if (!known.has(name)) problems.push(`"${name}" is not a token`);
    problems.push(...componentProblems(input));
    const colors: Array<[string, string | undefined]> = [['accent', input.accent]];
    for (const [k, v] of Object.entries(input.colors ?? {})) colors.push([`colors.${k}`, v]);
    if (typeof input.base === 'object') for (const k of CHART_FIELDS) if (k !== 'fontFamily') colors.push([`base.${k}`, input.base[k]]);
    for (const [where, value] of colors) {
        if (value !== undefined && !isCssVar(value) && !parseRgb(value)) problems.push(`${where} "${value}" is not a color the theme can derive from (use #rrggbb or rgb())`);
    }
    const pairs: Array<[string, string, number]> = [
        ['fg', 'bg', 4.5],
        ['fg-on-fill', 'accent', 3],
    ];
    for (const [ink, fill, min] of pairs) {
        const ratio = contrastRatio(theme.tokens[`--vela-${ink}`] ?? '', theme.tokens[`--vela-${fill}`] ?? '');
        if (ratio !== null && ratio < min) problems.push(`${ink} on ${fill} has a contrast of ${ratio.toFixed(1)}:1 (at least ${min}:1 reads well)`);
    }
    for (const [name, parts] of Object.entries(theme.css)) {
        for (const [part, text] of Object.entries(parts)) {
            const where = `components.${name}.css.${part}`;
            if (/!important/i.test(text)) problems.push(`${where} uses !important, which the custom layer does not need`);
            if (/(^|[\s,>+~(&])\.[a-z_-][\w-]*[^{};]*\{/im.test(text)) problems.push(`${where} targets a class name, which is not part of the component's contract (use its parts and data attributes)`);
            for (const at of text.match(/@[a-z-]+/gi) ?? []) {
                if (!CONDITIONAL.test(at)) problems.push(`${where} declares ${at}, which is left out (declare it in the page's stylesheet and use it from the part)`);
            }
        }
    }
    return problems;
}

const droppedProblem = (where: string) => `${where} was not written with the css tag and is left out (pass { allowCss: true } to apply CSS loaded from data)`;

/** What is wrong with a theme's input: unknown tokens, components, settings and parts, colors
 *  the theme cannot derive from, text with too little contrast on its background, and part
 *  CSS that is left out or reaches past the component's contract. `createTheme` warns about
 *  each. */
export function checkTheme(input: ThemeInput = {}, options: CreateThemeOptions = {}): string[] {
    const { theme, dropped } = build(input, options);
    return [...dropped.map(droppedProblem), ...problemsOf(input, theme)];
}

const warned = new Set<string>();

function warn(problems: readonly string[]): void {
    for (const problem of problems) {
        if (warned.has(problem)) continue;
        warned.add(problem);
        console.warn(`[vela-ui] theme: ${problem}`);
    }
}

/** Build a theme. Without overrides, `dark` and `light` give exactly the built-in tokens. */
export function createTheme(input: ThemeInput = {}, options: CreateThemeOptions = {}): UiTheme {
    const { theme, dropped } = build(input, options);
    warn([...dropped.map(droppedProblem), ...problemsOf(input, theme)]);
    return theme;
}

const isUiTheme = (theme: UiTheme | ThemedChart): theme is UiTheme => 'tokens' in theme && 'id' in theme;

const CHART_FIELDS = ['background', 'textColor', 'gridColor', 'borderColor', 'upColor', 'downColor', 'fontFamily'] as const;

const chartKey = (chart: ChartTheme) => CHART_FIELDS.map((k) => chart[k]).join('|');

/** The document or shadow root a host renders in (its document while it is detached). */
function rootOf(host: HTMLElement): Document | ShadowRoot {
    const root = host.getRootNode();
    if (root instanceof Document) return root;
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) return root;
    return host.ownerDocument;
}

/** Splits CSS at its top level into declarations and blocks (`prelude { body }`), skipping
 *  comments and strings. */
function topLevel(text: string): { decls: string; blocks: Array<[string, string]> } {
    const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
    let decls = '';
    const blocks: Array<[string, string]> = [];
    let buf = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i]!;
        if (c === '"' || c === "'") {
            const end = src.indexOf(c, i + 1);
            const stop = end < 0 ? src.length : end + 1;
            buf += src.slice(i, stop);
            i = stop;
            continue;
        }
        if (c === ';') {
            decls += `${buf.trim()}; `;
            buf = '';
        } else if (c === '{') {
            let depth = 1;
            let j = i + 1;
            while (j < src.length && depth > 0) {
                if (src[j] === '{') depth += 1;
                else if (src[j] === '}') depth -= 1;
                j += 1;
            }
            blocks.push([buf.trim(), src.slice(i + 1, j - 1).trim()]);
            buf = '';
            i = j;
            continue;
        } else {
            buf += c;
        }
        i += 1;
    }
    if (buf.trim()) decls += `${buf.trim()}; `;
    return { decls: decls.trim(), blocks };
}

/** Splits a selector list at its top-level commas. */
function selectorList(prelude: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < prelude.length; i += 1) {
        const c = prelude[i];
        if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (c === ',' && depth === 0) {
            out.push(prelude.slice(start, i).trim());
            start = i + 1;
        }
    }
    out.push(prelude.slice(start).trim());
    return out.filter(Boolean);
}

/** The at-rules a part's CSS can hold: conditions around its rules. Others (`@keyframes`,
 *  `@font-face`) declare something page-wide and belong in the host's stylesheet. */
const CONDITIONAL = /^@(media|supports|container)\b/i;

/** A part's CSS as flat rules on `scope`: its own declarations, its `&` rules (one level of
 *  nesting, which is all a part needs; a rule without `&` is a descendant), and `@media`,
 *  `@supports` or `@container` blocks around either. Theme CSS reaches the page without our
 *  build, and the oldest browsers we support do not nest. */
function flatPart(scope: string, text: string): string {
    const { decls, blocks } = topLevel(text);
    const rules: string[] = decls ? [`${scope} { ${decls} }`] : [];
    for (const [prelude, body] of blocks) {
        if (prelude.startsWith('@')) {
            if (CONDITIONAL.test(prelude)) rules.push(`${prelude} { ${flatPart(scope, body)} }`);
            continue;
        }
        const list = selectorList(prelude).map((s) => (s.includes('&') ? s.split('&').join(scope) : `${scope} ${s}`));
        const inner = topLevel(body);
        if (inner.decls) rules.push(`${list.join(', ')} { ${inner.decls} }`);
    }
    return rules.join(' ');
}

/** The theme's rules: every token and component setting, by default on the hosts that carry
 *  its id; and the part CSS, on those parts inside them, in the last layer. */
export function themeCss(theme: UiTheme, selector = `[data-vela-theme="${theme.id}"]`): string {
    const decls = Object.entries(theme.tokens).map(([k, v]) => `${k}: ${v};`);
    for (const [component, settings] of Object.entries(theme.components)) {
        for (const [setting, value] of Object.entries(settings)) decls.push(`--vela-${component}-${setting}: ${value};`);
    }
    const out = [`@layer vela.theme { ${selector} { ${decls.join(' ')} } }`];
    const parts: string[] = [];
    for (const [component, byPart] of Object.entries(theme.css)) {
        for (const [part, text] of Object.entries(byPart)) {
            const slot = part === 'root' ? component : `${component}-${part}`;
            // A part's `display` must not beat the browser's own `[hidden]` rule.
            parts.push(flatPart(`:where(${selector}, ${selector} *):is([data-slot~="${slot}"]):where(:not([hidden]))`, text));
        }
    }
    if (parts.length) out.push(`@layer vela.custom { ${parts.join(' ')} }`);
    return out.join('\n');
}

const MAX_CACHED = 32;
const fromChart = new Map<string, UiTheme>();

/** The UI theme for a chart theme: its seven fields with the settings it carries. */
function themeOfChart(chart: ThemedChart): UiTheme {
    const plain: ChartTheme = { background: chart.background, textColor: chart.textColor, gridColor: chart.gridColor, borderColor: chart.borderColor, upColor: chart.upColor, downColor: chart.downColor, fontFamily: chart.fontFamily };
    const key = chart.ui ? `${chartKey(plain)}|${JSON.stringify(chart.ui)}` : chartKey(plain);
    let ui = fromChart.get(key);
    if (!ui) {
        if (fromChart.size >= MAX_CACHED) fromChart.clear();
        ui = createTheme({ ...chart.ui, base: plain });
        fromChart.set(key, ui);
    }
    return ui;
}

const sheets = new WeakMap<Document | ShadowRoot, Map<string, HTMLStyleElement>>();

/** Writes the theme's rule into the root once. Live recoloring (a plot background dragged
 *  through a color picker) makes a theme per step, so past {@link MAX_CACHED} rules, the
 *  ones no element carries any more are dropped. */
function installTheme(ui: UiTheme, root: Document | ShadowRoot): void {
    let byId = sheets.get(root);
    if (!byId) sheets.set(root, (byId = new Map()));
    const id = `vela-theme-${ui.id}`;
    if (byId.get(id)?.isConnected) return;
    const sheet = injectStyles(id, themeCss(ui), root);
    if (sheet) byId.set(id, sheet);
    if (byId.size <= MAX_CACHED) return;
    for (const [other, el] of byId) {
        if (other === id || root.querySelector(`[data-vela-theme="${other.slice('vela-theme-'.length)}"]`)) continue;
        el.remove();
        byId.delete(other);
    }
}

/** Theme a host and everything inside it. A chart theme's seven fields build the theme on
 *  the way, keeping the choices of the UI theme it carries. */
export function applyTheme(host: HTMLElement, theme: UiTheme | ThemedChart): UiTheme {
    const ui = isUiTheme(theme) ? theme : themeOfChart(theme);
    const root = rootOf(host);
    injectLayerOrder(root);
    if (typeof document !== 'undefined') installTheme(ui, root);
    host.setAttribute('data-vela-theme', ui.id);
    // Tokens an older writer left inline would hide the theme's rule.
    for (const name in ui.tokens) host.style.removeProperty(name);
    return ui;
}

const STATIC_ID = 'vela-ui-tokens';

const STATIC_DECLS = Object.entries(STATIC_TOKENS)
    .map(([k, v]) => `    ${k}: ${v};`)
    .join('\n');

const STATIC_CSS = `
/* Theme-independent tokens on every kit host, at no specificity in the theme layer: a theme's
   own rule (radius scaling) and a host's CSS both override them. */
@layer vela.theme {
:where(.vela-ui, .vela-ui-layer) {
${STATIC_DECLS}
}
/* One scrollbar on every kit surface: thin, a rounded thumb, no track and no arrows, sized and
   colored by the scroll tokens. Chromium and Safari draw it from the ::-webkit-scrollbar parts,
   and setting scrollbar-width or scrollbar-color on an element switches them back to the native
   bar, so those two are for the browsers without the parts. */
:where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *)::-webkit-scrollbar { width: var(--vela-scroll-size); height: var(--vela-scroll-size); }
:where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *)::-webkit-scrollbar-track { background: transparent; }
:where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *)::-webkit-scrollbar-corner { background: transparent; }
:where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *)::-webkit-scrollbar-thumb { background: var(--vela-scroll); border-radius: var(--vela-scroll-size); }
:where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *)::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
@supports not selector(::-webkit-scrollbar) {
    :where(.vela-ui, .vela-ui-layer, .vela-ui *, .vela-ui-layer *) { scrollbar-width: thin; scrollbar-color: var(--vela-scroll) transparent; }
}
}
.vela-ui, .vela-ui-layer {
    font-family: var(--vela-font, -apple-system, system-ui, sans-serif);
    box-sizing: border-box;
    /* Chrome text (titles, buttons, menus, readouts) is UI, not copy — never selectable. */
    user-select: none;
    -webkit-user-select: none;
}
/* Unlayered, as the chrome's own controls rely on it; a kit component never declares a
   box-sizing of its own, which this reset would override. */
.vela-ui *, .vela-ui-layer * { box-sizing: border-box; }
/* Text ENTRY is the one exception: selection is part of editing. */
.vela-ui :is(input, textarea), .vela-ui-layer :is(input, textarea) { user-select: text; -webkit-user-select: text; }
/* iOS Safari zooms the page when a focused field is under 16px, and often
   keeps that zoom after the field blurs or a dialog closes. The shell's
   mobile size class is the honest gate — not a media query — so an embedded
   chart on a wide desktop still gets the rule when it is in the phone layout.
   Scoped to the kit root so a host page's own [data-layout] is never touched. */
.vela-ui[data-layout='mobile'] :is(input, textarea, select) { font-size: 16px; }
@layer vela.ui {
    .vela-icon { display: inline-flex; align-items: center; flex: none; }
    .vela-icon svg { display: block; }
}
`;

/** Theme a host from a chart theme's seven fields.
 *  @deprecated Use {@link applyTheme}, which also takes a theme from {@link createTheme}. */
export function applyThemeTokens(el: HTMLElement, t: ThemedChart): void {
    applyTheme(el, t);
}

/** Re-token a chart-overlay host (statusline, watermark, toast — chrome floating OVER
 *  the plot) from the LIVE plot surface: a config edit can recolor the plot background
 *  independently of the app theme (a white plot typed into settings on the dark theme),
 *  and the overlay ink must stay readable either way. `config` is the renderer's
 *  `getConfig()` snapshot; a missing/shapeless one falls back to the base app theme.
 *  Floating menus and dropdowns do NOT use this — they mount on {@link floatingLayerHost}
 *  so their surface follows the app theme alone. */
export function applyPlotOverlayTokens(host: HTMLElement, base: ThemedChart, config: unknown): void {
    const layout = (config as { layout?: { background?: string; textColor?: string } } | null)?.layout;
    const t = layout?.background && layout.textColor ? { ...base, background: layout.background, textColor: layout.textColor } : base;
    applyTheme(host, t);
}

/** Mount floating kit layers (menus, select lists) on the nearest `.vela-ui` so they
 *  inherit the app-theme tokens. A plot-overlay host (the cell) retokens from
 *  `layout.background`; chrome panels must not follow that. Falls back to `fallback`
 *  (typically `document.body`) when no kit host is an ancestor. */
export function floatingLayerHost(from: HTMLElement, fallback?: HTMLElement): HTMLElement {
    return (from.closest('.vela-ui') as HTMLElement | null) ?? fallback ?? from;
}

/** Mark an element as a kit host (the `.vela-ui` class and the shared sheet), themed when
 *  a theme is given. */
export function ensureUIHost(el: HTMLElement, theme?: UiTheme | ThemedChart): void {
    const root = rootOf(el);
    injectLayerOrder(root);
    injectStyles(STATIC_ID, STATIC_CSS, root);
    el.classList.add('vela-ui');
    if (theme) applyTheme(el, theme);
}
