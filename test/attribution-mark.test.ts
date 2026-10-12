import { describe, expect, it } from 'vitest';
import { attributionMarkColor, createAttributionMark, createCustomMark } from '../src/renderers/native/chrome/AttributionMark';
import { VELA_LETTERS_SVG, VELA_MARK_SVG } from '../src/renderers/native/chrome/vela-logos';

/** The DOM subset the mark builders touch — tests run in a plain node environment. */
function stubDocument(): Document {
    const makeEl = (): Record<string, unknown> => ({
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        style: { setProperty: () => undefined },
        dataset: {},
        setAttribute: () => undefined,
        children: [] as unknown[],
        append(...nodes: unknown[]) {
            (this.children as unknown[]).push(...nodes);
        },
        appendChild: () => undefined,
    });
    return {
        getElementById: () => null,
        createElement: () => makeEl(),
        head: { appendChild: () => undefined },
    } as unknown as Document;
}

describe('attributionMarkColor', () => {
    it('is white on dark chart backgrounds', () => {
        expect(attributionMarkColor('#151619')).toBe('#ffffff');
        expect(attributionMarkColor('#000000')).toBe('#ffffff');
        expect(attributionMarkColor('rgb(30, 32, 38)')).toBe('#ffffff');
    });

    it('is black on light chart backgrounds', () => {
        expect(attributionMarkColor('#ffffff')).toBe('#000000');
        expect(attributionMarkColor('#f8fafc')).toBe('#000000');
        expect(attributionMarkColor('#fff')).toBe('#000000');
        expect(attributionMarkColor('rgb(240, 240, 240)')).toBe('#000000');
    });

    it('switches with no mid-tone in between as the background brightens', () => {
        const ramp = ['#101010', '#404040', '#606060', '#a0a0a0', '#d0d0d0', '#ffffff'];
        const inks = ramp.map((bg) => attributionMarkColor(bg));
        expect(new Set(inks)).toEqual(new Set(['#ffffff', '#000000']));
        expect(inks[0]).toBe('#ffffff');
        expect(inks[inks.length - 1]).toBe('#000000');
        // one crossover only — never white → gray → black
        const flips = inks.filter((ink, i) => i > 0 && ink !== inks[i - 1]).length;
        expect(flips).toBe(1);
    });
});

describe('attribution mark screenshot opt-in', () => {
    // The PNG export rasterizes only overlays tagged `data-vela-screenshot`; a mark
    // that loses the tag silently vanishes from every exported chart.
    it('the built-in mark opts into the PNG export', () => {
        const mark = createAttributionMark(stubDocument(), '#151619');
        expect(mark.dataset.velaScreenshot).toBe('1');
    });

    it('a host-supplied custom mark opts in the same way', () => {
        const mark = createCustomMark(stubDocument(), 'ACME', '#151619');
        expect(mark.dataset.velaScreenshot).toBe('1');
    });
});

describe('the built-in mark is Vela\'s', () => {
    it('shows the Morning Star V and reveals the rest of the wordmark beside it, linking to the project', () => {
        const mark = createAttributionMark(stubDocument(), '#151619') as unknown as {
            href: string;
            title: string;
            children: Array<{ className: string; innerHTML: string }>;
        };
        const [symbol, letters] = mark.children;
        expect(symbol?.className).toBe('vela-attr-symbol');
        expect(symbol?.innerHTML).toBe(VELA_MARK_SVG);
        expect(letters?.className).toBe('vela-attr-wordmark');
        expect(letters?.innerHTML).toBe(VELA_LETTERS_SVG);
        expect(mark.href).toContain('https://velacharts.dev/');
        expect(mark.title).toBe('Charting by Vela');
    });

    it('both halves are inline SVGs that paint via currentColor, on one shared height and baseline', () => {
        for (const svg of [VELA_MARK_SVG, VELA_LETTERS_SVG]) {
            expect(svg).toContain('<svg');
            expect(svg).toContain('currentColor');
            expect(svg).not.toContain('data:image/png');
        }
        // Same viewBox y-range: drawn at one CSS height, the letters land on the V's baseline.
        const yRange = (svg: string) => svg.match(/viewBox="[\d.]+ (-?[\d.]+) [\d.]+ ([\d.]+)"/)?.slice(1);
        expect(yRange(VELA_MARK_SVG)).toEqual(['-142', '148']);
        expect(yRange(VELA_LETTERS_SVG)).toEqual(yRange(VELA_MARK_SVG));
    });
});
