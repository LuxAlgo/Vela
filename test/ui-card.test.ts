// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createCard } from '@luxalgo/vela-ui/card';

const part = (el: HTMLElement, name: string) => el.querySelector<HTMLElement>(`[data-slot="card-${name}"]`);
const slots = (el: Element) => [...el.children].map((c) => c.getAttribute('data-slot'));

describe('card', () => {
    it('lays out its header, content and footer in order, its title a heading', () => {
        const button = document.createElement('button');
        const card = createCard({ eyebrow: 'Market pulse', title: 'Your markets', description: 'Equal tiles', action: button, content: 'Body', footer: 'Moves since the close', variant: 'inset', size: 'sm', headingLevel: 2 });
        expect(card.el.getAttribute('data-slot')).toBe('card');
        expect([card.el.getAttribute('data-variant'), card.el.getAttribute('data-size')]).toEqual(['inset', 'sm']);
        expect(slots(card.el)).toEqual(['card-header', 'card-content', 'card-footer']);
        expect(slots(part(card.el, 'header')!)).toEqual(['card-heading', 'card-action']);
        expect(slots(part(card.el, 'heading')!)).toEqual(['card-eyebrow', 'card-title', 'card-description']);
        expect(part(card.el, 'title')!.tagName).toBe('H2');
        expect(part(card.el, 'action')!.firstChild).toBe(button);
        expect(card.content.textContent).toBe('Body');
    });

    it('has no header without one, and takes a title, a description and a footer later', () => {
        const card = createCard();
        expect(slots(card.el)).toEqual(['card-content']);
        card.setDescription('Second line');
        card.setTitle('First line');
        card.setFooter('Note');
        expect(slots(part(card.el, 'heading')!)).toEqual(['card-title', 'card-description']);
        expect(slots(card.el)).toEqual(['card-header', 'card-content', 'card-footer']);
        card.setTitle(null);
        card.setFooter(null);
        expect(part(card.el, 'title')).toBeNull();
        expect(part(card.el, 'footer')).toBeNull();
    });

    it('runs onSelect from a click anywhere on it but on its own controls, its title the button', () => {
        const onSelect = vi.fn();
        const inner = document.createElement('button');
        const card = createCard({ title: 'BTCUSDT', action: inner, content: 'Body', onSelect });
        const trigger = part(card.el, 'trigger')!;
        expect(trigger.tagName).toBe('BUTTON');
        expect(trigger.textContent).toBe('BTCUSDT');
        expect(card.el.hasAttribute('role')).toBe(false);
        expect(card.el.hasAttribute('tabindex')).toBe(false);
        card.content.click();
        trigger.click();
        expect(onSelect).toHaveBeenCalledTimes(2);
        inner.click();
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('is the button itself without a title, Enter and Space included', () => {
        const onSelect = vi.fn();
        const card = createCard({ content: 'Body', onSelect });
        expect(card.el.getAttribute('role')).toBe('button');
        expect(card.el.tabIndex).toBe(0);
        card.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        card.el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(onSelect).toHaveBeenCalledTimes(2);
        card.setTitle('Now titled');
        expect(card.el.hasAttribute('role')).toBe(false);
        card.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('says which card is current, and stops when disabled', () => {
        const onSelect = vi.fn();
        const card = createCard({ title: 'ETHUSDT', onSelect, selected: true });
        const trigger = part(card.el, 'trigger') as HTMLButtonElement;
        expect(card.el.hasAttribute('data-selected')).toBe(true);
        expect(trigger.getAttribute('aria-current')).toBe('true');
        card.setDisabled(true);
        expect(trigger.disabled).toBe(true);
        card.content.click();
        expect(onSelect).not.toHaveBeenCalled();
        const bare = createCard({ onSelect, disabled: true });
        expect([bare.el.tabIndex, bare.el.getAttribute('aria-disabled')]).toEqual([-1, 'true']);
    });
});
