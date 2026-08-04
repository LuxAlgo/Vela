// Timezone catalog + labels — canonical data lives in the core (`src/core/timezones`)
// so the renderer's settings dialog shares the exact same list; re-exported here to keep
// the widget's public surface stable.
export { TIMEZONES, normalizeTimezone, tzOffset, tzMenuLabel, tzButtonLabel, type TimezoneEntry } from '../core/timezones';
