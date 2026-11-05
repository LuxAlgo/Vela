// @vitest-environment jsdom
// The status line's badge: the market session state normally, the replay mode while the
// chart replays past bars — and the ticker's dot spacing.
import { describe, it, expect } from 'vitest';
import { Statusline } from '../src/widget/statusline';

// jsdom ships no CSS.escape; the kit's style injection needs it for its id lookup.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

function make() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const line = new Statusline(host, 'BINANCE:BTCUSDT');
    const badge = line.el.querySelector<HTMLElement>('.vela-sl-market')!;
    return { line, badge };
}

describe('Statusline badge', () => {
    it('shows the replay mode while replaying, then the market status again', () => {
        const { line, badge } = make();
        expect(badge.dataset.status).toBe('open');

        const bubble = badge.querySelector<HTMLElement>('.vela-callout')!;
        const replay = badge.querySelector<HTMLElement>('.vela-sl-replay-badge')!;
        expect([bubble.hidden, replay.hidden]).toEqual([false, true]);

        line.setReplaying(true);
        expect(badge.dataset.status).toBe('replay');
        expect([bubble.hidden, replay.hidden]).toEqual([true, false]);
        // circle and glyph in one drawing, in the inverse chip's colors (white on dark, dark on light)
        expect(replay.querySelector('circle')!.getAttribute('style')).toContain('var(--vela-selected-bg)');
        expect(replay.querySelector('path')!.getAttribute('style')).toContain('var(--vela-selected-fg)');

        line.setMarketStatus('closed'); // a session change while replaying waits for the end
        expect(badge.dataset.status).toBe('replay');

        line.setReplaying(false);
        expect(badge.dataset.status).toBe('closed');
        expect([bubble.hidden, replay.hidden]).toEqual([false, true]);
        line.destroy();
    });

    it('sits the meta dot one space after the ticker, not a full row gap away', () => {
        make().line.destroy();
        const css = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
        expect(css).toContain('.vela-statusline .vela-sl-symbol + .vela-sl-meta { margin-inline-start: calc(var(--vela-space-1) - var(--vela-space-2)); }');
    });
});
