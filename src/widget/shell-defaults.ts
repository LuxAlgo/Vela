// Shell option DEFAULTS contributed by plugins. A plugin cannot reach the options a host
// builds its shell with, yet some of what it adds needs a shell built a certain way (a
// sidebar for its entries). The shell-side counterpart of `registerRendererDefaults`: the
// same shape, read once by every shell built afterwards, the widget's and a workspace.
import type { SidebarComposition } from './sidebar-composition';

/** The shell options a plugin may give a default. */
export interface ShellDefaults {
    /** The right-edge toolbar (`sidebar`), as a shell option takes it. */
    sidebar?: boolean | SidebarComposition;
}

const defaults = new Map<keyof ShellDefaults, unknown>();

/**
 * Register defaults for shell options. Every shell built afterwards uses one where its host
 * gave no value for that option: the host's own value, `false` included, always wins. Shells
 * already built are untouched. Returns a disposer that removes precisely the values it set
 * (leaving any later re-registration of the same key in place).
 */
export function registerShellDefaults(values: ShellDefaults): () => void {
    const applied = Object.entries(values) as Array<[keyof ShellDefaults, unknown]>;
    for (const [key, value] of applied) defaults.set(key, value);
    return () => {
        for (const [key, value] of applied) if (defaults.get(key) === value) defaults.delete(key);
    };
}

/** Drop registered defaults by key — all of them when called with no arguments. */
export function unregisterShellDefaults(...keys: Array<keyof ShellDefaults>): void {
    if (keys.length === 0) defaults.clear();
    else for (const key of keys) defaults.delete(key);
}

/** The defaults a shell applies at construction (empty when no plugin registered any). */
export function shellDefaults(): ShellDefaults {
    return Object.fromEntries(defaults) as ShellDefaults;
}
