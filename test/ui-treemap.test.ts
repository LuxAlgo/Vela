// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTreemap, squarify, type TreemapItem } from '@luxalgo/vela-ui/treemap';

const W = 400;
const H = 300;

// jsdom lays nothing out: the map gets a size, and its observer reports it at once.
beforeAll(() => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(private readonly cb: () => void) {}
            observe(): void {
                this.cb();
            }
            disconnect(): void {}
        },
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => W });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => H });
});
afterAll(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const tiles = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('[data-slot="treemap-tile"]')];
const tile = (el: HTMLElement, label: string) => tiles(el).find((t) => t.querySelector('[data-slot="treemap-tile-label"]')?.textContent === label)!;
const px = (v: string) => Number.parseFloat(v);

const market: TreemapItem[] = [
    {
        id: 'crypto',
        label: 'Crypto',
        children: [
            { id: 'btc', label: 'BTC', value: 2 },
            { id: 'eth', label: 'ETH', value: -1 },
            { id: 'sol', label: 'SOL', value: 4 },
        ],
    },
    {
        id: 'stocks',
        label: 'Stocks',
        children: [
            { id: 'aapl', label: 'AAPL', value: -3 },
            { id: 'nvda', label: 'NVDA', value: null },
        ],
    },
];

describe('squarify', () => {
    it('gives each item an area in proportion to its weight and fills the bounds, heaviest first', () => {
        const rects = squarify(
            [
                { id: 'a', weight: 1 },
                { id: 'b', weight: 3 },
                { id: 'c', weight: 0 },
                { id: 'd', weight: 2 },
            ],
            { x: 10, y: 20, w: 300, h: 200 },
        );
        expect(rects.map((r) => r.id)).toEqual(['b', 'd', 'a']);
        const total = 300 * 200;
        expect(rects.map((r) => (r.w * r.h) / total)).toEqual([0.5, 1 / 3, 1 / 6].map((share) => expect.closeTo(share, 9)));
        for (const r of rects) {
            expect(r.x).toBeGreaterThanOrEqual(10 - 1e-9);
            expect(r.y).toBeGreaterThanOrEqual(20 - 1e-9);
            expect(r.x + r.w).toBeLessThanOrEqual(310 + 1e-9);
            expect(r.y + r.h).toBeLessThanOrEqual(220 + 1e-9);
        }
    });

    it('keeps equal tiles close to square', () => {
        const rects = squarify(
            Array.from({ length: 12 }, (_, i) => ({ i, weight: 1 })),
            { x: 0, y: 0, w: 400, h: 300 },
        );
        expect(rects).toHaveLength(12);
        for (const r of rects) expect(Math.max(r.w / r.h, r.h / r.w)).toBeLessThan(2);
    });

    it('lays out nothing in an empty box or for weightless items', () => {
        expect(squarify([{ weight: 1 }], { x: 0, y: 0, w: 0, h: 100 })).toEqual([]);
        expect(squarify([{ weight: 0 }], { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
    });
});

describe('treemap', () => {
    it('draws a tile per item, heads each group with its name and median, and tints tiles by their value', () => {
        const map = createTreemap({ items: market, label: 'Moves', format: (v) => `${v}%` });
        expect(map.el.querySelector('[data-slot="treemap-map"]')!.getAttribute('aria-label')).toBe('Moves');
        expect(tiles(map.el)).toHaveLength(5);
        const headers = [...map.el.querySelectorAll('[data-slot="treemap-group"]')].map((g) => g.textContent);
        expect(headers).toEqual(['Crypto2%', 'Stocks-3%']);
        expect(tile(map.el, 'SOL').dataset.tone).toBe('up');
        expect(tile(map.el, 'SOL').style.getPropertyValue('--_level')).toBe('1');
        expect(tile(map.el, 'BTC').style.getPropertyValue('--_level')).toBe('0.5');
        expect(tile(map.el, 'AAPL').dataset.tone).toBe('down');
        expect(tile(map.el, 'NVDA').dataset.tone).toBe('none');
        expect(tile(map.el, 'NVDA').getAttribute('aria-label')).toBe('NVDA');
        expect(tile(map.el, 'ETH').getAttribute('aria-label')).toBe('ETH -1%');
    });

    it('fills its domain from the largest value unless given one', () => {
        const map = createTreemap({ items: market, domain: 8, legend: true, format: (v) => `${v}%` });
        expect(tile(map.el, 'SOL').style.getPropertyValue('--_level')).toBe('0.5');
        expect(map.el.querySelector('[data-slot="treemap-legend"]')!.textContent).toBe('-8%8%');
    });

    it('repaints new values on the same tiles', () => {
        const map = createTreemap({ items: market });
        const before = tile(map.el, 'NVDA');
        map.setValues(new Map([['nvda', 1.5]]));
        expect(tile(map.el, 'NVDA')).toBe(before);
        expect(before.dataset.tone).toBe('up');
        expect(before.querySelector('[data-slot="treemap-tile-value"]')!.textContent).toBe('+1.50');
        map.setValues({ btc: null });
        expect(tile(map.el, 'BTC').dataset.tone).toBe('none');
    });

    it('keeps a tile by its id across new data, and tints it by its own color when given one', () => {
        const map = createTreemap({ items: market });
        const btc = tile(map.el, 'BTC');
        map.setData([{ id: 'btc', label: 'BTC', weight: 2, color: 'var(--vela-accent)' }, { id: 'gold', label: 'Gold' }]);
        expect(tile(map.el, 'BTC')).toBe(btc);
        expect(btc.dataset.tone).toBe('custom');
        expect(btc.style.getPropertyValue('--_color')).toBe('var(--vela-accent)');
        expect(map.el.querySelectorAll('[data-slot="treemap-group"]')).toHaveLength(0);
        expect(px(btc.style.width) * px(btc.style.height)).toBeGreaterThan(px(tile(map.el, 'Gold').style.width) * px(tile(map.el, 'Gold').style.height));
    });

    it('reports a chosen tile with its groups, and draws the selected one', () => {
        const onSelect = vi.fn();
        const map = createTreemap({ items: market, onSelect, selected: 'eth' });
        expect(tile(map.el, 'ETH').hasAttribute('data-selected')).toBe(true);
        tile(map.el, 'SOL').click();
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sol' }), [expect.objectContaining({ id: 'crypto' })]);
        map.setSelected('sol');
        expect(tile(map.el, 'ETH').hasAttribute('data-selected')).toBe(false);
        expect(tile(map.el, 'SOL').hasAttribute('data-selected')).toBe(true);
    });

    it('zooms into a group from its header, and back from the breadcrumb or Escape', () => {
        const onDrill = vi.fn();
        const map = createTreemap({ items: market, drill: true, onDrill });
        document.body.append(map.el);
        const crumbs = () => [...map.el.querySelectorAll('[data-slot="treemap-crumb"]')].map((c) => c.textContent);
        expect(crumbs()).toEqual(['All']);
        const crypto = [...map.el.querySelectorAll<HTMLButtonElement>('[data-slot="treemap-group"]')].find((g) => g.textContent?.startsWith('Crypto'))!;
        crypto.click();
        expect(onDrill).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'crypto' })]);
        expect(tiles(map.el).map((t) => t.getAttribute('aria-label')?.split(' ')[0])).toEqual(expect.arrayContaining(['BTC', 'ETH', 'SOL']));
        expect(tiles(map.el)).toHaveLength(3);
        expect(crumbs()).toEqual(['All', 'Crypto']);
        tile(map.el, 'BTC').focus();
        tile(map.el, 'BTC').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(onDrill).toHaveBeenLastCalledWith([]);
        expect(tiles(map.el)).toHaveLength(5);
        map.drillTo('stocks');
        expect(tiles(map.el)).toHaveLength(2);
        map.el.querySelector<HTMLButtonElement>('[data-slot="treemap-crumb"]')!.click();
        expect(tiles(map.el)).toHaveLength(5);
        map.destroy();
    });

    it('leaves a zoom whose group the new data no longer has', () => {
        const onDrill = vi.fn();
        const map = createTreemap({ items: market, drill: true, onDrill });
        map.drillTo('crypto');
        map.setData([market[1]!]);
        expect(onDrill).toHaveBeenLastCalledWith([]);
        expect(tiles(map.el)).toHaveLength(2);
    });

    it('moves between tiles with the arrow keys, one tab stop for the map', () => {
        const map = createTreemap({
            items: [
                { id: 'a', label: 'A', weight: 1 },
                { id: 'b', label: 'B', weight: 1 },
            ],
        });
        document.body.append(map.el);
        const [first, second] = [tile(map.el, 'A'), tile(map.el, 'B')];
        expect([first.tabIndex, second.tabIndex]).toEqual([0, -1]);
        const right = px(second.style.left) > px(first.style.left);
        first.focus();
        first.dispatchEvent(new KeyboardEvent('keydown', { key: right ? 'ArrowRight' : 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(second);
        expect([first.tabIndex, second.tabIndex]).toEqual([-1, 0]);
        map.destroy();
    });
});
