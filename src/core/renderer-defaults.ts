// Renderer FEATURE defaults contributed by plugins. A renderer feature
// (`chart.renderer.set(key, value)`) is per-chart state set on an instance that does not
// exist yet when an enabler runs, and no registry carried it: a plugin could contribute a
// chart type, an engine or a panel, but not "every chart should start with this feature
// set". This is that missing half — the same shape as the other contribution registries,
// and the renderer-side counterpart of `registerDefaultEngine`, except it reaches EVERY
// chart: the widget's, each workspace cell's, and a bare `new Vela()`.

const defaults = new Map<string, unknown>();

/**
 * Register default values for renderer features — every chart built afterwards applies
 * them once its renderer is mounted, before the first paint. Keys are renderer feature
 * names (`chart.renderer.features`); one the active renderer does not support is warned
 * about and ignored, exactly as `renderer.set()` does.
 *
 * These are DEFAULTS, not locks: an explicit `chart.renderer.set(...)`, an applied config
 * template, or the user's own in-chart settings still win afterwards. Charts already
 * built are untouched. Returns a disposer that removes precisely the values it set
 * (leaving any later re-registration of the same key in place).
 */
export function registerRendererDefaults(values: Record<string, unknown>): () => void {
    const applied = Object.entries(values);
    for (const [key, value] of applied) defaults.set(key, value);
    return () => {
        for (const [key, value] of applied) if (defaults.get(key) === value) defaults.delete(key);
    };
}

/** Drop registered defaults by key — all of them when called with no arguments. */
export function unregisterRendererDefaults(...keys: string[]): void {
    if (keys.length === 0) defaults.clear();
    else for (const key of keys) defaults.delete(key);
}

/** The defaults a chart applies at construction (empty when no plugin registered any). */
export function rendererDefaults(): Record<string, unknown> {
    return Object.fromEntries(defaults);
}
