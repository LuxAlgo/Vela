import { describe, expect, it } from 'vitest';
import { drawingTypes } from '../src/core/drawings';
import { icon, iconAt, iconMarkup, registerIcon, svg16, svg24 } from '../src/core/icons';
import { priceStyleIds } from '../src/renderers/native/core/chartConfig';
// The kit's façade must see the same registry the core registers into.
import { iconMarkup as kitMarkup } from '../src/ui/icons';

const root = (svg: string) => /^<svg [^>]*>/.exec(svg)?.[0] ?? '';
const attr = (svg: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(root(svg))?.[1];

/** The ids the chrome looks up by name; a rename here silently blanks an affordance. */
const CHROME_ICONS = [
    'check',
    'chevron-down',
    'chevron-up',
    'chevrons-right',
    'eye',
    'eye-off',
    'gear',
    'grip',
    'kebab',
    'lock',
    'move',
    'maximize',
    'pane-collapse',
    'pane-expand',
    'reset',
    'restore',
    'star',
    'star-filled',
    'trash',
];

/** Tool glyphs the drawing toolbars and settings popup look up. */
const TOOL_ICONS = ['brush', 'bucket', 'cursor', 'eraser', 'magnet', 'ruler', 'type', 'bold', 'italic', 'bring-front', 'send-back', 'bands'];

describe('icon builders', () => {
    it('emit one apparent stroke weight across both tiers', () => {
        // 1.2/16 === 1.8/24: a tier-A and a tier-B glyph at the same rendered size match.
        const a = Number(attr(svg16('<path d="M0 0"/>'), 'stroke-width'));
        const b = Number(attr(svg24('<path d="M0 0"/>'), 'stroke-width'));
        expect(a / 16).toBeCloseTo(b / 24, 6);
    });

    it('inherit color and size from the slot', () => {
        for (const svg of [svg16('<path d="M0 0"/>'), svg24('<path d="M0 0"/>')]) {
            expect(attr(svg, 'stroke')).toBe('currentColor');
            expect(attr(svg, 'width')).toBe('1em');
            expect(attr(svg, 'height')).toBe('1em');
        }
    });

    it('let a caller add root attributes without losing the tier', () => {
        const filled = svg16('<path d="M0 0"/>', 'fill="currentColor"');
        expect(attr(filled, 'fill')).toBe('currentColor');
        expect(attr(filled, 'viewBox')).toBe('0 0 16 16');
    });
});

describe('icon registry', () => {
    it('serves every id the chrome and the toolbars ask for', () => {
        for (const id of [...CHROME_ICONS, ...TOOL_ICONS]) {
            expect(iconMarkup(id), `missing icon: ${id}`).toBeTruthy();
        }
    });

    it('is one registry, shared by the core and the UI kit', () => {
        registerIcon('test-shared-icon', svg16('<path d="M1 1"/>'));
        expect(kitMarkup('test-shared-icon')).toBe(iconMarkup('test-shared-icon'));
    });

    it('renders nothing rather than breaking on an unknown id', () => {
        expect(icon('no-such-icon')).toBe('');
        expect(iconAt('no-such-icon', 12)).toBe('');
    });

    it('pins an explicit size ahead of the inherited one', () => {
        // Duplicate attributes: the first wins, so the px size overrides the `1em` default.
        expect(attr(iconAt('check', 13), 'width')).toBe('13');
    });
});

describe('icon conventions', () => {
    const registered = [...CHROME_ICONS, ...TOOL_ICONS].map((id) => [id, iconMarkup(id)!] as const);
    const styleIcons = priceStyleIds().map((id) => [id, iconMarkup(`style-${id}`)!] as const);
    const toolIcons = drawingTypes().map((t) => [t.type, t.icon] as const);
    const all = [...registered, ...styleIcons, ...toolIcons];

    it('covers every price style and drawing tool', () => {
        expect(styleIcons.length).toBeGreaterThan(4);
        expect(toolIcons.length).toBeGreaterThan(50);
        for (const [id, svg] of all) expect(svg, `no markup for ${id}`).toBeTruthy();
    });

    it('draws on one of the two sanctioned grids', () => {
        for (const [id, svg] of all) {
            expect(['0 0 16 16', '0 0 24 24'], `${id} uses an off-grid viewBox`).toContain(attr(svg, 'viewBox'));
        }
    });

    it('strokes currentColor so a theme change needs no icon change', () => {
        for (const [id, svg] of all) {
            const stroke = attr(svg, 'stroke');
            const fill = attr(svg, 'fill');
            expect([undefined, 'currentColor', 'none'], `${id} hardcodes a stroke`).toContain(stroke);
            expect([undefined, 'currentColor', 'none'], `${id} hardcodes a fill`).toContain(fill);
        }
    });

    it('keeps the stroke weight at its tier value', () => {
        for (const [id, svg] of all) {
            const grid = attr(svg, 'viewBox') === '0 0 16 16' ? 16 : 24;
            const width = attr(svg, 'stroke-width');
            if (width === undefined) continue; // solid glyphs carry no stroke
            // Bold/italic type glyphs deliberately read heavier than the tier.
            if (['bold', 'italic'].includes(id)) continue;
            expect(Number(width) / grid, `${id} drifts from its tier weight`).toBeCloseTo(0.075, 6);
        }
    });
});
