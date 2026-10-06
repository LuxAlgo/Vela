// The chart context menu's pointer (src/widget/context-menu.ts): contributed `context:*`
// actions read where the right-click landed from `ctx.pointer` — the crosshair as it
// stood when the menu OPENED, handed to both `when` and `run` — and their rows sort in
// with the built-in ones. Node env: the kit Menu is replaced by a recorder and the chart
// by a fake renderer; the real menu and crosshair are proven in the browser.
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CrosshairEvent } from '../src/core/ports/IChartRenderer';
import type { MenuItemDescriptor } from '../src/ui/components/menu';
import type { Vela } from '../src/Vela';
import { registerWidgetAction, type ContextMenuPointer, type WidgetContext } from '../src/widget/contributions';
import { ChartContextMenu } from '../src/widget/context-menu';

const menus = vi.hoisted(() => [] as Array<{ items: readonly MenuItemDescriptor[]; select: (id: string) => void; opened: number }>);

vi.mock('../src/ui/components/menu', () => ({
    Menu: class {
        private readonly rec: (typeof menus)[number];
        constructor(opts: { onSelect?: (id: string) => void }) {
            this.rec = { items: [], select: (id) => opts.onSelect?.(id), opened: 0 };
            menus.push(this.rec);
        }
        setItems(items: readonly MenuItemDescriptor[]): void {
            this.rec.items = items;
        }
        openAt(): void {
            this.rec.opened += 1;
        }
        destroy(): void {}
    },
}));

type Listener = (e: unknown) => void;

function fakeHost(): HTMLElement & { fire(type: string, e: Record<string, unknown>): void } {
    const listeners = new Map<string, Listener[]>();
    return {
        addEventListener: (t: string, fn: Listener) => listeners.set(t, [...(listeners.get(t) ?? []), fn]),
        removeEventListener: (t: string, fn: Listener) => listeners.set(t, (listeners.get(t) ?? []).filter((f) => f !== fn)),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        fire(t: string, e: Record<string, unknown>) {
            for (const fn of listeners.get(t) ?? []) fn({ preventDefault: () => {}, ...e });
        },
    } as unknown as HTMLElement & { fire(type: string, e: Record<string, unknown>): void };
}

function fakeChart(): { chart: Vela; move(e: Partial<CrosshairEvent>): void; subscribers(): number } {
    const cbs = new Set<(e: CrosshairEvent) => void>();
    const chart = {
        renderer: {
            onCrosshairMove: (cb: (e: CrosshairEvent) => void) => {
                cbs.add(cb);
                return () => cbs.delete(cb);
            },
            get: () => undefined,
            set: () => undefined,
            openSettings: () => undefined,
        },
        drawings: { supported: false, all: () => [] },
        indicators: () => [],
    } as unknown as Vela;
    return {
        chart,
        move: (e) => {
            for (const cb of cbs) cb({ time: null, price: null, values: new Map(), ohlc: null, ...e });
        },
        subscribers: () => cbs.size,
    };
}

/** A context whose `symbol` is a LIVE getter, like the shells' own. */
function liveContext(): { ctx: WidgetContext; setSymbol(s: string): void } {
    let symbol = 'BTCUSDT';
    const ctx = {
        get symbol() {
            return symbol;
        },
    } as unknown as WidgetContext;
    return { ctx, setSymbol: (s) => (symbol = s) };
}

const disposers: Array<() => void> = [];
afterEach(() => {
    for (const d of disposers.splice(0)) d();
    menus.length = 0;
});

interface Seen {
    when: Array<ContextMenuPointer | undefined>;
    run: Array<ContextMenuPointer | undefined>;
    /** The context `run` received, kept past the call. */
    runCtx: WidgetContext[];
}

function setup(): { host: ReturnType<typeof fakeHost>; fake: ReturnType<typeof fakeChart>; menu: ChartContextMenu; live: ReturnType<typeof liveContext>; seen: Seen } {
    const seen: Seen = { when: [], run: [], runCtx: [] };
    disposers.push(
        registerWidgetAction({
            id: 'test.copy-price',
            target: 'context:body',
            label: 'Copy price',
            icon: 'clone',
            order: -100,
            when: (ctx) => {
                seen.when.push(ctx.pointer);
                return true;
            },
            run: (ctx) => {
                seen.run.push(ctx.pointer);
                seen.runCtx.push(ctx);
            },
        }),
    );
    const host = fakeHost();
    const live = liveContext();
    const menu = new ChartContextMenu(host, { resetView: () => undefined, getContext: () => live.ctx });
    const fake = fakeChart();
    menu.onChart(fake.chart);
    return { host, fake, menu, live, seen };
}

describe('ChartContextMenu — the pointer on the action context', () => {
    it('hands `when` and `run` the crosshair captured when the menu opened', () => {
        const { host, fake, seen } = setup();
        fake.move({ time: 1_700_000_000_000, price: 42_123.5, paneKind: 'price' });
        host.fire('contextmenu', { clientX: 300, clientY: 200 });
        const expected = { price: 42_123.5, time: 1_700_000_000_000, paneKind: 'price' };
        expect(seen.when).toEqual([expected]);
        // The pointer travels through the menu (and off the chart) before the row is picked.
        fake.move({ time: 1_700_000_060_000, price: 41_000, paneKind: 'price' });
        fake.move({});
        menus[0]!.select('action:test.copy-price');
        expect(seen.run).toEqual([expected]);
        // `when` is re-checked at selection against the same open-time pointer.
        expect(seen.when).toEqual([expected, expected]);
    });

    it('reports a study pane by kind, and nulls off the plot', () => {
        const { host, fake, seen } = setup();
        fake.move({ time: 5, price: 61.2, paneKind: 'study' });
        host.fire('contextmenu', { clientX: 300, clientY: 500 });
        menus[0]!.select('action:test.copy-price');
        expect(seen.run).toEqual([{ price: 61.2, time: 5, paneKind: 'study' }]);

        fake.move({ time: null, price: null, paneKind: null });
        host.fire('contextmenu', { clientX: 300, clientY: 200 });
        menus[0]!.select('action:test.copy-price');
        expect(seen.run[1]).toEqual({ price: null, time: null, paneKind: null });
    });

    it('keeps the context LIVE: the pointer is added without freezing its getters', () => {
        const { host, fake, live, seen } = setup();
        fake.move({ time: 1, price: 2, paneKind: 'price' });
        host.fire('contextmenu', { clientX: 300, clientY: 200 });
        menus[0]!.select('action:test.copy-price');
        const ctx = seen.runCtx[0]!;
        expect(ctx.symbol).toBe('BTCUSDT');
        live.setSymbol('ETHUSDT');
        expect(ctx.symbol).toBe('ETHUSDT');
        expect(Object.keys(ctx)).toEqual(['symbol', 'pointer']);
        // The shell's own context is left as it was.
        expect(live.ctx.pointer).toBeUndefined();
    });

    it('follows the chart it is bound to, and lets go of it on rebind and destroy', () => {
        const { host, fake, menu, seen } = setup();
        const next = fakeChart();
        menu.onChart(next.chart);
        expect(fake.subscribers()).toBe(0);
        fake.move({ time: 1, price: 1, paneKind: 'price' });
        next.move({ time: 2, price: 99, paneKind: 'price' });
        host.fire('contextmenu', { clientX: 300, clientY: 200 });
        expect(seen.when).toEqual([{ price: 99, time: 2, paneKind: 'price' }]);
        menu.destroy();
        expect(next.subscribers()).toBe(0);
    });

    it('lists the order -100 action first, then the built-in rows with Settings… last', () => {
        const { host, fake } = setup();
        fake.move({ time: 1, price: 2, paneKind: 'price' });
        host.fire('contextmenu', { clientX: 300, clientY: 200 });
        const items = menus[0]!.items;
        expect(items.map((i) => i.id)).toEqual(['action:test.copy-price', 'reset-view', 'remove-drawings', 'remove-indicators', 'settings:Canvas']);
        expect(items[0]).toMatchObject({ label: 'Copy price', icon: 'clone', separatorBefore: false });
        expect(items[1]!.separatorBefore).toBe(true);
        expect(menus[0]!.opened).toBe(1);
    });
});
