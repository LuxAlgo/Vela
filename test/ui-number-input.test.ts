// @vitest-environment jsdom
// The number field on Zag's number-input machine: the spinbutton (ARIA, the steppers) is the
// machine's, the commit rules stay the field's own and report at once.
import { describe, expect, it, vi } from 'vitest';
import { createNumberInput } from '../packages/vela-ui/src/components/number-input';

const settle = () => new Promise((r) => setTimeout(r, 0));
const type = (input: HTMLInputElement, text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('the number field', () => {
    it('commits on blur, clamped, and not while the user types', () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 5, min: 0, max: 10, onChange });
        document.body.append(ni.el);
        type(ni.input, '42');
        expect(onChange).not.toHaveBeenCalled();
        ni.input.dispatchEvent(new Event('blur'));
        expect(onChange).toHaveBeenCalledWith(10);
        expect(ni.value).toBe(10);
        expect(ni.input.value).toBe('10');
        ni.destroy();
        ni.el.remove();
    });

    it('commits on Enter', () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 1, onChange });
        document.body.append(ni.el);
        ni.input.focus();
        type(ni.input, '2.5');
        ni.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(onChange).toHaveBeenCalledWith(2.5);
        ni.destroy();
        ni.el.remove();
    });

    it('reports every keystroke in live mode', () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 1, commit: 'live', onChange });
        document.body.append(ni.el);
        type(ni.input, '1');
        type(ni.input, '12');
        expect(onChange.mock.calls.map((c) => c[0])).toEqual([12]); // 1 is the value already
        ni.destroy();
        ni.el.remove();
    });

    it('shows the default as an empty field in placeholder mode', () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 20, placeholder: 'Auto', emptyValue: 20, onChange });
        document.body.append(ni.el);
        expect(ni.input.value).toBe('');
        expect(ni.input.placeholder).toBe('Auto');
        type(ni.input, '30');
        ni.input.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenLastCalledWith(30);
        type(ni.input, '');
        ni.input.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenLastCalledWith(20);
        expect(ni.input.value).toBe('');
        ni.destroy();
        ni.el.remove();
    });

    it('takes a value from code without reporting it', async () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 1, onChange });
        document.body.append(ni.el);
        ni.setValue(7);
        await settle();
        expect(ni.value).toBe(7);
        expect(ni.input.value).toBe('7');
        expect(onChange).not.toHaveBeenCalled();
        ni.destroy();
        ni.el.remove();
    });

    it('steps by a press on a stepper, and is a labelled spinbutton under the host id', async () => {
        const onChange = vi.fn();
        const ni = createNumberInput({ value: 1.7, step: 0.1, id: 'qty', onChange });
        document.body.append(ni.el);
        expect(document.getElementById('qty')).toBe(ni.input);
        expect(ni.input.getAttribute('role')).toBe('spinbutton');
        const [up] = ni.el.querySelectorAll<HTMLButtonElement>('button');
        expect(up!.getAttribute('aria-label')).toBe('Increase');
        up!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        up!.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
        await settle();
        expect(onChange).toHaveBeenCalledWith(1.8);
        expect(ni.value).toBe(1.8);
        ni.destroy();
        ni.el.remove();
    });
});
