import type { DataProvider, ProviderInfo, SymbolDescriptor } from '../core/ports/DataProvider';
import type { Unsubscribe } from '../core/util/types';

/** A symbol resolved to a registered provider. */
export interface Resolved {
    /** Registered provider name (normalized — lower-case). */
    provider: string;
    /** Ticker the provider expects (any `provider:` prefix stripped, any `.ext` kept). */
    ticker: string;
}

/** The parts of a raw symbol string. */
export interface ParsedSymbol {
    /** Lower-cased provider segment, or null when the symbol is bare. */
    provider: string | null;
    /** Everything after the `provider:` prefix (includes any `.ext`). */
    ticker: string;
    /** Best-effort trailing `.ext` token (provider-defined, never used for routing). */
    ext?: string;
}

interface Entry {
    name: string;
    provider: DataProvider;
    /** Normalized tickers this provider serves; null = not (yet) enumerated. */
    index: Set<string> | null;
    descriptors: SymbolDescriptor[];
    /** The index build finished (success OR failure). */
    settled: boolean;
    /** Resolves when the index build finishes. */
    settle: Promise<void>;
}

const normName = (n: string): string => n.trim().toLowerCase();
const normTicker = (t: string): string => t.trim().toUpperCase();

/**
 * Split a raw symbol string into its parts — THE symbol grammar, shared by everything
 * that reads one. The provider prefix may carry a dotted qualifier: a venue's
 * regional/market variant is its own provider (e.g. `BINANCE.US:BTCUSDT`), never a
 * modifier on the base venue. Case-insensitive on the prefix (normalized lower).
 */
export function parseSymbol(raw: string): ParsedSymbol {
    const s = raw.trim();
    const m = /^(?:([A-Za-z0-9_.]+):)?(.+)$/.exec(s);
    if (!m) return { provider: null, ticker: s };
    const provider = m[1] ? normName(m[1]) : null;
    const ticker = m[2]!;
    const dot = ticker.lastIndexOf('.');
    const ext = dot > 0 ? ticker.slice(dot + 1) : undefined;
    return { provider, ticker, ext };
}

/**
 * Holds the registered data providers, builds each provider's symbol index at
 * registration (eager), and resolves a symbol string to `{ provider, ticker }`.
 *
 * Resolution: an explicit `name:SYMBOL` prefix routes to that provider (no index
 * needed); a bare `SYMBOL` routes to the first provider — in **registration
 * order**, the chart's default tried first — whose index contains it. `lenient`
 * mode (used for the primary chart load) lets a *sole* registered provider serve
 * a bare symbol optimistically before its index is built, so first paint isn't
 * gated on enumerating thousands of symbols.
 */
export class ProviderRegistry {
    /** Insertion order = registration order (relied on by bare resolution). */
    private readonly entries = new Map<string, Entry>();
    /** Listeners fired on any registry change; `settled` = an index build just finished. */
    private readonly changeListeners = new Set<(settled: boolean) => void>();
    /** Cancellers for the currently parked `whenResolvable` waits. */
    private readonly waits = new Set<() => void>();
    /** Listeners told when a parked symbol stays unresolvable after an index settles. */
    private readonly unresolvedCbs = new Set<(info: { symbol: string; providers: string[] }) => void>();

    /** Register (or replace) a provider; returns a promise that settles when its index is built. */
    register(rawName: string, provider: DataProvider): Promise<void> {
        const name = normName(rawName);
        const entry: Entry = { name, provider, index: null, descriptors: [], settled: false, settle: Promise.resolve() };
        this.entries.set(name, entry);
        entry.settle = this.buildIndex(entry);
        // Re-check parked loads on the next microtask — batches a synchronous burst of
        // registrations so a multi-provider bare symbol isn't resolved against the first
        // one before the rest are in. Explicit `name:SYMBOL` resolves here (no index wait).
        queueMicrotask(() => this.notify(false));
        return entry.settle;
    }

    private async buildIndex(entry: Entry): Promise<void> {
        // Always yield once so a synchronous burst of registrations is fully in place
        // before the first index settles (keeps multi-provider resolution well-defined).
        await Promise.resolve();
        try {
            if (entry.provider.listSymbols) {
                const symbols = await entry.provider.listSymbols();
                entry.descriptors = symbols;
                entry.index = new Set(symbols.map((s) => normTicker(s.ticker)));
            }
        } catch {
            // Enumeration failed — non-fatal. Explicit-prefix routing still works;
            // bare resolution falls back to the lenient sole-provider path.
            entry.index = null;
        } finally {
            entry.settled = true;
            this.notify(true);
        }
    }

    private notify(settled: boolean): void {
        for (const cb of [...this.changeListeners]) cb(settled);
    }

    /** Fires on each registry change (`settled` true after an index build finishes). */
    onChange(cb: (settled: boolean) => void): Unsubscribe {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }

    unregister(rawName: string): void {
        this.entries.delete(normName(rawName));
        // Notify so any parked whenResolvable() listener re-evaluates against the new set
        // (and so resolution never depends on a stale, removed provider).
        this.notify(false);
    }

    has(rawName: string): boolean {
        return this.entries.has(normName(rawName));
    }

    get(rawName: string): DataProvider | undefined {
        return this.entries.get(normName(rawName))?.provider;
    }

    /** Registered provider names in registration order. */
    names(): string[] {
        return [...this.entries.keys()];
    }

    parse(raw: string): ParsedSymbol {
        return parseSymbol(raw);
    }

    /**
     * Resolve a symbol to `{ provider, ticker }`, or null when nothing can serve it
     * yet. Explicit prefix → that provider (must be registered). Bare → first
     * indexed provider (registration order, `opts.default` first) that contains the
     * ticker; `opts.lenient` additionally allows a sole registered provider before
     * its index exists.
     */
    resolve(raw: string, opts: { default?: string | null; lenient?: boolean } = {}): Resolved | null {
        const { provider, ticker } = this.parse(raw);
        if (provider) return this.entries.has(provider) ? { provider, ticker } : null;

        const norm = normTicker(ticker);
        for (const name of this.candidateOrder(opts.default)) {
            if (this.entries.get(name)!.index?.has(norm)) return { provider: name, ticker };
        }

        // Lenient (primary load only): a SOLE registered provider that cannot be
        // indexed (no `listSymbols`, or enumeration failed) is used optimistically —
        // there's no index to consult, so the getBars call itself confirms support. An
        // enumerable provider is NOT short-circuited: we wait for its index so an
        // unsupported symbol stays parked instead of rendering an empty chart.
        if (opts.lenient && this.entries.size === 1) {
            const only = this.names()[0]!;
            const e = this.entries.get(only)!;
            if (e.settled && e.index == null) return { provider: only, ticker };
        }
        return null;
    }

    /**
     * Resolve now if possible, else resolve later — re-attempting after each provider
     * settles. The promise stays pending until some registered provider can serve the
     * symbol (a dev-console warning is emitted on each unsuccessful round).
     */
    whenResolvable(raw: string, opts: { default?: string | null } = {}): Promise<Resolved> {
        const immediate = this.resolve(raw, { ...opts, lenient: true });
        if (immediate) return Promise.resolve(immediate);
        return new Promise<Resolved>((resolve) => {
            const off = this.onChange((settled) => {
                const r = this.resolve(raw, { ...opts, lenient: true });
                if (r) {
                    stop();
                    resolve(r);
                } else if (settled && this.allSettled()) {
                    // Report only once EVERY registered provider has finished indexing. One
                    // index settling proves nothing: with several providers the first to finish
                    // is usually not the one that serves the symbol, and reporting there is a
                    // false verdict — the user sees "no provider serves X" on a symbol that
                    // resolves a moment later.
                    this.reportUnresolved(raw);
                }
            });
            // A parked wait outlives its chart unless it is cancellable: every rebuild over an
            // unservable symbol would otherwise leave its listener behind for the page's life.
            const stop = (): void => {
                off();
                this.waits.delete(stop);
            };
            this.waits.add(stop);
        });
    }

    /** Every registered provider has finished building its index (or failed trying). */
    private allSettled(): boolean {
        for (const e of this.entries.values()) if (!e.settled) return false;
        return true;
    }

    /** Abandon every parked wait (chart/feed teardown). Their promises simply never settle. */
    cancelWaits(): void {
        for (const stop of [...this.waits]) stop();
    }

    /** Notified when a parked symbol is still unresolvable after an index settles. */
    onUnresolved(cb: (info: { symbol: string; providers: string[] }) => void): Unsubscribe {
        this.unresolvedCbs.add(cb);
        return () => this.unresolvedCbs.delete(cb);
    }

    private reportUnresolved(raw: string): void {
        const names = this.names();
        console.warn(
            `[vela] symbol "${raw}" not yet resolvable — registered providers: ` +
                `[${names.join(', ') || 'none'}]. Register a provider that serves it.`,
        );
        for (const cb of this.unresolvedCbs) cb({ symbol: raw, providers: names });
    }

    private candidateOrder(def?: string | null): string[] {
        const names = this.names();
        if (def) {
            const d = normName(def);
            if (this.entries.has(d)) return [d, ...names.filter((n) => n !== d)];
        }
        return names;
    }

    /** Indexed symbols for one provider (or all, concatenated) — for autocomplete. */
    symbolsOf(rawName?: string): SymbolDescriptor[] {
        if (rawName != null) return this.entries.get(normName(rawName))?.descriptors ?? [];
        return [...this.entries.entries()].flatMap(([name, e]) => e.descriptors.map((d) => ({ ...d, provider: name })));
    }

    /** Provider metadata: the provider's own `info()` if present, else synthesized from its methods. */
    infoOf(rawName: string): ProviderInfo {
        const name = normName(rawName);
        const e = this.entries.get(name);
        if (!e) return { name, capabilities: { enumerate: false, stream: false, symbolInfo: false } };
        const p = e.provider;
        return (
            p.info?.() ?? {
                name: e.name,
                capabilities: { enumerate: !!p.listSymbols, stream: !!p.subscribe, symbolInfo: !!p.getSymbolInfo },
            }
        );
    }

    /** Resolves when every currently-registered provider's index has settled. */
    indexReady(): Promise<void> {
        return Promise.all([...this.entries.values()].map((e) => e.settle)).then(() => undefined);
    }
}
