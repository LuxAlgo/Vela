import { describe, it, expect } from 'vitest';
import { MeasureOverlay } from '../src/renderers/native/drawings/MeasureOverlay';
import { DatePriceRange } from '../src/core/drawings/types/DatePriceRange';
import { measureLines, priceMove, type PriceSteps, type Projector } from '../src/core/drawings';
import { createTranslator, registerLocale } from '../src/plugin';
import german from '../src/locales/de';
import arabic from '../src/locales/ar';

const HR = 3_600_000;

/** A one-pane projector where y is the price and x is the time in hours, with the symbol's
 *  tick (and pip) on the price pane. */
function projector(steps?: PriceSteps, decimals?: number, width = 800): Projector {
    return {
        width,
        height: 600,
        xOf: (time: number) => time / HR,
        yOf: (price: number) => price,
        pxToPoint: (x: number, y: number) => ({ time: x * HR, price: y }),
        paneIdAtY: () => 'price',
        barsBetween: (t1: number, t2: number) => Math.abs(t2 - t1) / HR,
        priceDecimals: (paneId: string) => (paneId === 'price' && steps ? decimals : undefined),
        priceSteps: (paneId: string) => (paneId === 'price' ? steps : undefined),
    } as unknown as Projector;
}

const EURUSD: PriceSteps = { tick: 0.00001, pip: 0.0001 };
const ES: PriceSteps = { tick: 0.25 };
const at = (price: number, hours = 0) => ({ time: hours * HR, price });

describe('the measure label', () => {
    it('on a currency pair reads the precise price move and percent, then the pips and the time', () => {
        expect(measureLines(at(1.09915), at(1.09696, 5), projector(EURUSD, 5), 'price')).toEqual(['−0.00219 · −0.20%', '−21.9 pips · 5 bars · 5h']);
    });

    it('counts a pair quoted to three decimals in 0.01 pips', () => {
        expect(measureLines(at(150), at(150.437, 1), projector({ tick: 0.001, pip: 0.01 }, 3), 'price')[1]).toBe('+43.7 pips · 1 bar · 1h');
    });

    it('on other markets counts whole ticks, snapping the move to the tick size', () => {
        expect(measureLines(at(5000), at(5012.6, 1), projector(ES, 2), 'price')).toEqual(['+12.50 · +0.25%', '+50 ticks · 1 bar · 1h']);
        expect(measureLines(at(5000), at(5000.25, 1), projector(ES, 2), 'price')[1]).toBe('+1 tick · 1 bar · 1h');
    });

    it('groups thousands in large moves and tick counts', () => {
        expect(measureLines(at(100000), at(104321.37, 30), projector({ tick: 0.01 }, 2), 'price')).toEqual([
            '+4,321.37 · +4.32%',
            '+432,137 ticks · 30 bars · 1d 6h',
        ]);
    });

    it('a move smaller than one tick reads zero, never with a sign', () => {
        expect(measureLines(at(1.09696), at(1.096962), projector(EURUSD, 5), 'price')).toEqual(['0.00000 · 0.00%', '0.0 pips · 0 bars · 0s']);
    });

    it('measuring right to left reads the same move and a positive time span', () => {
        expect(measureLines(at(1.1, 5), at(1.0978), projector(EURUSD, 5), 'price')).toEqual(['−0.00220 · −0.20%', '−22.0 pips · 5 bars · 5h']);
    });

    it('without a known tick size, sizes the decimals to the values and counts no steps', () => {
        expect(measureLines(at(0.5), at(0.49865, 1), projector(), 'price')[0]).toBe('−0.0014 · −0.27%');
        expect(measureLines(at(70), at(65.5, 1), projector(EURUSD, 5), 'rsi')).toEqual(['−4.50 · −6.43%', '1 bar · 1h']);
    });

    it('a rise on a series below zero reads as a positive percent', () => {
        expect(measureLines(at(-2), at(-1, 1), projector(), 'macd')[0]).toBe('+1.00 · +50.00%');
    });

    it('a move from exactly zero has no percent to show', () => {
        expect(measureLines(at(0), at(5, 1), projector(), 'macd')[0]).toBe('+5.00');
    });

    it('reads in the viewer language, with its decimal mark, grouping and plurals', () => {
        registerLocale(german);
        const de = createTranslator({ locale: 'de' });
        const [headline, detail] = measureLines(at(1.09915), at(1.09696, 1), projector(EURUSD, 5), 'price', de);
        expect(headline).toBe('−0,00219 · −0,20\u00a0%');
        expect(detail).toMatch(/^−21,9 Pips · 1 Kerze · \S/);
        expect(measureLines(at(100000), at(104321.37), projector({ tick: 0.01 }, 2), 'price', de)[0]).toBe('+4.321,37 · +4,32\u00a0%');
    });
});

describe('the measure label in a right-to-left language', () => {
    it('reads a line with Arabic words right to left, keeping every number whole with its sign', () => {
        registerLocale(arabic);
        const ar = createTranslator({ locale: 'ar' });
        const [headline, detail] = measureLines(at(1.09915), at(1.09707, 8), projector(EURUSD, 5), 'price', ar);
        expect(headline).toBe('−0.00208 · −0.19%'); // numbers only: stays left to right, untouched
        expect(detail!.startsWith('\u2067')).toBe(true); // the line reads right to left
        expect(detail!.endsWith('\u2069')).toBe(true);
        expect(detail).toContain('\u2066−20.8\u2069'); // the pips stay one left-to-right number
        expect(detail).toContain('\u20668\u2069'); // and so does the bar count
    });

    it('leaves lines in other languages free of direction marks', () => {
        expect(measureLines(at(1.09915), at(1.09707, 8), projector(EURUSD, 5), 'price').join('')).not.toMatch(/[\u2066-\u2069]/);
    });
});

describe('the move behind the label', () => {
    it('snaps to whole ticks so price, percent and step count agree', () => {
        expect(priceMove(5000, 5012.6, projector(ES, 2), 'price')).toEqual({ delta: 12.5, decimals: 2, percent: 0.25, steps: { unit: 'tick', value: 50, decimals: 0 } });
    });
});

describe('painting the measure label', () => {
    /** A canvas stand-in that records the label box and every text it fills, with its alpha. */
    function recorder() {
        const texts: Array<[string, number]> = [];
        const boxes: number[][] = [];
        const state = { globalAlpha: 1 };
        const ctx = new Proxy(state, {
            get: (t, key) => {
                if (key === 'measureText') return (s: string) => ({ width: s.length * 6 });
                if (key === 'fillText') return (s: string) => texts.push([s, t.globalAlpha]);
                if (key === 'roundRect') return (...args: number[]) => boxes.push(args);
                if (key in t) return t[key as 'globalAlpha'];
                return () => undefined;
            },
            set: (t, key, v) => {
                if (key === 'globalAlpha') t.globalAlpha = v;
                return true;
            },
        }) as unknown as CanvasRenderingContext2D;
        return { ctx, texts, boxes };
    }
    const theme = { background: '#000', textColor: '#fff', fontFamily: 'sans-serif' } as never;

    it('the ruler paints the headline in full tone and the detail line quieter', () => {
        const proj = projector(EURUSD, 5);
        const ruler = new MeasureOverlay(() => proj);
        ruler.down(100, 1.09915);
        ruler.move(105, 1.09696);
        const r = recorder();
        ruler.paint(r.ctx, proj, theme);
        expect(r.texts.map(([s]) => s)).toEqual(['−0.00219 · −0.20%', '−21.9 pips · 5 bars · 5h']);
        expect(r.texts[0]![1]).toBe(1);
        expect(r.texts[1]![1]).toBeLessThan(1);
    });

    it('the ruler keeps its label inside the plot when measured at an edge', () => {
        const proj = projector(EURUSD, 5, 300);
        const ruler = new MeasureOverlay(() => proj);
        ruler.down(296, 1.09915);
        ruler.move(299, 1.09696);
        const r = recorder();
        ruler.paint(r.ctx, proj, theme);
        const [x, , w] = r.boxes[0]!;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x! + w!).toBeLessThanOrEqual(300);
    });

    it('the Date & Price Range drawing reads the same, and its toggles drop the price or the time', () => {
        const range = new DatePriceRange({ paneId: 'price', anchors: [at(1.09915), at(1.09696, 5)] });
        const proj = projector(EURUSD, 5);
        expect(range.measureLabel(proj)).toEqual(['−0.00219 · −0.20%', '−21.9 pips · 5 bars · 5h']);
        range.showDate = false;
        expect(range.measureLabel(proj)).toEqual(['−0.00219 · −0.20%', '−21.9 pips']);
        range.showDate = true;
        range.showPrice = false;
        expect(range.measureLabel(proj)).toEqual(['5 bars · 5h']);
    });
});
