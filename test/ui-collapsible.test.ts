// @vitest-environment jsdom
// The kit's Collapsible: a header (or a host's trigger) that shows and hides a content. The
// user's toggles report through onOpenChange; setOpen moves it without reporting.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCollapsible } from '@luxalgo/vela-ui/collapsible';

afterEach(() => document.body.replaceChildren());

const part = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[data-slot="collapsible-${name}"]`);

describe('collapsible', () => {
    it('draws its header, closed, with the content hidden and linked', () => {
        const body = document.createElement('p');
        const c = createCollapsible({ title: 'Trades', count: 12, content: body });
        document.body.append(c.el);
        expect(c.el.getAttribute('data-slot')).toBe('collapsible');
        const trigger = part(c.el, 'trigger')!;
        expect(trigger).toBe(c.trigger);
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.getAttribute('data-variant')).toBe('default');
        expect(part(c.el, 'title')!.textContent).toBe('Trades');
        expect(part(c.el, 'count')!.textContent).toBe('12');
        expect(trigger.lastElementChild!.getAttribute('data-slot')).toBe('collapsible-chevron');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.getAttribute('aria-controls')).toBe(c.content.id);
        expect(c.content.contains(body)).toBe(true);
        expect(c.content.hidden).toBe(true);
        expect(c.open).toBe(false);
    });

    it('opens and closes on a press, saying so; setOpen says nothing', () => {
        const onOpenChange = vi.fn();
        const c = createCollapsible({ title: 'Notes', onOpenChange });
        document.body.append(c.el);
        c.trigger.click();
        expect(onOpenChange).toHaveBeenLastCalledWith(true);
        expect(c.open).toBe(true);
        expect(c.content.hidden).toBe(false);
        for (const el of [c.el, c.trigger, c.content]) expect(el.getAttribute('data-state')).toBe('open');
        expect(c.trigger.getAttribute('aria-expanded')).toBe('true');
        c.trigger.click();
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        c.setOpen(true);
        expect(c.open).toBe(true);
        expect(onOpenChange).toHaveBeenCalledTimes(2);
    });

    it('a group label puts its chevron first, and fills its content through a function', () => {
        const c = createCollapsible({ variant: 'label', title: 'Oscillators', count: '8', defaultOpen: true, content: (el) => el.append('rows') });
        expect(c.trigger.firstElementChild!.getAttribute('data-slot')).toBe('collapsible-chevron');
        expect(c.trigger.getAttribute('data-variant')).toBe('label');
        expect(c.content.textContent).toBe('rows');
        expect(c.content.hidden).toBe(false);
        c.setTitle('Trend');
        c.setCount(null);
        expect(part(c.el, 'title')!.textContent).toBe('Trend');
        expect(part(c.el, 'count')).toBeNull();
    });

    it("takes a host's trigger, leaving the content to place", () => {
        const onOpenChange = vi.fn();
        const chevron = document.createElement('button');
        const c = createCollapsible({ trigger: chevron, content: document.createTextNode('RSI, MACD'), onOpenChange });
        document.body.append(chevron, c.el);
        expect(c.trigger).toBe(chevron);
        expect(part(c.el, 'trigger')).toBeNull();
        expect(c.el.firstElementChild).toBe(c.content);
        expect(chevron.getAttribute('aria-controls')).toBe(c.content.id);
        chevron.click();
        expect(onOpenChange).toHaveBeenCalledWith(true);
        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        expect(chevron.getAttribute('data-state')).toBe('open');
        c.destroy();
        chevron.click();
        expect(onOpenChange).toHaveBeenCalledTimes(1);
    });

    it('ignores presses while disabled', () => {
        const onOpenChange = vi.fn();
        const c = createCollapsible({ title: 'Locked', disabled: true, onOpenChange });
        expect((c.trigger as HTMLButtonElement).disabled).toBe(true);
        c.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onOpenChange).not.toHaveBeenCalled();
        const span = document.createElement('span');
        const host = createCollapsible({ trigger: span, disabled: true, onOpenChange });
        expect(span.getAttribute('aria-disabled')).toBe('true');
        span.click();
        expect(host.open).toBe(false);
        host.setDisabled(false);
        expect(span.hasAttribute('aria-disabled')).toBe(false);
    });
});
