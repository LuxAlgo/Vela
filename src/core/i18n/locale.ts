// Locale tags: canonical form, the fallback chain message lookup walks, the writing
// direction a locale implies, and the numbering system chart numbers use.

/** The canonical form of a BCP 47 tag (`pt-br` → `pt-BR`, `iw` → `he`); the tag itself
 *  when the engine rejects it, `'en'` when it is empty. */
export function canonicalLocale(tag: string | undefined | null): string {
    const raw = typeof tag === 'string' ? tag.trim() : '';
    if (!raw) return 'en';
    try {
        return Intl.getCanonicalLocales(raw)[0] ?? raw;
    } catch {
        return raw;
    }
}

function parseLocale(tag: string): Intl.Locale | null {
    try {
        return new Intl.Locale(tag);
    } catch {
        return null;
    }
}

/** The tag's language subtag (`pt-BR` → `pt`). */
export function languageOf(tag: string): string {
    return (parseLocale(tag)?.language ?? tag.split(/[-_]/)[0] ?? tag).toLowerCase();
}

/**
 * The tags message lookup tries, most specific first, ending in English: `pt-BR` →
 * `pt-BR`, `pt`, `en`; `zh-TW` → `zh-TW`, `zh-Hant`, `zh`, `en`; `es-MX` → `es-MX`,
 * `es`, `en`. A region that implies a script slots `language-Script` in before the bare
 * language, so a `zh-Hant` pack serves Taiwan and Hong Kong. After the bare language comes
 * the region it stands for (its likely subtags: `pt` is Brazil's, `zh` is China's), when that
 * region writes the same script, so a `pt-BR` pack serves `pt` and `pt-PT` before English.
 */
export function fallbackChain(tag: string): string[] {
    const out: string[] = [];
    const add = (t: string | undefined): void => {
        if (t && !out.includes(t)) out.push(t);
    };
    add(tag);
    const loc = parseLocale(tag);
    if (loc) {
        const base = loc.baseName;
        add(base);
        const parts = base.split('-');
        let impliedScript: string | undefined;
        if (!loc.script) {
            try {
                impliedScript = loc.maximize().script;
            } catch {
                impliedScript = undefined;
            }
        }
        for (let i = parts.length - 1; i >= 1; i -= 1) {
            if (i === 1 && impliedScript && loc.region) add(`${loc.language}-${impliedScript}`);
            add(parts.slice(0, i).join('-'));
        }
        if (impliedScript && !loc.region) add(`${loc.language}-${impliedScript}`);
        try {
            const usual = new Intl.Locale(loc.language).maximize();
            if (usual.region && usual.script === (loc.script ?? impliedScript)) add(`${loc.language}-${usual.region}`);
        } catch {
            /* no likely subtags on this engine: the language's own packs and English only */
        }
    }
    add('en');
    return out;
}

const RTL_SCRIPTS = new Set(['Arab', 'Hebr', 'Thaa', 'Syrc', 'Nkoo', 'Adlm', 'Rohg', 'Mand', 'Samr', 'Yezi']);
const RTL_LANGUAGES = new Set(['ar', 'he', 'iw', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb', 'ks']);

interface TextInfoLocale {
    textInfo?: { direction?: string };
    getTextInfo?: () => { direction?: string };
}

/** The writing direction of a locale's script: `'rtl'` for Arabic, Hebrew, Persian,
 *  Urdu and the other right-to-left scripts, `'ltr'` otherwise. */
export function localeDirection(tag: string): 'ltr' | 'rtl' {
    const loc = parseLocale(tag);
    if (loc) {
        try {
            const tl = loc as unknown as TextInfoLocale;
            const info = typeof tl.getTextInfo === 'function' ? tl.getTextInfo() : tl.textInfo;
            if (info?.direction === 'rtl' || info?.direction === 'ltr') return info.direction;
        } catch {
            /* no text info on this engine: infer from the script */
        }
        try {
            const script = loc.script ?? loc.maximize().script;
            if (script) return RTL_SCRIPTS.has(script) ? 'rtl' : 'ltr';
        } catch {
            /* fall through to the language list */
        }
    }
    return RTL_LANGUAGES.has(languageOf(tag)) ? 'rtl' : 'ltr';
}

const numberingCache = new Map<string, string>();

/**
 * The numbering system chart numbers use. An explicit choice wins (`'latn'`, `'arab'`, …;
 * `'locale'` = the locale's own default); without one, a `-u-nu-` extension in the tag;
 * otherwise Western digits, `'latn'`, in every language. An id the engine does not know
 * falls back to `'latn'`.
 */
export function resolveNumberingSystem(tag: string, requested: string | undefined): string {
    const key = `${tag}|${requested ?? ''}`;
    const cached = numberingCache.get(key);
    if (cached) return cached;
    let nu = 'latn';
    try {
        if (requested === 'locale') nu = new Intl.NumberFormat(tag).resolvedOptions().numberingSystem;
        else if (requested) nu = new Intl.NumberFormat(tag, { numberingSystem: requested }).resolvedOptions().numberingSystem;
        else {
            const ext = parseLocale(tag)?.numberingSystem;
            if (ext) nu = new Intl.NumberFormat(tag).resolvedOptions().numberingSystem;
        }
    } catch {
        nu = 'latn';
    }
    numberingCache.set(key, nu);
    return nu;
}
