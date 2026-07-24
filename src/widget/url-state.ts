// URL state — share the widget's market/view via query params (`?symbol=ETHUSDT&
// interval=15&style=heikinashi&tz=Europe/Paris`). Read once at construction (URL wins
// over persisted state — a shared link means explicit intent); written back with
// replaceState on every change so the address bar is always shareable.
import type { PersistedState } from './persist';

const PARAMS: ReadonlyArray<[key: keyof PersistedState, param: string]> = [
    ['symbol', 'symbol'],
    ['timeframe', 'interval'],
    ['priceStyle', 'style'],
    ['timezone', 'tz'],
    ['bars', 'bars'],
];

export function readUrlState(search: string): PersistedState {
    const out: PersistedState = {};
    try {
        const q = new URLSearchParams(search);
        for (const [key, param] of PARAMS) {
            const v = q.get(param);
            if (v) out[key] = v;
        }
    } catch {
        /* malformed search — ignore */
    }
    return out;
}

export function writeUrlState(state: PersistedState): void {
    if (typeof history === 'undefined' || typeof location === 'undefined') return;
    try {
        const q = new URLSearchParams(location.search);
        for (const [key, param] of PARAMS) {
            const v = state[key];
            if (v) q.set(param, v);
            else q.delete(param);
        }
        const qs = q.toString();
        history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
    } catch {
        /* sandboxed/about:blank — ignore */
    }
}
