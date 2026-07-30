// Drawing-tool shortcut hints — maps the widget/workspace keymap bindings that arm or
// place a specific drawing tool onto that tool's type, as platform-formatted display
// strings (from `KeymapManager.bindings()`, so user rebinds are respected). The result
// is pushed to the drawing toolbar, which shows each hint beside its tool in the flyout.
import type { KeymapManager } from '../ui/keymap';
import type { DrawingTypeKey } from '../core/drawings';

/** Binding id → the drawing tool its chord arms/places. */
const TOOL_BINDINGS: readonly (readonly [DrawingTypeKey, string])[] = [
    ['trendline', 'drawings.trendline'],
    ['hline', 'drawings.hline-cursor'],
    ['vline', 'drawings.vline-cursor'],
];

/** Per-tool shortcut hints (display strings) for the toolbar flyouts, from the live keymap. */
export function toolShortcutHints(keymap: KeymapManager): Partial<Record<DrawingTypeKey, string>> {
    const byId = new Map(keymap.bindings().map((b) => [b.id, b.display[0]]));
    const out: Partial<Record<DrawingTypeKey, string>> = {};
    for (const [type, id] of TOOL_BINDINGS) {
        const display = byId.get(id);
        if (display) out[type] = display;
    }
    return out;
}
