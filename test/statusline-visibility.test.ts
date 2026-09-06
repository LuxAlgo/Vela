import { describe, expect, it, vi } from 'vitest';
import type { Vela } from '../src/Vela';
import { Statusline } from '../src/widget/statusline';

describe('Statusline price-series visibility projection', () => {
    it('reads restored config immediately and follows later renderer config changes', () => {
        let onConfigChanged: (() => void) | undefined;
        const visible = { value: false };
        const chart = {
            on: vi.fn(() => () => undefined),
            renderer: {
                get: vi.fn(() => visible.value),
                onCrosshairMove: vi.fn(() => () => undefined),
                onConfigChanged: vi.fn((cb: () => void) => {
                    onConfigChanged = cb;
                    return () => undefined;
                }),
            },
        } as unknown as Vela;

        // Exercise the real binding method without constructing DOM chrome. Own-method
        // spies isolate the visibility projection from the status line's paint details.
        const statusline = Object.create(Statusline.prototype) as Statusline;
        const setChartHidden = vi.fn();
        Object.assign(statusline, {
            unsubs: [],
            detach: vi.fn(),
            render: vi.fn(),
            setChartHidden,
        });

        Statusline.prototype.onChart.call(statusline, chart);
        expect(setChartHidden).toHaveBeenLastCalledWith(true);

        visible.value = true;
        onConfigChanged?.();
        expect(setChartHidden).toHaveBeenLastCalledWith(false);
    });
});
