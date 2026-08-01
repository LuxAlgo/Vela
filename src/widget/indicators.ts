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

/** An async manifest source — called once at resolution time. The escape hatch for
 *  manifests that a URL can't express: a filesystem read, an authenticated API, a
 *  bundler dynamic import. A rejection behaves like a failing manifest URL. */
export type IndicatorLoader = () => Promise<IndicatorManifest>;

/** Load the indicator list: a manifest object, a URL string returning the manifest JSON,
 *  or an async loader function returning the manifest. Entries with `url` sources are
 *  fetched here too (relative to the manifest URL when there is one). Entries that fail
 *  to resolve are dropped with a console warning — one broken script must not take the
 *  chart down. */
export async function resolveIndicators(
    config: string | IndicatorManifest | IndicatorLoader,
    fetchImpl: typeof fetch = fetch,
): Promise<ResolvedIndicator[]> {
    let manifest: IndicatorManifest;
    let baseUrl: string | undefined;
    if (typeof config === 'function') {
        manifest = await config();
    } else if (typeof config === 'string') {
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

/** Everything {@link indicatorLedger} needs to decide what a state snapshot reports. */
export interface LedgerInputs {
    /** Native types present on the chart RIGHT NOW (`chart.presentNativeIndicators()` — sync). */
    present: readonly string[];
    /** Names of the live manifest instances (the shell's own synchronous array). */
    instanceNames: readonly string[];
    /** A restored ledger's manifest half, until it materializes (null once consumed). */
    pendingManifest: readonly string[] | null;
    /**
     * The manifest can no longer change the instance set — it resolved, or the shell was
     * built without an `indicators` option so nothing will ever resolve. Until then the
     * pending names are reported as-is: an early save must not wipe a restored ledger
     * the shell simply hasn't materialized yet.
     */
    manifestSettled: boolean;
    /**
     * The volume auto-add is still owed (before the first `load:end`) AND the intent —
     * restored ledger, else the `volume` option — says volume. The registry cannot show
     * it yet; without this, an early save would write `natives: []` and the reload would
     * read it as a deliberate opt-out, silencing volume forever.
     */
    volumePending: boolean;
}

/**
 * The indicator ledger a state snapshot persists — PURE. The one rule: a LIVE (possibly
 * empty) set is the truth once its source settled; fallbacks cover ONLY the boot window
 * before a restored ledger materializes. "Empty because the user removed everything" must
 * never be repainted as "empty because nothing loaded yet" — that resurrection was the
 * bug this helper exists to pin down.
 */
export function indicatorLedger(i: LedgerInputs): { manifest: string[]; natives: string[] } {
    const natives = [...i.present];
    if (i.volumePending && !natives.includes('volume')) natives.push('volume');
    return {
        manifest: i.manifestSettled ? [...i.instanceNames] : [...(i.pendingManifest ?? i.instanceNames)],
        natives,
    };
}
