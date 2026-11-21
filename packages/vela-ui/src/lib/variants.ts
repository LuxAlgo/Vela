// Typed variants: the names a component accepts, written as `data-*` attributes its CSS keys
// on. A component's props derive from the definition, so a variant that does not exist fails
// the typecheck at every call site. The first value of each list is the default.

export type VariantSpec = Readonly<Record<string, readonly string[]>>;

export type VariantValues<S extends VariantSpec> = { [K in keyof S]?: S[K][number] };

export interface VariantFn<S extends VariantSpec> {
    (values?: VariantValues<S>): Record<string, string>;
    readonly spec: S;
    /** The value each key resolves to. */
    resolve(values?: VariantValues<S>): { [K in keyof S]: S[K][number] };
}

export type VariantProps<F> = F extends VariantFn<infer S> ? VariantValues<S> : never;

export function variants<const S extends VariantSpec>(spec: S): VariantFn<S> {
    const keys = Object.keys(spec);
    const attrs = keys.map((key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
    const resolve = (values: VariantValues<S> = {}): { [K in keyof S]: S[K][number] } => {
        const out: Record<string, string> = {};
        for (const key of keys) out[key] = (values as Record<string, string | undefined>)[key] ?? spec[key]![0]!;
        return out as { [K in keyof S]: S[K][number] };
    };
    const fn = (values: VariantValues<S> = {}): Record<string, string> => {
        const out: Record<string, string> = {};
        for (let i = 0; i < keys.length; i += 1) out[attrs[i]!] = (values as Record<string, string | undefined>)[keys[i]!] ?? spec[keys[i]!]![0]!;
        return out;
    };
    return Object.assign(fn, { spec, resolve });
}
