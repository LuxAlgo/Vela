// @vitest-environment jsdom
// The switch on Zag's switch machine: a label holding a hidden checkbox, whose state the
// root carries for the styles (data-state, data-disabled).
import { describe, expect, it, vi } from 'vitest';
import { createCheckbox } from '../packages/vela-ui/src/components/checkbox';

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the switch', () => {
    it('toggles on a click and reports the new state', async () => {
        const onChange = vi.fn();
        const sw = createCheckbox({ checked: false, onChange });
        document.body.append(sw.el);
        sw.el.click();
        expect(sw.checked).toBe(true); // at once, as callers read it
        expect(onChange).toHaveBeenCalledWith(true);
        await settle();
        expect(sw.el.dataset.state).toBe('checked');
        expect(onChange).toHaveBeenCalledWith(true);
        sw.destroy();
        sw.el.remove();
    });

    it('takes a value from code without reporting it', async () => {
        const onChange = vi.fn();
        const sw = createCheckbox({ checked: true, onChange });
        document.body.append(sw.el);
        sw.setChecked(false);
        await settle();
        expect(sw.checked).toBe(false);
        expect(sw.el.dataset.state).toBe('unchecked');
        expect(onChange).not.toHaveBeenCalled();
        sw.destroy();
        sw.el.remove();
    });

    it("puts the host's id on its focusable control, so a label for it toggles it", async () => {
        const onChange = vi.fn();
        const sw = createCheckbox({ id: 'notify', onChange });
        const label = document.createElement('label');
        label.htmlFor = 'notify';
        document.body.append(sw.el, label);
        expect(document.getElementById('notify')?.tagName).toBe('INPUT');
        label.click();
        await settle();
        expect(onChange).toHaveBeenCalledWith(true);
        sw.destroy();
        sw.el.remove();
        label.remove();
    });

    it('stays put while disabled', async () => {
        const onChange = vi.fn();
        const sw = createCheckbox({ disabled: true, onChange });
        document.body.append(sw.el);
        expect(sw.el.hasAttribute('data-disabled')).toBe(true);
        sw.el.click();
        await settle();
        expect(sw.checked).toBe(false);
        expect(onChange).not.toHaveBeenCalled();
        sw.destroy();
        sw.el.remove();
    });
});
