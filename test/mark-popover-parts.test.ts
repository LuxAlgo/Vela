// @vitest-environment jsdom
// The timeline-mark popup is the kit's callout panel: its panel, titles, text and buttons are
// the panel's parts, so the kit's callout sheet gives them their look. The classes and the
// structure hosts hook into (`.vela-marks-panel > .vela-marks-section`, `.vela-callout-*`) stay.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarkPopover } from '../src/renderers/native/chrome/marks/MarkPopover';
import type { MarkCluster } from '../src/renderers/native/chrome/marks/layout';
import type { VelaTheme } from '../src/core/options';

const theme: VelaTheme = { background: '#000', textColor: '#fff', gridColor: '#222', borderColor: '#333', upColor: '#0f0', downColor: '#f00', fontFamily: 'sans-serif' };

const cluster: MarkCluster = {
    key: '10|earnings',
    bar: 10,
    group: 'earnings',
    marks: [
        {
            id: 'q1',
            time: 1,
            glyph: { color: '#4af', letter: 'E' },
            title: 'Earnings · Q1',
            content: {
                panel: {
                    items: [
                        { type: 'field', label: 'EPS', value: '6.12' },
                        { type: 'text', text: 'Beat on both lines.' },
                        { type: 'button', label: 'Transcript', primary: true, run: () => undefined },
                        { type: 'button', label: 'Dismiss', run: () => undefined },
                    ],
                },
            },
        },
        { id: 'q2', time: 2, glyph: { color: '#4af', letter: 'E' }, title: 'Earnings · Q2', content: { text: 'Scheduled.' } },
    ],
};

/** The rules of the kit's callout sheet that style `el`. */
function calloutRulesOn(el: Element): string[] {
    const sheet = (document.getElementById('vela-ui-callout-bubble') as HTMLStyleElement | null)?.sheet;
    const out: string[] = [];
    const walk = (list: CSSRuleList): void => {
        for (const rule of Array.from(list)) {
            if ('selectorText' in rule) {
                if (el.matches((rule as CSSStyleRule).selectorText)) out.push((rule as CSSStyleRule).selectorText);
            } else if ('cssRules' in rule && !('appendRule' in rule)) walk((rule as CSSGroupingRule).cssRules);
        }
    };
    if (sheet) walk(sheet.cssRules);
    return out;
}

describe('the timeline-mark popup', () => {
    let plot: HTMLElement;
    let popover: MarkPopover;

    beforeEach(() => {
        (globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
        plot = document.createElement('div');
        document.body.append(plot);
        popover = new MarkPopover({ plot, host: () => plot, theme: () => theme });
        popover.open(cluster, { x: 50, y: 50, size: 12 });
    });

    afterEach(() => {
        popover.destroy();
        plot.remove();
    });

    it("builds on the callout panel's parts, which the kit's callout sheet styles", () => {
        const pop = document.querySelector('.vela-marks-pop')!;
        const panel = pop.querySelector('.vela-marks-panel')!;
        const [title] = pop.querySelectorAll('.vela-callout-title');
        const text = pop.querySelector('.vela-callout-text')!;
        const actions = pop.querySelector('.vela-callout-actions')!;
        const [primary, plain] = pop.querySelectorAll<HTMLButtonElement>('.vela-callout-btn');
        expect(panel.getAttribute('data-slot')).toBe('callout-bubble-panel');
        expect(title!.getAttribute('data-slot')).toBe('callout-bubble-title');
        expect(text.getAttribute('data-slot')).toBe('callout-bubble-text');
        expect(actions.getAttribute('data-slot')).toBe('callout-bubble-actions');
        expect([primary!.getAttribute('data-slot'), plain!.getAttribute('data-slot')]).toEqual(['callout-bubble-button', 'callout-bubble-button']);
        expect([primary!.hasAttribute('data-primary'), plain!.hasAttribute('data-primary')]).toEqual([true, false]);
        for (const el of [panel, title!, text, actions, primary!, plain!]) expect(calloutRulesOn(el)).not.toEqual([]);
    });

    it('keeps the classes and the structure hosts hook into', () => {
        const panel = document.querySelector('.vela-marks-pop .vela-marks-panel.vela-callout-panel')!;
        const sections = panel.querySelectorAll(':scope > .vela-marks-section');
        expect(sections.length).toBe(2);
        expect(sections[0]!.querySelector(':scope > .vela-callout-title')?.textContent).toBe('Earnings · Q1');
        expect(sections[0]!.querySelector(':scope > .vela-marks-field > .vela-marks-field-label')?.textContent).toBe('EPS');
        expect(sections[0]!.querySelector('.vela-callout-btn.vela-callout-btn-primary')?.textContent).toBe('Transcript');
        expect(sections[1]!.querySelector(':scope > .vela-callout-text')?.textContent).toBe('Scheduled.');
    });
});
