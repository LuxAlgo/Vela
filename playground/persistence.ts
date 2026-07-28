// The playground's CUSTOM persistence backend — host code written against the
// documented storage contract (`WidgetStorage` ≡ `WorkspaceStorage`: get/set, sync or
// async), shared by the widget and workspace demo pages. It backs onto localStorage
// under a `vela-play:` namespace, so everything OUR adapter wrote is obvious in
// devtools and never collides with the widget's built-in default adapter.
//
// The adapter is the WHOLE integration: with `persist` enabled, both shells persist
// everything themselves — prefs, renderer config, AND user drawings — through it.
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
