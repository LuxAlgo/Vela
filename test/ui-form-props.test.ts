// @vitest-environment jsdom
// The form controls take shadcn's props: a starting value, the change callback by its shadcn
// name, a placeholder, and the name and required that let a form submit and validate them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSwitch } from '../packages/vela-ui/src/components/switch';
import { createSelect } from '../packages/vela-ui/src/components/select';
import { createTextField } from '../packages/vela-ui/src/components/text-field';
import { createTextArea } from '../packages/vela-ui/src/components/text-area';
import { createNumberInput } from '../packages/vela-ui/src/components/number-input';

Element.prototype.scrollIntoView ??= function () {};
const settle = () => new Promise((r) => setTimeout(r, 0));
const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
];

afterEach(() => document.body.replaceChildren());

describe('the form controls', () => {
    it('switch: starts from defaultChecked, reports through onCheckedChange, submits under its name', async () => {
        const onCheckedChange = vi.fn();
        const form = document.createElement('form');
        const sw = createSwitch({ defaultChecked: true, onCheckedChange, name: 'alerts', required: true });
        form.append(sw.el);
        document.body.append(form);
        await settle();
        expect(sw.checked).toBe(true);
        const input = sw.el.querySelector('input')!;
        expect(input.name).toBe('alerts');
        expect(input.required).toBe(true);
        expect(new FormData(form).get('alerts')).toBe('on');
        input.click();
        expect(onCheckedChange).toHaveBeenCalledWith(false);
    });

    it('select: shows its placeholder until a pick, reports through onValueChange', () => {
        const onValueChange = vi.fn();
        const sel = createSelect({ options: OPTIONS, placeholder: 'Pick one', onValueChange });
        document.body.append(sel.el);
        const value = sel.el.querySelector<HTMLElement>('[data-slot~="select-value"]')!;
        expect(sel.value).toBe('');
        expect(value.textContent).toBe('Pick one');
        expect(value.hasAttribute('data-placeholder')).toBe(true);
        sel.el.querySelector('button')!.click();
        document.querySelectorAll<HTMLElement>('[data-slot~="select-item"]')[1]!.click();
        expect(onValueChange).toHaveBeenCalledWith('b', 'Beta');
        expect(value.textContent).toBe('Beta');
        expect(value.hasAttribute('data-placeholder')).toBe(false);
    });

    it('select: starts from defaultValue, and submits and validates through a hidden native select', () => {
        const form = document.createElement('form');
        const sel = createSelect({ options: OPTIONS, placeholder: 'Pick one', name: 'side', required: true });
        form.append(sel.el);
        document.body.append(form);
        const native = sel.el.querySelector('select')!;
        expect(native.name).toBe('side');
        expect(form.checkValidity()).toBe(false);
        sel.setValue('a');
        expect(new FormData(form).get('side')).toBe('a');
        expect(form.checkValidity()).toBe(true);
        expect(createSelect({ options: OPTIONS, defaultValue: 'b' }).value).toBe('b');
    });

    it('text field and text area: defaultValue, placeholder, name and required', () => {
        const tf = createTextField({ defaultValue: 'BTC', placeholder: 'Symbol', name: 'symbol', required: true });
        expect(tf.input.value).toBe('BTC');
        expect(tf.input.placeholder).toBe('Symbol');
        expect(tf.input.name).toBe('symbol');
        expect(tf.input.required).toBe(true);
        const ta = createTextArea({ defaultValue: 'Note', name: 'note', required: true });
        expect(ta.input.value).toBe('Note');
        expect(ta.input.name).toBe('note');
        expect(ta.input.required).toBe(true);
    });

    it('number field: name and required', () => {
        const ni = createNumberInput({ value: 5, name: 'qty', required: true });
        document.body.append(ni.el);
        expect(ni.input.name).toBe('qty');
        expect(ni.input.required).toBe(true);
    });
});
