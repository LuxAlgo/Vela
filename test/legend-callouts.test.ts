// Legend callout contributions (src/widget/contributions.ts) and the callout-bubble
// controller's pure projection rules (src/ui/components/callout-bubble/controller.ts).
// DOM-free — node env; the bubble's rendering and the deployed panel are proven in the
// browser (the view is a thin projection over these).
import { describe, it, expect } from 'vitest';
import {
    registerLegendCallout,
    unregisterLegendCallout,
    legendCallouts,
    legendCalloutsProviderFor,
    type LegendCalloutSpec,
    type LegendIndicatorInfo,
} from '../src/widget/contributions';
import { calloutPanelRows, closesPanel, type CalloutPanelItem } from '../src/ui/components/callout-bubble';

describe('legend callout contributions', () => {
    it('registers, order-sorts, replaces by id, and unregisters', () => {
        const d1 = registerLegendCallout({ id: 'ca', order: 2, callout: () => null });
        registerLegendCallout({ id: 'cb', order: 1, callout: () => null });
        expect(legendCallouts().map((c) => c.id)).toEqual(['cb', 'ca']);

        registerLegendCallout({ id: 'ca', callout: () => ({ icon: 'i2', background: 'red', tooltip: 'A2' }) });
        expect(legendCallouts().find((c) => c.id === 'ca')?.callout({ id: 'x', title: 'X' })?.tooltip).toBe('A2');
        d1(); // stale disposer must NOT remove the replacement
        expect(legendCallouts().some((c) => c.id === 'ca')).toBe(true);

        unregisterLegendCallout('ca');
        unregisterLegendCallout('cb');
        expect(legendCallouts()).toHaveLength(0);
    });

    it('the shell provider resolves the row, skips null specs, and binds a FRESH context per button click', () => {
        const seen: LegendIndicatorInfo[] = [];
        const ctxs: unknown[] = [];
        registerLegendCallout({
            id: 'status',
            callout: (ind) =>
                ind.source === undefined
                    ? null // natives show no bubble — the per-indicator gate
                    : {
                          icon: 'market-open',
                          background: 'var(--vela-up)',
                          color: 'red',
                          tooltip: `Status of ${ind.title}`,
                          content: {
                              title: 'Session',
                              items: [
                                  { type: 'text', text: 'Market is open.' },
                                  {
                                      type: 'button',
                                      label: 'Details',
                                      run: (ctx, i) => {
                                          ctxs.push(ctx);
                                          seen.push(i);
                                      },
                                  },
                              ],
                          },
                      },
        });

        const chart = {
            indicators: () => [
                { id: 'ind-1', title: 'EMA', source: 'plot(close)' },
                { id: 'native-1', title: 'Volume' }, // a native: no source
            ],
        } as never;
        let builds = 0;
        const provider = legendCalloutsProviderFor(chart, () => ({ built: ++builds }) as never);

        expect(provider('missing')).toEqual([]); // an unknown row contributes nothing
        expect(provider('native-1')).toHaveLength(0); // null spec: no bubble
        const views = provider('ind-1');
        expect(views).toHaveLength(1);
        expect(views[0]).toMatchObject({ id: 'status', icon: 'market-open', background: 'var(--vela-up)', color: 'red', tooltip: 'Status of EMA' });
        expect(views[0]!.content?.title).toBe('Session');
        expect(views[0]!.content?.items[0]).toEqual({ type: 'text', text: 'Market is open.' });

        const button = views[0]!.content!.items[1]!;
        if (button.type !== 'button') throw new Error('expected a button item');
        button.run();
        button.run();
        expect(seen[0]).toEqual({ id: 'ind-1', title: 'EMA', source: 'plot(close)' });
        expect(ctxs).toEqual([{ built: 1 }, { built: 2 }]); // never a cached context

        unregisterLegendCallout('status');
    });

    it('a spec without content projects a bubble without a panel (not clickable)', () => {
        registerLegendCallout({ id: 'plain', callout: () => ({ icon: 'i', background: 'b', tooltip: 't' }) satisfies LegendCalloutSpec });
        const chart = { indicators: () => [{ id: 'ind-1', title: 'T' }] } as never;
        const views = legendCalloutsProviderFor(chart, () => ({}) as never)('ind-1');
        expect(views).toHaveLength(1);
        expect(views[0]!.content).toBeUndefined();
        unregisterLegendCallout('plain');
    });
});

describe('callout panel projection (pure controller rules)', () => {
    it('groups consecutive buttons into one actions row, text blocks stand alone', () => {
        const run = (): void => {};
        const items: CalloutPanelItem[] = [
            { type: 'text', text: 'one' },
            { type: 'button', label: 'A', run },
            { type: 'button', label: 'B', run },
            { type: 'text', text: 'two' },
            { type: 'button', label: 'C', run },
        ];
        const rows = calloutPanelRows(items);
        expect(rows.map((r) => r.type)).toEqual(['text', 'buttons', 'text', 'buttons']);
        expect(rows[1]!.type === 'buttons' && rows[1]!.buttons.map((b) => b.label)).toEqual(['A', 'B']);
        expect(rows[3]!.type === 'buttons' && rows[3]!.buttons.map((b) => b.label)).toEqual(['C']);
    });

    it('buttons close the panel by default; close:false keeps it open', () => {
        const run = (): void => {};
        expect(closesPanel({ type: 'button', label: 'A', run })).toBe(true);
        expect(closesPanel({ type: 'button', label: 'A', close: false, run })).toBe(false);
        expect(closesPanel({ type: 'button', label: 'A', close: true, run })).toBe(true);
    });
});
