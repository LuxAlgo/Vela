// @vitest-environment jsdom
// The status line re-walks its width ladder only when the readout's width can change:
// a crosshair move that changes digits alone rewrites the values in place, unmeasured.
import { describe, it, expect } from 'vitest';
import { Statusline } from '../src/widget/statusline';
import type { Vela } from '../src/Vela';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

interface Bar {
    open: number;
    high: number;
    low: number;
    close: number;
}

function make() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const line = new Statusline(host, 'BINANCE:BTCUSDT');
    let move: (e: { ohlc: Bar | null }) => void = () => {};
    const chart = {
        on: () => () => {},
        renderer: {
            onCrosshairMove: (cb: typeof move) => {
                move = cb;
                return () => {};
            },
        },
        replay: { state: { active: false } },
    } as unknown as Vela;
    line.onChart(chart);
    // Every fit() reads the chip's scrollWidth — count the reads (jsdom never overflows).
    let measures = 0;
    Object.defineProperty(line.el, 'scrollWidth', {
        get: () => {
            measures++;
            return 0;
        },
    });
    const close = () => line.el.querySelectorAll('.vela-sl-ohlc b')[3]?.textContent;
    return { line, hover: (ohlc: Bar | null) => move({ ohlc }), measures: () => measures, close };
}

describe('Statusline fit', () => {
    it('rewrites a digits-only change in place, without measuring', () => {
        const { line, hover, measures, close } = make();
        hover({ open: 61234.5, high: 61300.25, low: 61200, close: 61250.75 });
        const after = measures();
        hover({ open: 61987.5, high: 62010.25, low: 61900, close: 62003.75 });
        hover({ open: 61111.5, high: 61199.25, low: 61100, close: 61188.75 });
        expect(measures()).toBe(after);
        expect(close()).toBe('61,188.75');
        line.destroy();
    });

    it('re-fits when a value gains a digit', () => {
        const { line, hover, measures, close } = make();
        hover({ open: 9.5, high: 9.99, low: 9.4, close: 9.9 });
        const after = measures();
        hover({ open: 9.5, high: 10.25, low: 9.4, close: 10.1 });
        expect(measures()).toBeGreaterThan(after);
        expect(close()).toBe('10.10');
        line.destroy();
    });

    it('re-fits when the change flips sign', () => {
        const { line, hover, measures } = make();
        hover({ open: 100, high: 101, low: 99, close: 100.5 });
        const after = measures();
        hover({ open: 100, high: 101, low: 99, close: 99.5 });
        expect(measures()).toBeGreaterThan(after);
        line.destroy();
    });

    it('re-fits when the price style changes the readout shape', () => {
        const { line, hover, measures } = make();
        hover({ open: 100, high: 101, low: 99, close: 100.5 });
        const after = measures();
        line.setDirectionColors(null, null, null, 'value');
        expect(measures()).toBeGreaterThan(after);
        expect(line.el.querySelectorAll('.vela-sl-ohlc b')).toHaveLength(1);
        line.destroy();
    });

    it('sets the values in tabular figures, so digits alone never move the width', () => {
        make().line.destroy();
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
        expect(css).toMatch(/\.vela-statusline \.vela-sl-values \{[^}]*font-variant-numeric: tabular-nums/);
    });
});
