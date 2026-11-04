// @vitest-environment jsdom
// Where a contributed topbar action lands on the mobile layout: a bottom-bar stop (left
// actions by default) or a three-dots menu row (right actions by default) — and a
// menu-placed LEFT action sits with the primary rows, right after Layout.
import { describe, it, expect, afterEach } from 'vitest';
import { MobileBar } from '../src/widget/mobile-bar';
import { MoreDrawer } from '../src/widget/more-drawer';
import { mobilePlacement, registerWidgetAction, unregisterWidgetAction, type WidgetContext } from '../src/widget/contributions';

if (typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s.replace(/([^\w-])/g, '\\$1') };
}

afterEach(() => {
    unregisterWidgetAction('t.bar');
    unregisterWidgetAction('t.menu');
    document.body.replaceChildren();
});

describe('mobile placement', () => {
    it('defaults: left actions on the bar, the rest in the menu; `mobile` overrides', () => {
        expect(mobilePlacement({ align: 'left' })).toBe('bar');
        expect(mobilePlacement({})).toBe('menu');
        expect(mobilePlacement({ align: 'right' })).toBe('menu');
        expect(mobilePlacement({ align: 'left', mobile: 'menu' })).toBe('menu');
        expect(mobilePlacement({ align: 'right', mobile: 'bar' })).toBe('bar');
    });

    it('the bottom bar carries only the bar-placed actions', () => {
        registerWidgetAction({ id: 't.bar', target: 'topbar', label: 'On bar', align: 'left', run: () => {} });
        registerWidgetAction({ id: 't.menu', target: 'topbar', label: 'In menu', align: 'left', mobile: 'menu', run: () => {} });
        const host = document.createElement('div');
        document.body.appendChild(host);
        new MobileBar(host, {
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '60',
            onSymbolClick: () => {},
            onTimeframeClick: () => {},
            onMoreClick: () => {},
            onSettingsClick: () => {},
            getContext: () => ({}) as WidgetContext,
        });
        const stops = [...host.querySelectorAll('.vela-mb-actions button')].map((b) => b.getAttribute('aria-label'));
        expect(stops).toEqual(['On bar']);
    });

    it('a bar stop names its action, and re-rendering asks `when` again', () => {
        let mobile = false;
        registerWidgetAction({ id: 't.bar', target: 'topbar', label: 'Phone only', align: 'left', when: () => mobile, run: () => {} });
        const host = document.createElement('div');
        document.body.appendChild(host);
        const bar = new MobileBar(host, {
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '60',
            onSymbolClick: () => {},
            onTimeframeClick: () => {},
            onMoreClick: () => {},
            onSettingsClick: () => {},
            getContext: () => ({}) as WidgetContext,
        });
        expect(host.querySelector('[data-action-id="t.bar"]')).toBeNull();
        mobile = true;
        bar.renderActions();
        expect(host.querySelector('.vela-mb-actions [data-action-id="t.bar"]')?.getAttribute('aria-label')).toBe('Phone only');
    });

    it('the indicators stop hides and comes back', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const bar = new MobileBar(host, {
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '60',
            onSymbolClick: () => {},
            onTimeframeClick: () => {},
            onIndicatorsClick: () => {},
            onMoreClick: () => {},
            onSettingsClick: () => {},
            getContext: () => ({}) as WidgetContext,
        });
        const stop = host.querySelector<HTMLElement>('.vela-mb-indicators')!;
        bar.setIndicatorsVisible(false);
        expect(stop.hidden).toBe(true);
        bar.setIndicatorsVisible(true);
        expect(stop.hidden).toBe(false);
    });

    it('the menu lists primary actions right after Layout, the others at the end', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const drawer = new MoreDrawer({
            host,
            canUndo: () => false,
            canRedo: () => false,
            priceStyles: () => [{ id: 'candles', label: 'Candles' }],
            priceStyle: () => 'candles',
            onPriceStyle: () => {},
            panels: () => [{ id: 'dataWindow', title: 'Data window', icon: 'datawindow' }],
            onTogglePanel: () => {},
            primaryActions: () => [{ label: 'Replay', icon: 'replay', run: () => {} }],
            actions: () => [{ label: 'Tool', run: () => {} }],
            layout: { shape: () => ({ rows: 2, cols: 2 }), presets: () => [], onSelectGrid: () => {}, onSelectPreset: () => {} },
        });
        drawer.open();
        const rows = [...document.querySelectorAll('.vela-md-row .vela-md-row-label')].map((e) => e.textContent);
        expect(rows).toEqual(['Chart type', 'Layout', 'Replay', 'Data window', 'Tool']);
        drawer.destroy();
    });
});
