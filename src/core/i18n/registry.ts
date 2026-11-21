// The locale-pack registry: packs registered by the host (core packs, plugin packs, the
// host's own), merged per fallback chain on first use and cached until the next change.
import { canonicalLocale } from './locale';
import type { LocalePack } from './types';

interface Entry {
    readonly tag: string;
    readonly messages: Readonly<Record<string, string>>;
}

const entries: Entry[] = [];
let version = 0;
const merged = new Map<string, { version: number; map: ReadonlyMap<string, string> }>();

/**
 * Register a locale pack: a locale tag and its messages (id → ICU message). Several packs
 * may share a tag (the core's, a plugin's, the host's); for the same id the pack
 * registered last wins. Registration is a call, never an import side effect. Returns the
 * disposer that removes this pack again.
 */
export function registerLocale(pack: LocalePack): () => void {
    if (!pack || typeof pack.locale !== 'string' || !pack.messages || typeof pack.messages !== 'object') {
        throw new TypeError('[vela] registerLocale expects { locale: string, messages: Record<string, string> }');
    }
    const entry: Entry = { tag: canonicalLocale(pack.locale), messages: pack.messages };
    entries.push(entry);
    version += 1;
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        const i = entries.indexOf(entry);
        if (i >= 0) {
            entries.splice(i, 1);
            version += 1;
        }
    };
}

/** The tags of every registered pack, in registration order (duplicates collapsed). */
export function registeredLocales(): string[] {
    return [...new Set(entries.map((e) => e.tag))];
}

/** The messages a fallback chain resolves to: per id, the most specific tag that has it. */
export function messagesFor(chain: readonly string[]): ReadonlyMap<string, string> {
    const key = chain.join('|');
    const hit = merged.get(key);
    if (hit && hit.version === version) return hit.map;
    const map = new Map<string, string>();
    // Least specific first, so more specific tags (and later packs) overwrite.
    for (let c = chain.length - 1; c >= 0; c -= 1) {
        const tag = chain[c];
        for (const e of entries) {
            if (e.tag !== tag) continue;
            for (const [id, text] of Object.entries(e.messages)) {
                if (typeof text === 'string') map.set(id, text);
            }
        }
    }
    merged.set(key, { version, map });
    return map;
}
