// @vitest-environment jsdom
// The mobile bar's maximize stop: present only when the shell passes a toggle, and
// hideable at runtime — the workspace hides it while the grid holds a single chart.
import { describe, it, expect } from 'vitest';
import { MobileBar } from '../src/widget/mobile-bar';

// jsdom ships no `CSS.escape`; the style injector needs it for its id lookup.
if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

function mount(withMaximize: boolean): { bar: MobileBar; stop: () => HTMLButtonElement | null } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const bar = new MobileBar(host, {
        symbol: 'BINANCE:BTCUSDT',
        timeframe: '60',
        onSymbolClick: () => {},
        onTimeframeClick: () => {},
        onMoreClick: () => {},
        onSettingsClick: () => {},
        ...(withMaximize ? { onMaximizeClick: () => {} } : {}),
    });
    return { bar, stop: () => host.querySelector<HTMLButtonElement>('.vela-mb-maximize') };
}

describe('MobileBar maximize stop', () => {
    it('is absent when the shell has nothing to isolate (single-chart mode)', () => {
        const { stop } = mount(false);
        expect(stop()).toBeNull();
    });

    it('is shown by default and hidden/re-shown through setMaximizeVisible', () => {
        const { bar, stop } = mount(true);
        expect(stop()).not.toBeNull();
        expect(stop()!.hidden).toBe(false);

        bar.setMaximizeVisible(false); // the grid dropped to one cell
        expect(stop()!.hidden).toBe(true);

        bar.setMaximizeVisible(true); // back to a multi-chart layout
        expect(stop()!.hidden).toBe(false);
    });

    it('keeps the lit state independent of visibility', () => {
        const { bar, stop } = mount(true);
        bar.setMaximizeActive(true);
        bar.setMaximizeVisible(false);
        expect(stop()!.classList.contains('vela-mb-on')).toBe(true);
        expect(stop()!.hidden).toBe(true);
    });
});
