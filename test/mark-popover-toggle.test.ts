// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkPopover } from '../src/renderers/native/chrome/marks/MarkPopover';
import type { MarkCluster } from '../src/renderers/native/chrome/marks/layout';
import type { VelaTheme } from '../src/core/options';

// The renderer's gesture on a lane glyph, as the DOM sees it: pointerdown on the canvas
// (the kit Popover's outside-dismiss runs here — the glyph is canvas pixels, so the
// popup's hit-transparent anchor is never the target), pointerup, then the renderer
// turns that release into `open()` for the glyph under it.

const theme: VelaTheme = { background: '#000', textColor: '#fff', gridColor: '#222', borderColor: '#333', upColor: '#0f0', downColor: '#f00', fontFamily: 'sans-serif' };

function cluster(key: string): MarkCluster {
    return { key, bar: 10, group: 'news', marks: [{ id: key, time: 1, glyph: { color: '#4af', letter: 'N' }, title: key, content: { text: 'body' } }] };
}

describe('MarkPopover click toggle', () => {
    let plot: HTMLElement;
    let canvas: HTMLElement;
    let popover: MarkPopover;
    let openChanges: Array<string | null>;

    const press = (target: HTMLElement): void => {
        target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    };
    const release = (target: HTMLElement): void => {
        target.dispatchEvent(new Event('pointerup', { bubbles: true }));
    };
    // The deferred outside-dismiss listener (setTimeout 0 after show) and the release clear.
    const settle = async (): Promise<void> => {
        await vi.runAllTimersAsync();
    };

    beforeEach(() => {
        // jsdom ships no CSS.escape; the kit's style injection needs it for id lookups.
        if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
            (globalThis as { CSS?: unknown }).CSS = { ...(globalThis as { CSS?: object }).CSS, escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`) };
        }
        vi.useFakeTimers();
        plot = document.createElement('div');
        canvas = document.createElement('canvas');
        plot.appendChild(canvas);
        document.body.appendChild(plot);
        openChanges = [];
        popover = new MarkPopover({ plot, host: () => plot, theme: () => theme, onOpenChange: (k) => openChanges.push(k) });
    });

    afterEach(() => {
        popover.destroy();
        plot.remove();
        vi.useRealTimers();
    });

    it('opens on the first click and closes — without reopening — on the second click of the same glyph', async () => {
        const c = cluster('10|news');
        press(canvas);
        release(canvas);
        popover.open(c, { x: 50, y: 50, size: 12 });
        await settle();
        expect(popover.key).toBe('10|news');

        press(canvas); // the shell's outside-dismiss closes the popup here
        release(canvas);
        popover.open(c, { x: 50, y: 50, size: 12 }); // the renderer's click on the same glyph
        await settle();
        expect(popover.key).toBeNull();
        expect(openChanges).toEqual(['10|news', null]);

        // A third click opens it again: the toggle is per press, not sticky.
        press(canvas);
        release(canvas);
        popover.open(c, { x: 50, y: 50, size: 12 });
        await settle();
        expect(popover.key).toBe('10|news');
    });

    it('switches to another glyph in one click', async () => {
        popover.open(cluster('10|news'), { x: 50, y: 50, size: 12 });
        await settle();
        press(canvas);
        release(canvas);
        popover.open(cluster('20|news'), { x: 90, y: 50, size: 12 });
        await settle();
        expect(popover.key).toBe('20|news');
    });

    it('reopens after an Escape dismissal without needing two clicks', async () => {
        const c = cluster('10|news');
        popover.open(c, { x: 50, y: 50, size: 12 });
        await settle();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await settle();
        expect(popover.key).toBeNull();
        press(canvas);
        release(canvas);
        popover.open(c, { x: 50, y: 50, size: 12 });
        await settle();
        expect(popover.key).toBe('10|news');
    });
});
