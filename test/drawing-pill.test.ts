// @vitest-environment jsdom
// The floating drawing pill a phone shows while a drawing tool is armed.
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import type { SnapMode } from '../src/core/drawings';
import { DrawingPill } from '../src/widget/drawing-pill';

afterEach(() => {
    document.body.replaceChildren();
});

/** A chart with a drawing tool armed, as far as the pill reads it. */
function chartWithToolArmed(): { chart: unknown; snap: () => SnapMode } {
    const listeners = new Map<string, () => void>();
    let snap: SnapMode = 'off';
    const chart = {
        i18n: undefined,
        on: (event: string, cb: () => void) => {
            listeners.set(event, cb);
            return () => listeners.delete(event);
        },
        drawings: {
            supported: true,
            getTool: () => 'trendline',
            getMode: () => null,
            getStayMode: () => false,
            getSnapMode: () => snap,
            setSnapMode: (mode: SnapMode) => {
                snap = mode;
                listeners.get('drawing:snap')?.();
            },
        },
    };
    return { chart, snap: () => snap };
}

describe('the drawing pill', () => {
    it('shows the magnet strength as bars, so no language needs a letter for weak or strong', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const pill = new DrawingPill(host);
        const { chart, snap } = chartWithToolArmed();
        pill.onChart(chart as never);

        const badge = host.querySelector<HTMLElement>('.vela-drawpill-badge')!;
        const magnet = badge.closest('button')!;
        expect(badge.dataset.strength).toBeUndefined();

        const shown: Array<[SnapMode, string | undefined, string]> = [];
        for (let i = 0; i < 3; i++) {
            magnet.click();
            shown.push([snap(), badge.dataset.strength, badge.textContent ?? '']);
        }
        expect(shown).toEqual([
            ['weak', 'weak', ''],
            ['strong', 'strong', ''],
            ['off', undefined, ''],
        ]);
        expect(badge.querySelectorAll('i')).toHaveLength(2);
        pill.destroy();
    });
});
