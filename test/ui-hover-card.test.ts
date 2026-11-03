// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachHoverCard, createHoverCard } from '@luxalgo/vela-ui/hover-card';

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('hover-card', () => {
    it('lays out its heading with keycaps, description, body and hint', () => {
        const body = document.createElement('figure');
        const { el } = createHoverCard({ title: 'Long position', icon: 'close', shortcut: 'Alt+L', description: 'Draws a long trade.', body, hint: 'Shift-click to keep the tool', wide: true }, 'left');
        expect(el.getAttribute('role')).toBe('tooltip');
        expect(el.dataset.side).toBe('left');
        expect(el.hasAttribute('data-wide')).toBe(true);
        const heading = el.querySelector('[data-slot="hover-card-heading"]')!;
        expect([...heading.children].map((c) => c.getAttribute('data-slot'))).toEqual(['hover-card-icon', 'hover-card-title', 'kbd', 'kbd']);
        expect([...el.children].map((c) => c.getAttribute('data-slot'))).toEqual(['hover-card-heading', 'hover-card-description', 'hover-card-body', 'hover-card-hint']);
    });

    it('opens after the pointer rests on its trigger, and closes on leave', () => {
        vi.useFakeTimers();
        const trigger = document.body.appendChild(document.createElement('button'));
        const host = document.body.appendChild(document.createElement('div'));
        let title: string | null = 'Alerts';
        const detach = attachHoverCard(trigger, () => (title ? { title } : null), { host, delay: 200 });
        trigger.dispatchEvent(new Event('pointerenter'));
        vi.advanceTimersByTime(199);
        expect(host.children).toHaveLength(0);
        vi.advanceTimersByTime(1);
        expect(host.querySelector('[data-slot="hover-card-title"]')!.textContent).toBe('Alerts');
        trigger.dispatchEvent(new Event('pointerleave'));
        expect(host.children).toHaveLength(0);
        title = null;
        trigger.dispatchEvent(new Event('pointerenter'));
        vi.advanceTimersByTime(300);
        expect(host.children).toHaveLength(0);
        detach();
    });
});
