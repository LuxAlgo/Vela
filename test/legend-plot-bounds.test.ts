// @vitest-environment jsdom
// Indicator legend rows stay inside the plot's data area: each pane's legend column is
// bounded by the price-scale width the renderer reports, and a row too long for it gives
// way inside the row — its values truncate first, then its title, each with an ellipsis —
// instead of printing over the scale. jsdom has no layout, so this pins the constraints;
// what they render to is proven in the browser.
import { describe, it, expect, afterEach } from 'vitest';
import { InputsUI } from '../src/renderers/shared/InputsUI';
import { DARK_THEME } from '../src/core/theme';

let ui: InputsUI | null = null;
afterEach(() => {
    ui?.destroy();
    ui = null;
    document.body.replaceChildren();
});

function setup(scale: { px: number }) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    ui = new InputsUI(container, DARK_THEME, () => ({ top: 0, height: 300, rightAxis: scale.px }));
    ui.upsert('ind-1', 'Multi-band trend envelope', [], {});
    ui.setPlotValues(
        new Map([
            [
                'ind-1',
                [
                    { value: '85706.55', color: '#f0b90b' },
                    { value: '85801.44', color: '#2962ff' },
                ],
            ],
        ]),
    );
    const legend = container.querySelector<HTMLElement>('[data-vela-pane="price"]')!;
    const row = legend.firstElementChild as HTMLElement;
    const title = row.firstElementChild as HTMLElement;
    const values = Array.from(row.children).find((c) => c.textContent === '85706.5585801.44') as HTMLElement;
    return { legend, row, title, values };
}

describe('indicator legend · plot bounds', () => {
    it("bounds each pane's legend column by the price scale and follows a scale-width change", () => {
        const scale = { px: 64 };
        const { legend } = setup(scale);
        expect(legend.style.maxWidth).toBe('calc(100% - 80px)');
        scale.px = 128; // a merged own-scale column widened the gutter
        ui!.reposition();
        expect(legend.style.maxWidth).toBe('calc(100% - 144px)');
    });

    it('a row may span the whole column, its negative inset included', () => {
        const { row } = setup({ px: 64 });
        expect(row.style.maxWidth).toBe('calc(100% + 6px)');
    });

    it('the values readout takes only the room left beside the title and ellipsizes in it', () => {
        const { values } = setup({ px: 64 });
        expect(values).toBeDefined();
        expect(values.style.display).toBe('block'); // inline values — the ellipsis cuts across them
        expect(values.style.flexGrow).toBe('1');
        expect(values.style.flexBasis).toBe('0%');
        expect(values.style.minWidth).toBe('0px');
        expect(values.style.overflow).toBe('hidden');
        expect(values.style.textOverflow).toBe('ellipsis');
    });

    it('the title ellipsizes once the values are gone and the row is still too long', () => {
        const { title } = setup({ px: 64 });
        expect(title.style.minWidth).toBe('0px');
        expect(title.style.overflow).toBe('hidden');
        expect(title.style.textOverflow).toBe('ellipsis');
    });
});
