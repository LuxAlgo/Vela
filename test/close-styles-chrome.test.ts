// @vitest-environment jsdom
// The chrome around the close-only price styles (line with markers, step line, columns):
// the style menu's entries, the settings rows each style shows, and the status line's ink.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';
import { priceStyleIcon, priceStyleLabel } from '../src/widget/topbar';
import { statuslineInkOf } from '../src/widget/statusline';
import { iconMarkup } from '../src/core/icons';
import { priceStyleIds } from '../src/renderers/native/core/chartConfig';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

const NEW_STYLES = ['linemarkers', 'stepline', 'columns'] as const;

describe('style menu entries', () => {
    it('lists the three styles with their names and icons', () => {
        for (const id of NEW_STYLES) expect(priceStyleIds()).toContain(id);
        expect(NEW_STYLES.map((id) => priceStyleLabel(id))).toEqual(['Line with markers', 'Step line', 'Columns']);
        for (const id of NEW_STYLES) {
            expect(priceStyleIcon(id)).toBe(`style-${id}`);
            expect(iconMarkup(`style-${id}`)).toContain('viewBox="0 0 16 16"');
        }
    });
});

describe('settings rows per style', () => {
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const shown = (id: string): boolean => {
        const el = document.querySelector<HTMLElement>(`[data-sd-id="${id}"]`);
        expect(el, `no ${id}`).toBeTruthy();
        return !el!.classList.contains('vela-sd-hide');
    };

    async function openFor(style: string): Promise<void> {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false, priceStyle: style } as never);
        disposers.push(() => ws.destroy());
        const chart = ws.cells()[0]!.chart;
        expect(chart.renderer.get('priceStyle')).toBe(style);
        chart.renderer.openSettings('Symbol');
        await settle();
    }

    it('line with markers and step line edit the line color and width', async () => {
        for (const style of ['linemarkers', 'stepline']) {
            await openFor(style);
            expect(shown('symbol.style.line')).toBe(true);
            expect(shown('symbol.style.line.color')).toBe(true);
            expect(shown('symbol.style.line.width')).toBe(true);
            expect(shown('symbol.style.candles')).toBe(false);
            expect(shown('symbol.style.columns')).toBe(false);
            disposers.pop()!();
            document.body.replaceChildren();
        }
    });

    it('columns edit their own up and down colors and the spacing', async () => {
        await openFor('columns');
        expect(shown('symbol.style.columns')).toBe(true);
        expect(shown('symbol.style.columns.up-color')).toBe(true);
        expect(shown('symbol.style.columns.down-color')).toBe(true);
        expect(shown('symbol.style.columns.spacing')).toBe(true);
        expect(shown('symbol.style.line')).toBe(false);
        expect(shown('symbol.style.bars')).toBe(false);
    });
});

describe('status line ink', () => {
    const config = {
        line: { color: '#111111' },
        columns: { upColor: 'rgba(0,170,0,0.5)', downColor: 'rgba(170,0,0,0.5)' },
    };
    const renderer = (previousClose: number | null) => ({ getConfig: () => config, get: (key: string) => (key === 'previousClose' ? previousClose : undefined) });

    it('the line family reads the plotted value in the line color', () => {
        for (const style of ['linemarkers', 'stepline']) {
            expect(statuslineInkOf(renderer(null), style)).toEqual(['#111111', '#111111', null, 'value']);
        }
    });

    it('columns read the plotted value in their colors made opaque, by the close against the previous close', () => {
        const [up, down, isUp, readout] = statuslineInkOf(renderer(10), 'columns');
        expect([up, down, readout]).toEqual(['rgba(0,170,0,1)', 'rgba(170,0,0,1)', 'value']);
        expect(isUp!({ open: 12, close: 11 })).toBe(true); // above the previous close, below its open
        expect(isUp!({ open: 9, close: 10 })).toBe(true); // unchanged
        expect(isUp!({ open: 9, close: 9.5 })).toBe(false); // fell, though above its open
        const [, , first] = statuslineInkOf(renderer(null), 'columns');
        expect(first!({ open: 1, close: 0 })).toBe(true); // the first bar has no previous close
    });
});
