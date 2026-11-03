// A component's declaration: its name, its parts and its settings. Every link between the
// name and the component's CSS comes from it: the parts' `data-slot` values, and the settings'
// custom properties, which a theme or a host's CSS can set.
import type { Token } from './t';

export interface ComponentDef<N extends string, P extends string, S extends string> {
    readonly name: N;
    readonly parts: readonly P[];
    /** A part's `data-slot`: the bare name for `root`, `name-part` otherwise. */
    slot(part: P): string;
    /** Each setting as `var(--vela-<name>-<setting>, <default>)`, for the component's CSS. */
    readonly vars: { readonly [K in S]: string };
}

export function defineComponent<const N extends string, const P extends string, const S extends string = never>(def: {
    name: N;
    parts: readonly P[];
    settings?: { readonly [K in S]: Token | string };
}): ComponentDef<N, P, S> {
    const vars = {} as Record<string, string>;
    for (const [key, fallback] of Object.entries(def.settings ?? {}) as Array<[string, Token | string]>) {
        vars[key] = `var(--vela-${def.name}-${key}, ${String(fallback)})`;
    }
    return {
        name: def.name,
        parts: def.parts,
        slot: (part) => (part === 'root' ? def.name : `${def.name}-${part}`),
        vars: vars as { readonly [K in S]: string },
    };
}
