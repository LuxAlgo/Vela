/**
 * Why a source refuses a series for good. `'timeframe'`: the series is not served at the
 * requested timeframe (a monthly economic series asked for hourly bars). Open to further
 * reasons; a consumer that meets one it does not know treats it as a plain refusal.
 */
export type DataUnavailableReason = 'timeframe' | (string & {});

/** What a {@link DataUnavailableError} carries — every field plain data. */
export interface DataUnavailableDetails {
    reason: DataUnavailableReason;
    /** The refused symbol, as the source names it. */
    symbol?: string;
    /** The refused timeframe. */
    timeframe?: string;
    /** The finest timeframe the source serves this symbol at. */
    finest?: string;
    /** The timeframe the source suggests showing this symbol at. */
    default?: string;
}

const NAME = 'DataUnavailableError';

/**
 * Thrown by a data provider (or a custom feed) to say a series is PERMANENTLY not served —
 * as opposed to a transient failure, which keeps reading as an empty answer. On the chart's
 * own series it ends the load, stops live updates and fires `data:unavailable`; on a
 * secondary series (`request.security`) the engine's fetch rejects with it.
 *
 * The default message is built from the fields, because engines flatten errors to their
 * message. Detect it with {@link isDataUnavailableError}, never `instanceof`: a provider
 * may bundle its own copy of Vela, whose class is a different one.
 */
export class DataUnavailableError extends Error {
    override readonly name = NAME;
    readonly reason: DataUnavailableReason;
    readonly symbol?: string;
    readonly timeframe?: string;
    readonly finest?: string;
    readonly default?: string;

    constructor(details: DataUnavailableDetails, message?: string) {
        super(message ?? dataUnavailableMessage(details));
        this.reason = details.reason;
        if (details.symbol !== undefined) this.symbol = details.symbol;
        if (details.timeframe !== undefined) this.timeframe = details.timeframe;
        if (details.finest !== undefined) this.finest = details.finest;
        if (details.default !== undefined) this.default = details.default;
    }
}

/** The self-explaining default message: `GDP is not served at 60; its finest timeframe is 1D`. */
export function dataUnavailableMessage(d: DataUnavailableDetails): string {
    const what = d.symbol ?? 'The series';
    if (d.reason === 'timeframe') {
        const hints: string[] = [];
        if (d.finest !== undefined) hints.push(`its finest timeframe is ${d.finest}`);
        if (d.default !== undefined && d.default !== d.finest) hints.push(`its default timeframe is ${d.default}`);
        return `${what} is not served at ${d.timeframe ?? 'this timeframe'}${hints.length > 0 ? `; ${hints.join(', ')}` : ''}`;
    }
    return `${what}${d.timeframe !== undefined ? ` at ${d.timeframe}` : ''} is not available (${d.reason})`;
}

const optionalString = (v: unknown): boolean => v === undefined || typeof v === 'string';

/**
 * Whether `e` is a {@link DataUnavailableError} — from this copy of Vela or any other: it
 * reads the `name` and the fields, never the class.
 */
export function isDataUnavailableError(e: unknown): e is DataUnavailableError {
    if (typeof e !== 'object' || e === null) return false;
    const o = e as Record<string, unknown>;
    return (
        o.name === NAME &&
        typeof o.reason === 'string' &&
        typeof o.message === 'string' &&
        optionalString(o.symbol) &&
        optionalString(o.timeframe) &&
        optionalString(o.finest) &&
        optionalString(o.default)
    );
}
