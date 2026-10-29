// @vitest-environment jsdom
// The legend follows the price pane's stacking: each pane lists its rows front-most first
// (the object tree's order, whatever order they were added in), and an overlay's menus
// lead with its one-step restacking entries. jsdom has no layout; the menus' look and
// the reorders they cause are proven in the browser.
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MenuItemDescriptor } from '../src/ui/components/menu';
import { InputsUI, type LegendStackApi } from '../src/renderers/shared/InputsUI';
import { DARK_THEME } from '../src/core/theme';

const menus = vi.hoisted(() => [] as Array<{ items: readonly MenuItemDescriptor[]; select: (id: string) => void }>);

vi.mock('../src/ui/components/menu', () => ({
    Menu: class {
        private readonly rec: (typeof menus)[number];
        constructor(opts: { items: readonly MenuItemDescriptor[]; onSelect?: (id: string) => void }) {
            this.rec = { items: opts.items, select: (id) => opts.onSelect?.(id) };
            menus.push(this.rec);
        }
        setItems(items: readonly MenuItemDescriptor[]): void {
            this.rec.items = items;
        }
        openAt(): void {}
        close(): void {}
        destroy(): void {}
    },
}));

let ui: InputsUI | null = null;
afterEach(() => {
    ui?.destroy();
    ui = null;
    menus.length = 0;
    document.body.replaceChildren();
});

function setup(): { ui: InputsUI; container: HTMLElement } {
    const container = document.createElement('div');
    document.body.appendChild(container);
    ui = new InputsUI(container, DARK_THEME, () => ({ top: 0, height: 300, rightAxis: 60 }));
    return { ui, container };
}

/** The titles of a pane's legend, top to bottom (the fold chip as `[fold]`). */
function legend(container: HTMLElement, paneId = 'price'): string[] {
    const lg = container.querySelector<HTMLElement>(`[data-vela-pane="${paneId}"]`)!;
    return [...lg.children].map((el) => (el.classList.contains('vela-ind-fold') ? '[fold]' : (el.querySelector('span > span')?.textContent ?? '')));
}

describe('legend rows follow the stacking', () => {
    it('lists each pane front-most first, whatever order the rows were added in', () => {
        const { ui, container } = setup();
        ui.upsert('ema', 'EMA', [], {}, 'price');
        ui.upsert('bb', 'BB', [], {}, 'price');
        ui.upsert('rsi', 'RSI', [], {}, 'pane-rsi');
        ui.upsert('rsi-ma', 'RSI MA', [], {}, 'pane-rsi');
        expect(legend(container)).toEqual(['EMA', 'BB', '[fold]']);

        // Back to front as they paint: BB behind EMA on the price pane, RSI MA behind RSI.
        ui.orderRows(['bb', 'rsi-ma', 'ema', 'rsi']);
        expect(legend(container)).toEqual(['EMA', 'BB', '[fold]']);
        expect(legend(container, 'pane-rsi')).toEqual(['RSI', 'RSI MA']);

        ui.orderRows(['ema', 'rsi', 'bb', 'rsi-ma']);
        expect(legend(container)).toEqual(['BB', 'EMA', '[fold]']); // the fold chip stays last
        expect(legend(container, 'pane-rsi')).toEqual(['RSI MA', 'RSI']);
    });

    it('keeps rows the order does not name after the others, in their own order', () => {
        const { ui, container } = setup();
        ui.upsert('a', 'A', [], {}, 'price');
        ui.upsert('b', 'B', [], {}, 'price');
        ui.upsert('c', 'C', [], {}, 'price');
        ui.orderRows(['c']);
        expect(legend(container)).toEqual(['C', 'A', 'B', '[fold]']);
    });
});

describe('upsert re-routing a row tidies the emptied pane', () => {
    function panes(container: HTMLElement): string[] {
        return [...container.querySelectorAll<HTMLElement>('[data-vela-pane]')].map((el) => el.dataset.velaPane!);
    }

    it('drops an emptied non-price legend container, as setPane does', () => {
        const { ui, container } = setup();
        ui.upsert('rsi', 'RSI', [], {}, 'pane-rsi');
        expect(panes(container)).toContain('pane-rsi');

        ui.upsert('rsi', 'RSI', [], {}, 'pane-macd');
        expect(panes(container)).not.toContain('pane-rsi');
        expect(panes(container)).toContain('pane-macd');
    });
});

describe('an overlay\'s menus lead with its restacking steps', () => {
    function stackApi(): LegendStackApi {
        return {
            above: (id) => (id === 'bb' ? 'price' : { indicator: 'bb' }),
            below: (id) => (id === 'bb' ? { indicator: 'ema' } : null),
            raise: vi.fn(),
            lower: vi.fn(),
        };
    }

    /** Right-click a row and return the menu it opened. */
    function rightClick(container: HTMLElement, title: string): (typeof menus)[number] {
        const row = [...container.querySelectorAll<HTMLElement>('[data-vela-pane="price"] > *')].find((el) => el.textContent?.startsWith(title))!;
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        return menus[menus.length - 1]!;
    }

    it('names the layer in front and behind, forward first, above the values toggle', () => {
        const { ui, container } = setup();
        ui.upsert('ema', 'EMA', [], {}, 'price');
        ui.upsert('bb', 'BB', [], {}, 'price');
        ui.setStackApi(stackApi());
        expect(rightClick(container, 'BB').items.map((i) => i.label)).toEqual(['Bring in front of price', 'Send behind EMA', 'Indicator values']);
        expect(rightClick(container, 'EMA').items.map((i) => i.label)).toEqual(['Bring in front of BB', 'Indicator values']);
    });

    it('runs the step it names', () => {
        const { ui, container } = setup();
        ui.upsert('ema', 'EMA', [], {}, 'price');
        ui.upsert('bb', 'BB', [], {}, 'price');
        const api = stackApi();
        ui.setStackApi(api);
        const menu = rightClick(container, 'BB');
        menu.select(menu.items[1]!.id);
        expect(api.lower).toHaveBeenCalledWith('bb');
        menu.select(menu.items[0]!.id);
        expect(api.raise).toHaveBeenCalledWith('bb');
    });

    it('offers no step without the hook, or with nothing to pass', () => {
        const { ui, container } = setup();
        ui.upsert('a', 'A', [], {}, 'price');
        expect(rightClick(container, 'A').items.map((i) => i.label)).toEqual(['Indicator values']);
        ui.setStackApi({ above: () => null, below: () => null, raise: vi.fn(), lower: vi.fn() });
        expect(rightClick(container, 'A').items.map((i) => i.label)).toEqual(['Indicator values']);
    });
});
