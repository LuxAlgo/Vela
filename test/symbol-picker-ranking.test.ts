// @vitest-environment jsdom
// The symbol picker under a registered ranking that answers later: a ranking that lands
// after the picker closed builds no rows (and so loads no row icons); the next open shows
// the ranked rows.
import { describe, it, expect, afterEach, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

import { SymbolPicker } from '../src/widget/symbol-picker';
import { registerSymbolRanking } from '../src/widget/contributions';
import type { SymbolDescriptor } from '../src/core/ports/DataProvider';

const pool: SymbolDescriptor[] = Array.from({ length: 150 }, (_, i) => ({ ticker: `SYM${i}USDT`, description: `SYM${i} / USDT`, type: 'crypto', provider: 'test' }));
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const rowTickers = (): string[] => [...document.querySelectorAll<HTMLElement>('.vela-sp-row')].map((r) => r.dataset.ticker ?? '');

let unregister: (() => void) | null = null;
afterEach(() => {
    unregister?.();
    unregister = null;
    document.body.replaceChildren();
});

/** A ranking that reverses the pool, answering only when the test says so. */
function laterRanking(): { land: () => void } {
    const waiting: (() => void)[] = [];
    unregister = registerSymbolRanking((p) => new Promise((done) => waiting.push(() => done([...p].reverse()))));
    return { land: () => waiting.splice(0).forEach((f) => f()) };
}

function picker(): { picker: SymbolPicker; iconFor: ReturnType<typeof vi.fn> } {
    const iconFor = vi.fn((d: SymbolDescriptor) => `https://icons.example/${d.ticker}.png`);
    const p = new SymbolPicker({ host: document.body, onSelect: () => {}, iconFor });
    p.setSource(() => pool);
    return { picker: p, iconFor };
}

describe('symbol picker with a ranking that answers later', () => {
    it('builds no rows, and asks for no row icons, when the ranking lands after the picker closed', async () => {
        const ranking = laterRanking();
        const { picker: p, iconFor } = picker();
        p.open('');
        await settle();
        p.close();
        await settle();
        iconFor.mockClear();

        ranking.land();
        await settle();
        expect(iconFor).not.toHaveBeenCalled();
    });

    it('shows the ranked rows, with their icons, on the next open', async () => {
        const ranking = laterRanking();
        const { picker: p, iconFor } = picker();
        p.open('');
        await settle();
        p.close();
        ranking.land();
        await settle();

        p.open('');
        await settle();
        expect(rowTickers()[0]).toBe('SYM149USDT');
        expect(iconFor).toHaveBeenCalled();
    });

    it('repaints an open picker with the ranked rows when the ranking lands', async () => {
        const ranking = laterRanking();
        const { picker: p } = picker();
        p.open('');
        await settle();
        expect(rowTickers()[0]).toBe('SYM0USDT'); // the pool's own order until the ranking answers

        ranking.land();
        await settle();
        expect(rowTickers()[0]).toBe('SYM149USDT');
    });
});
