// Drawing-tool shortcut hints for the toolbar flyouts — derived from the live keymap
// (src/widget/tool-shortcuts.ts), so they track the platform formatting and user rebinds.
import { describe, it, expect } from 'vitest';
import { KeymapManager } from '../src/ui/keymap';
import { toolShortcutHints } from '../src/widget/tool-shortcuts';

function keymapWithDefaults(platform: 'mac' | 'other'): KeymapManager {
    const km = new KeymapManager({ platform });
    const noop = (): void => {};
    km.register({ id: 'drawings.trendline', keys: 'alt+t', label: 'Arm the trend line tool', run: noop });
    km.register({ id: 'drawings.hline-cursor', keys: 'alt+h', label: 'Horizontal line at the cursor price', run: noop });
    km.register({ id: 'drawings.vline-cursor', keys: 'alt+v', label: 'Vertical line at the cursor time', run: noop });
    km.register({ id: 'chart.reset-view', keys: 'alt+r', label: 'Reset view', run: noop }); // unrelated → no hint
    return km;
}

describe('toolShortcutHints', () => {
    it('maps the bound drawing tools to platform-formatted display strings', () => {
        expect(toolShortcutHints(keymapWithDefaults('other'))).toEqual({
            trendline: 'Alt+T',
            hline: 'Alt+H',
            vline: 'Alt+V',
        });
    });

    it('uses mac glyphs on macOS', () => {
        expect(toolShortcutHints(keymapWithDefaults('mac'))).toEqual({
            trendline: '⌥T',
            hline: '⌥H',
            vline: '⌥V',
        });
    });

    it('respects a user rebind (hints follow the ACTIVE chord, not the default)', () => {
        const km = keymapWithDefaults('other');
        km.rebind('drawings.trendline', 'mod+shift+t');
        expect(toolShortcutHints(km).trendline).toBe('Ctrl+Shift+T');
    });

    it('omits tools whose binding is missing', () => {
        const km = new KeymapManager({ platform: 'other' });
        km.register({ id: 'drawings.trendline', keys: 'alt+t', label: 'Trend line', run: () => {} });
        const hints = toolShortcutHints(km);
        expect(hints).toEqual({ trendline: 'Alt+T' });
        expect(hints.hline).toBeUndefined();
    });
});
