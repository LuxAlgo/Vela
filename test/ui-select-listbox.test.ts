// @vitest-environment jsdom
// The select's list on Zag's listbox machine: a click picks at once, the keyboard picks the
// highlighted option, and the list is a listbox the trigger announces.
import { describe, expect, it, vi } from 'vitest';
import { createSelect, fillSelectList, toggleSelectList } from '../packages/vela-ui/src/components/select';
import { closeOpenPopovers } from '../packages/vela-ui/src/components/popover';

const settle = () => new Promise((r) => setTimeout(r, 0));
// jsdom lays nothing out; the open list scrolls its checked option into view.
Element.prototype.scrollIntoView ??= function () {};
const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
];
const items = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-slot~="select-item"]')];

describe('the select', () => {
    it('opens a listbox the trigger announces, and a click picks at once', () => {
        const onChange = vi.fn();
        const sel = createSelect({ options: OPTIONS, value: 'b', onChange });
        document.body.append(sel.el);
        const trigger = sel.el.querySelector<HTMLButtonElement>('button')!;
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        trigger.click();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const list = document.querySelector('[role="listbox"]')!;
        expect(list).not.toBeNull();
        expect(items().map((i) => i.getAttribute('role'))).toEqual(['option', 'option', 'option']);
        expect(items()[1]!.getAttribute('aria-selected')).toBe('true');
        items()[2]!.click();
        expect(onChange).toHaveBeenCalledWith('c', 'Gamma');
        expect(sel.value).toBe('c');
        expect(trigger.textContent).toContain('Gamma');
        expect(document.querySelector('[role="listbox"]')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        sel.destroy();
        sel.el.remove();
    });

    it('still reports a pick of the current option', () => {
        const onChange = vi.fn();
        const sel = createSelect({ options: OPTIONS, value: 'a', onChange });
        document.body.append(sel.el);
        sel.el.querySelector('button')!.click();
        items()[0]!.click();
        expect(onChange).toHaveBeenCalledWith('a', 'Alpha');
        sel.destroy();
        sel.el.remove();
    });

    it('picks the highlighted option with Enter', async () => {
        const onChange = vi.fn();
        const sel = createSelect({ options: OPTIONS, value: 'a', onChange });
        document.body.append(sel.el);
        sel.el.querySelector('button')!.click();
        const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
        expect(document.activeElement).toBe(list);
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await settle();
        expect(items()[1]!.hasAttribute('data-highlighted')).toBe(true);
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        expect(onChange).toHaveBeenCalledWith('b', 'Beta');
        expect(document.activeElement).toBe(sel.el.querySelector('button'));
        sel.destroy();
        sel.el.remove();
    });

    it('leaves the focus on a trigger that did not ask for the list to take it', () => {
        const field = document.createElement('input');
        document.body.append(field);
        field.focus();
        toggleSelectList(field, OPTIONS, 'a', () => {});
        expect(document.querySelector('[role="listbox"]')).not.toBeNull();
        expect(document.activeElement).toBe(field);
        closeOpenPopovers();
        field.remove();
    });

    it('picks once per fill', () => {
        const onPick = vi.fn();
        const menu = document.createElement('div');
        document.body.append(menu);
        const dispose = fillSelectList(menu, OPTIONS, 'a', onPick);
        const [, beta, gamma] = [...menu.querySelectorAll<HTMLElement>('[data-slot~="select-item"]')];
        beta!.click();
        gamma!.click();
        expect(onPick.mock.calls).toEqual([['b', 'Beta']]);
        dispose();
        menu.remove();
    });

    it('lists a disabled option with its tooltip, and neither a click nor the keyboard picks it', async () => {
        const onChange = vi.fn();
        const options = [OPTIONS[0]!, { value: 'b', label: 'Beta', disabled: true, title: 'Not now' }, OPTIONS[2]!];
        const sel = createSelect({ options, value: 'a', onChange });
        document.body.append(sel.el);
        sel.el.querySelector('button')!.click();
        const beta = items()[1]!;
        expect(beta.hasAttribute('data-disabled')).toBe(true);
        expect(beta.getAttribute('aria-disabled')).toBe('true');
        expect(beta.title).toBe('Not now');
        beta.click();
        expect(onChange).not.toHaveBeenCalled();

        // The keyboard skips it: one step down from Alpha lands on Gamma.
        const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await settle();
        expect(items()[2]!.hasAttribute('data-highlighted')).toBe(true);
        list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        expect(onChange).toHaveBeenCalledWith('c', 'Gamma');
        sel.destroy();
        sel.el.remove();
    });
});
