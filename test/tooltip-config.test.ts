// @vitest-environment jsdom
// One tooltip configuration for all of Vela: the shared hover delay (kit tooltips AND the
// renderer's chrome tooltips) and the content hook every structured tooltip goes through.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { configureTooltips, tooltipConfig, tooltipContent, type TooltipInfo } from '../src/ui/tooltip-config';
import { Tooltip } from '../src/ui/components/tooltip/view';
import { tooltipController } from '../src/ui/components/tooltip/controller';
import { attachChromeTooltip, chromeHint } from '../src/renderers/shared/chrome-tooltip';
import { DrawingToolbar } from '../src/renderers/native/drawings/DrawingToolbar';
import { Topbar } from '../src/widget/topbar';
import { registerWidgetAction, unregisterWidgetAction, type WidgetContext } from '../src/widget/contributions';
import { drawingTypes } from '../src/core/drawings/registry';
import { defaultToolbar } from '../src/core/drawings/toolbar';
import { DARK_THEME } from '../src/core/theme';
import type { DrawingTypeKey } from '../src/core/drawings';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    configureTooltips({ openDelay: null, render: null });
    vi.useRealTimers();
    document.body.replaceChildren();
});

const theme = () => DARK_THEME;

/** A mouse entering an anchor — the only arming a chrome tooltip honors. */
function hover(el: HTMLElement): void {
    const e = new Event('pointerenter');
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    el.dispatchEvent(e);
}

/** The chrome tips currently mounted in a host (they carry the tooltip z-index token). */
function chromeTips(host: HTMLElement): HTMLElement[] {
    return [...host.children].filter((c): c is HTMLElement => (c as HTMLElement).style?.zIndex === 'var(--vela-z-tooltip)');
}

function hostEl(): HTMLElement {
    const host = document.createElement('div');
    host.className = 'vela-ui';
    document.body.append(host);
    return host;
}

describe('configureTooltips', () => {
    it('merges: an omitted field keeps its value, null resets it', () => {
        const render = () => null;
        configureTooltips({ openDelay: 300 });
        configureTooltips({ render });
        expect(tooltipConfig()).toEqual({ openDelay: 300, render });
        configureTooltips({});
        expect(tooltipConfig()).toEqual({ openDelay: 300, render });
        configureTooltips({ render: null });
        expect(tooltipConfig()).toEqual({ openDelay: 300, render: null });
        configureTooltips({ openDelay: null });
        expect(tooltipConfig()).toEqual({ openDelay: null, render: null });
    });

    it('clamps a negative delay to 0 and ignores, with a warning, what is not a delay', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        configureTooltips({ openDelay: -50 });
        expect(tooltipConfig().openDelay).toBe(0);
        configureTooltips({ openDelay: Number.NaN });
        expect(tooltipConfig().openDelay).toBe(0);
        configureTooltips({ render: 'nope' as unknown as null });
        expect(tooltipConfig().render).toBeNull();
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

describe('kit Tooltip delay', () => {
    it('follows the configured delay when constructed without one, and keeps an explicit one', () => {
        expect(tooltipController({}).props.openDelay).toBe(0);
        configureTooltips({ openDelay: 300 });
        expect(tooltipController({}).props.openDelay).toBe(300);
        expect(tooltipController({ openDelay: 50 }).props.openDelay).toBe(50);
    });

    it('a real kit tooltip opens only after the configured delay', async () => {
        vi.useFakeTimers();
        configureTooltips({ openDelay: 300 });
        const host = hostEl();
        const trigger = document.createElement('button');
        host.append(trigger);
        const tip = new Tooltip(trigger, { content: 'Hello', host });
        const content = host.querySelector('.vela-tooltip') as HTMLElement;
        trigger.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(290);
        expect(content.dataset.state).toBe('closed');
        await vi.advanceTimersByTimeAsync(20);
        expect(content.dataset.state).toBe('open');
        tip.destroy();
    });
});

describe('chrome tooltip delay', () => {
    function armDelay(make: (anchor: HTMLElement, host: HTMLElement) => void): number {
        const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
        const host = hostEl();
        const anchor = document.createElement('button');
        host.append(anchor);
        make(anchor, host);
        hover(anchor);
        const calls = setTimeoutSpy.mock.calls;
        const delay = calls[calls.length - 1]?.[1];
        setTimeoutSpy.mockRestore();
        return delay as number;
    }

    it('keeps the 700 ms default and the hints’ 250 ms when nothing is configured', () => {
        expect(armDelay((anchor, host) => attachChromeTooltip(anchor, { host, theme, content: () => 'Tip' }))).toBe(700);
        let hint: HTMLElement | null = null;
        armDelay((_, host) => {
            hint = chromeHint('A hint', { host, theme }).el;
            host.append(hint);
        });
        expect(armDelay(() => hover(hint!))).toBe(250);
    });

    it('arms with the configured delay — read when it arms, so a later configure applies', () => {
        vi.useFakeTimers();
        const host = hostEl();
        const anchor = document.createElement('button');
        host.append(anchor);
        attachChromeTooltip(anchor, { host, theme, content: () => ({ id: 'test.anchor', title: 'Anchor' }) });
        configureTooltips({ openDelay: 300 });
        hover(anchor);
        vi.advanceTimersByTime(299);
        expect(chromeTips(host)).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(chromeTips(host)).toHaveLength(1);

        const hint = chromeHint('A hint', { host, theme }).el;
        host.append(hint);
        hover(hint);
        vi.advanceTimersByTime(299);
        expect(chromeTips(host)).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(chromeTips(host)).toHaveLength(2); // the 250 ms hint waits the configured 300 too
    });
});

describe('structured tooltip content', () => {
    const info: TooltipInfo = { id: 'test.save', title: 'Save', description: 'Keep your work.', icon: '<svg></svg>', shortcut: 'Ctrl+S' };

    it('defaults to the bare title without a description — exactly a one-line tip', () => {
        const node = tooltipContent({ id: 'test.plain', title: 'Plain' }, document);
        expect(node.nodeType).toBe(Node.TEXT_NODE);
        expect(node.textContent).toBe('Plain');
    });

    it('defaults to the title over a muted description line', () => {
        const root = tooltipContent(info, document) as HTMLElement;
        expect(root.querySelector('.vela-tooltip-title')?.textContent).toBe('Save');
        expect(root.querySelector('.vela-tooltip-desc')?.textContent).toBe('Keep your work.');
        // Inline (renderer chrome, no stylesheet): the same values ride the elements.
        const inline = tooltipContent(info, document, true) as HTMLElement;
        const desc = inline.querySelector('.vela-tooltip-desc') as HTMLElement;
        expect(desc.style.color).toBe('var(--vela-fg-muted)');
        expect(desc.style.maxWidth).toBe('260px');
    });

    it('the render hook receives the info and its node is used; null falls back to the default', () => {
        const seen: TooltipInfo[] = [];
        configureTooltips({
            render: (i) => {
                seen.push(i);
                if (i.id !== 'test.save') return null;
                const el = document.createElement('section');
                el.className = 'host-card';
                el.textContent = `${i.title} — ${i.description}`;
                return el;
            },
        });
        const custom = tooltipContent(info, document) as HTMLElement;
        expect(custom.className).toBe('host-card');
        expect(seen[0]).toEqual(info);
        const fallback = tooltipContent({ id: 'test.other', title: 'Other', description: 'Something else.' }, document) as HTMLElement;
        expect(fallback.querySelector('.vela-tooltip-desc')?.textContent).toBe('Something else.');
    });

    it('a throwing hook falls back to the default content', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        configureTooltips({
            render: () => {
                throw new Error('boom');
            },
        });
        expect(tooltipContent(info, document).textContent).toContain('Keep your work.');
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it('a kit tooltip with TooltipInfo content goes through the hook; string content never does', () => {
        const render = vi.fn((i: TooltipInfo) => {
            const el = document.createElement('b');
            el.textContent = `custom ${i.id}`;
            return el;
        });
        configureTooltips({ render });
        const host = hostEl();
        const a = document.createElement('button');
        const b = document.createElement('button');
        host.append(a, b);
        const structured = new Tooltip(a, { content: info, host });
        const plain = new Tooltip(b, { content: 'Plain text', host });
        const [first, second] = host.querySelectorAll<HTMLElement>('.vela-tooltip');
        expect(first!.innerHTML).toBe('<b>custom test.save</b>');
        expect(second!.textContent).toBe('Plain text');
        expect(render).toHaveBeenCalledTimes(1);
        structured.destroy();
        plain.destroy();
    });

    it('a chrome tooltip builds a TooltipInfo through the hook at open time', () => {
        vi.useFakeTimers();
        const host = hostEl();
        const anchor = document.createElement('button');
        host.append(anchor);
        attachChromeTooltip(anchor, { host, theme, content: () => info });
        configureTooltips({ render: (i) => Object.assign(document.createElement('i'), { textContent: i.shortcut ?? '' }) });
        hover(anchor);
        vi.advanceTimersByTime(700);
        expect(chromeTips(host)[0]?.innerHTML).toBe('<i>Ctrl+S</i>');
    });
});

describe('drawing toolbar tooltips', () => {
    const tools = (): DrawingTypeKey[] => ['trendline', 'ray'];

    function toolbar(host: HTMLElement): DrawingToolbar {
        const tb = new DrawingToolbar(host, DARK_THEME, () => {});
        const [trend, ray] = tools().map((type) => {
            const meta = drawingTypes().find((m) => m.type === type)!;
            return { type, label: meta.label, icon: meta.icon };
        });
        // The ray row carries no description: its row must get no tooltip.
        tb.setDefinition({ groups: [{ id: 'lines', label: 'Lines', tools: [{ ...trend!, description: 'Connect two points to mark a trend.' }, ray!] }] });
        tb.setVisible(true);
        return tb;
    }

    it('a flyout row gets a tooltip only when its tool has a description', () => {
        vi.useFakeTimers();
        const host = hostEl();
        toolbar(host);
        (host.querySelector('.vela-dtb-arrow') as HTMLElement).click();
        const rows = [...host.querySelectorAll<HTMLElement>('.vela-dtb-item')];
        expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Trend Line', 'Ray']);

        hover(rows[1]!);
        vi.advanceTimersByTime(700);
        expect(chromeTips(host)).toHaveLength(0);

        hover(rows[0]!);
        vi.advanceTimersByTime(700);
        const tips = chromeTips(host);
        expect(tips).toHaveLength(1);
        expect(tips[0]!.querySelector('.vela-tooltip-title')?.textContent).toBe('Trend Line');
        expect(tips[0]!.querySelector('.vela-tooltip-desc')?.textContent).toBe('Connect two points to mark a trend.');
    });

    it('a group cell names its current tool with the description, and the bar’s buttons describe themselves', () => {
        vi.useFakeTimers();
        const seen: TooltipInfo[] = [];
        configureTooltips({
            render: (i) => {
                seen.push(i);
                return null;
            },
        });
        const host = hostEl();
        const tb = toolbar(host);
        tb.setShortcuts({ trendline: 'Alt+T' });
        const last = (): TooltipInfo | undefined => seen[seen.length - 1];
        hover(host.querySelector('.vela-dtb-cell') as HTMLElement);
        vi.advanceTimersByTime(700);
        expect(last()).toMatchObject({ id: 'drawing.trendline', title: 'Trend Line', description: 'Connect two points to mark a trend.', shortcut: 'Alt+T' });
        expect(last()?.icon).toContain('<svg');

        const eraser = host.querySelector('[aria-label="Eraser (click/drag to delete)"]') as HTMLElement;
        hover(eraser);
        vi.advanceTimersByTime(700);
        expect(last()).toMatchObject({ id: 'drawing-toolbar.eraser', title: 'Eraser', description: 'Click or drag over drawings to remove them.' });
    });

    it('every built-in drawing tool ships a description, and the default toolbar carries it', () => {
        expect(drawingTypes().filter((m) => !m.description).map((m) => m.type)).toEqual([]);
        const all = defaultToolbar().groups.flatMap((g) => g.tools);
        expect(all.length).toBeGreaterThan(60);
        expect(all.every((t) => typeof t.description === 'string' && t.description.endsWith('.'))).toBe(true);
    });
});

describe('topbar tooltips', () => {
    const ctx = {} as WidgetContext;

    function topbar(host: HTMLElement): Topbar {
        return new Topbar(host, {
            symbol: 'BINANCE:BTCUSDT',
            timeframe: '60',
            timeframes: ['60', 'D'],
            priceStyle: 'candles',
            onTimeframe: () => {},
            onPriceStyle: () => {},
            onIndicatorsClick: () => {},
            getContext: () => ctx,
        });
    }

    afterEach(() => {
        unregisterWidgetAction('test.described');
        unregisterWidgetAction('test.plain');
    });

    it('built-in controls and contributed actions build their tips from TooltipInfo — descriptions included', () => {
        const seen: TooltipInfo[] = [];
        configureTooltips({
            render: (i) => {
                seen.push(i);
                return null;
            },
        });
        registerWidgetAction({ id: 'test.described', target: 'topbar', label: 'Described', description: 'Does one thing well.', icon: 'camera', run: () => {} });
        registerWidgetAction({ id: 'test.plain', target: 'topbar', label: 'Plain', run: () => {} });
        const host = hostEl();
        const bar = topbar(host);
        const byId = new Map(seen.map((i) => [i.id, i]));
        expect(byId.get('topbar.style')).toMatchObject({ title: 'Chart style', description: 'Choose how price is drawn on the chart.' });
        expect(byId.get('topbar.indicators')).toMatchObject({ title: 'Indicators', description: 'Add indicators to the chart.' });
        expect(byId.get('topbar.undo')).toMatchObject({ title: 'Undo', description: 'Reverse the last chart edit.' });
        expect(byId.get('action.test.described')).toMatchObject({ title: 'Described', description: 'Does one thing well.' });
        expect(byId.get('action.test.described')?.icon).toContain('<svg');
        // A text button without a description keeps no tooltip — its label is on screen.
        expect(byId.has('action.test.plain')).toBe(false);
        // Default content: the description line under the title.
        const descs = [...host.querySelectorAll('.vela-tooltip-desc')].map((d) => d.textContent);
        expect(descs).toContain('Does one thing well.');
        // aria-labels are unchanged.
        expect(host.querySelector('.vela-widget-screenshot')?.getAttribute('aria-label')).toBe('Download screenshot');
        bar.destroy();
    });
});
