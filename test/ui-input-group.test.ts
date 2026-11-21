// @vitest-environment jsdom
// The kit's InputGroup: an input with addons inside its border, at its start or end or in a
// row above or below, reporting every keystroke.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInputGroup } from '../packages/vela-ui/src/components/input-group';
import { createInput } from '../packages/vela-ui/src/components/input';

afterEach(() => document.body.replaceChildren());

describe('the input group', () => {
    it('lays its addons out around the input, in their order', () => {
        const g = createInputGroup({
            addons: [
                { icon: 'search' },
                { align: 'inline-end', text: 'USD' },
                { align: 'block-start', text: 'Amount' },
            ],
        });
        const parts = [...g.el.children].map((c) => `${c.getAttribute('data-slot')}:${c.getAttribute('data-align') ?? ''}`);
        expect(parts).toEqual(['input-group-addon:block-start', 'input-group-addon:inline-start', 'input-group-control:', 'input-group-addon:inline-end']);
        expect(g.el.hasAttribute('data-block')).toBe(true);
        expect(g.el.hasAttribute('data-start')).toBe(true);
        expect(g.el.querySelector('[data-align="inline-end"] [data-slot="input-group-text"]')?.textContent).toBe('USD');
    });

    it('reports every keystroke, and takes its type, name and label', () => {
        const onValueChange = vi.fn();
        const g = createInputGroup({ type: 'search', name: 'q', label: 'Search', placeholder: 'Search', onValueChange });
        document.body.append(g.el);
        expect(g.input.type).toBe('search');
        expect(g.input.name).toBe('q');
        expect(g.input.getAttribute('aria-label')).toBe('Search');
        g.input.value = 'btc';
        g.input.dispatchEvent(new Event('input'));
        expect(onValueChange).toHaveBeenCalledWith('btc');
        expect(g.value).toBe('btc');
    });

    it("runs a button addon's press", () => {
        const onClick = vi.fn();
        const g = createInputGroup({ addons: [{ align: 'inline-end', button: { label: 'Clear', icon: 'close', onClick } }] });
        document.body.append(g.el);
        const button = g.el.querySelector<HTMLButtonElement>('[data-slot="input-group-addon"] button')!;
        expect(button.getAttribute('aria-label')).toBe('Clear');
        button.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('the plain Input takes a type too', () => {
        expect(createInput({ type: 'password' }).input.type).toBe('password');
    });
});
