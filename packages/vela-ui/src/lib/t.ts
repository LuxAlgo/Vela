// Typed access to the design tokens. `${t.radius.md}` prints `var(--vela-radius-md)`, and a
// name that does not exist fails the typecheck. A group is a token too when its bare name is
// one (`${t.fg}` and `${t.fg.muted}`). The list must match what the theme writes; a test
// checks both directions.

export interface Token {
    /** The custom property, `--vela-…`. */
    readonly name: string;
    /** `var(--vela-…)`, also what the token prints as in a template. */
    readonly var: string;
    toString(): string;
}

function tok(name: string): Token {
    const prop = `--vela-${name}`;
    const ref = `var(${prop})`;
    return { name: prop, var: ref, toString: () => ref };
}

function group<S extends Record<string, string>>(base: null, subs: S): { readonly [K in keyof S]: Token };
function group<S extends Record<string, string>>(base: string, subs: S): Token & { readonly [K in keyof S]: Token };
function group(base: string | null, subs: Record<string, string>): unknown {
    const out = (base ? tok(base) : {}) as Record<string, unknown>;
    for (const [key, name] of Object.entries(subs)) out[key] = tok(name);
    return out;
}

export const t = {
    space: group(null, { 1: 'space-1', 2: 'space-2', 3: 'space-3', 4: 'space-4' }),
    radius: group(null, { sm: 'radius-sm', md: 'radius-md', lg: 'radius-lg' }),
    z: group(null, { tooltip: 'z-tooltip', menu: 'z-menu', dialog: 'z-dialog', popover: 'z-popover' }),
    ease: tok('ease'),
    dur: group(null, { fast: 'dur-fast', med: 'dur-med' }),
    fontSize: group(null, { sm: 'font-size-sm', md: 'font-size-md', lg: 'font-size-lg' }),
    font: tok('font'),
    bg: tok('bg'),
    fg: group('fg', { muted: 'fg-muted', faint: 'fg-faint', bright: 'fg-bright', onFill: 'fg-on-fill' }),
    surface: group('surface', { elev: 'surface-elev', overlay: 'surface-overlay', sunken: 'surface-sunken' }),
    border: group('border', { strong: 'border-strong', soft: 'border-soft', faint: 'border-faint' }),
    hover: group('hover', { strong: 'hover-strong' }),
    active: tok('active'),
    focus: group('focus', { soft: 'focus-soft' }),
    separatorHover: group(null, { band: 'separator-hover-band', line: 'separator-hover-line' }),
    scroll: tok('scroll'),
    accent: group('accent', { bright: 'accent-bright' }),
    highlight: tok('highlight'),
    selected: group(null, { bg: 'selected-bg', fg: 'selected-fg' }),
    up: tok('up'),
    down: tok('down'),
    danger: tok('danger'),
    shadow: group('shadow', { dialog: 'shadow-dialog' }),
    backdrop: tok('backdrop'),
};

/** Every token reachable from `t`, by custom property name. */
export function tokenNames(): string[] {
    const names: string[] = [];
    const walk = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        const name = (v as Partial<Token>).name;
        if (typeof name === 'string') names.push(name);
        for (const [k, sub] of Object.entries(v)) if (k !== 'name' && k !== 'var') walk(sub);
    };
    walk(t);
    return names;
}
