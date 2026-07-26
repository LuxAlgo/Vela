// The playground's CUSTOM persistence system — host code written against the documented
// storage contract (`WidgetStorage` ≡ `WorkspaceStorage`: get/set, sync or async),
// shared by the widget and workspace demo pages. It backs onto localStorage under a
// `vela-play:` namespace, so everything OUR adapter wrote is obvious in devtools and
// never collides with the widget's built-in default adapter.
import type { Vela } from '../src';
import type { WidgetStorage } from '../src/widget';

const PREFIX = 'vela-play:';

/** The one custom storage adapter both demo pages inject via their `storage` option. */
export function playgroundStorage(): WidgetStorage {
    return {
        get: (key) => window.localStorage.getItem(PREFIX + key),
        set: (key, value) => {
            window.localStorage.setItem(PREFIX + key, value);
        },
        remove: (key) => {
            window.localStorage.removeItem(PREFIX + key);
        },
    };
}

/**
 * Persist a chart's user drawings through the same adapter — the HOST-side composition
 * the docs describe for the WIDGET, whose own `persist` covers preferences, not content
 * (the workspace needs none of this: drawings live inside its state document natively).
 * Restores the saved document once, then saves on every drawing change (debounced, with
 * a beforeunload flush so a draw-then-reload never loses the last edit).
 */
export function persistDrawings(chart: Vela, storage: WidgetStorage, key: string): () => void {
    const restore = (raw: string | null): void => {
        if (!raw) return;
        try {
            chart.drawings.fromJSON(JSON.parse(raw));
        } catch {
            // A corrupt document must never break the page — start with a clean slate.
        }
    };
    const raw = storage.get(key);
    if (raw == null || typeof raw === 'string') restore(raw);
    else void raw.then(restore); // the contract allows async backends

    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (): void => {
        if (timer == null) return; // nothing pending
        clearTimeout(timer);
        timer = null;
        void storage.set(key, JSON.stringify(chart.drawings.toJSON()));
    };
    const save = (): void => {
        if (timer != null) clearTimeout(timer);
        timer = setTimeout(flush, 500);
    };
    const offs = [chart.on('drawing:created', save), chart.on('drawing:edited', save), chart.on('drawing:removed', save)];
    window.addEventListener('beforeunload', flush);
    return () => {
        flush();
        window.removeEventListener('beforeunload', flush);
        for (const off of offs) off();
    };
}
