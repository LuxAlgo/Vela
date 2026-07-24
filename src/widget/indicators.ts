// The widget's indicator configuration — a JSON manifest passed at init, either inline or
// as a URL returning the same JSON (the OS config seam for script libraries).
//
// Manifest shape (array or {indicators: [...]} wrapper):
//   [{ "name": "EMA 20", "script": "...pine source...", "language": "pine",
//      "enabled": true }, ...]
// An entry may carry `"url"` instead of `"script"` — the source is fetched lazily.

export interface IndicatorManifestEntry {
    name: string;
    /** Inline script source (one of script/url required). */
    script?: string;
    /** Fetch the source from here instead (resolved relative to the manifest URL). */
    url?: string;
    /** Engine language (default: the chart's default engine). */
    language?: string;
    /** Add to the chart at startup (default true). Disabled entries only appear in pickers. */
    enabled?: boolean;
    /** Picker grouping (default 'Indicators'). */
    category?: string;
}

export type IndicatorManifest = IndicatorManifestEntry[] | { indicators: IndicatorManifestEntry[] };

/** A manifest entry with its source resolved and ready for `chart.addIndicator`. */
export interface ResolvedIndicator {
    name: string;
    script: string;
    language?: string;
    enabled: boolean;
    category?: string;
}

function entriesOf(manifest: IndicatorManifest): IndicatorManifestEntry[] {
    return Array.isArray(manifest) ? manifest : manifest.indicators;
}

/** Load the indicator list: a manifest object, or a URL string returning the manifest JSON.
 *  Entries with `url` sources are fetched here too (relative to the manifest URL). Entries
 *  that fail to resolve are dropped with a console warning — one broken script must not
 *  take the chart down. */
export async function resolveIndicators(
    config: string | IndicatorManifest,
    fetchImpl: typeof fetch = fetch,
): Promise<ResolvedIndicator[]> {
    let manifest: IndicatorManifest;
    let baseUrl: string | undefined;
    if (typeof config === 'string') {
        baseUrl = config;
        const res = await fetchImpl(config);
        if (!res.ok) throw new Error(`indicator manifest ${config}: HTTP ${res.status}`);
        manifest = (await res.json()) as IndicatorManifest;
    } else {
        manifest = config;
    }

    const out: ResolvedIndicator[] = [];
    for (const entry of entriesOf(manifest)) {
        try {
            let script = entry.script;
            if (script === undefined && entry.url !== undefined) {
                let url = entry.url;
                try {
                    // Relative to the manifest URL (itself relative to the page, if any).
                    const base = typeof location !== 'undefined' ? new URL(baseUrl ?? '.', location.href) : new URL(baseUrl ?? '');
                    url = new URL(entry.url, base).href;
                } catch {
                    /* absolute or bare-path url — fetch it as written */
                }
                const res = await fetchImpl(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                script = await res.text();
            }
            if (script === undefined) throw new Error('entry has neither script nor url');
            out.push({ name: entry.name, script, language: entry.language, enabled: entry.enabled !== false, category: entry.category });
        } catch (err) {
            console.warn(`[vela] indicator "${entry.name}" skipped:`, err);
        }
    }
    return out;
}
