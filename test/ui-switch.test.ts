// @vitest-environment jsdom
// The kit's Switch: a sliding on/off toggle with shadcn's props. Uncontrolled it moves on a
// press; given `checked` it only asks, through onCheckedChange, until the host moves it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSwitch } from '../packages/vela-ui/src/components/switch';

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => document.body.replaceChildren());

describe('the switch', () => {
    it('draws a track and a thumb, with its size and variant', () => {
        const sw = createSwitch({ size: 'sm', variant: 'destructive', label: 'Kill switch' });
        document.body.append(sw.el);
        expect(sw.el.getAttribute('data-slot')).toBe('switch');
        expect(sw.el.getAttribute('data-size')).toBe('sm');
        expect(sw.el.getAttribute('data-variant')).toBe('destructive');
        expect(sw.el.querySelector('[data-slot="switch-control"] [data-slot="switch-thumb"]')).not.toBeNull();
        expect(sw.el.querySelector('input')?.getAttribute('aria-label')).toBe('Kill switch');
    });

    it('moves on a press when uncontrolled, and says so', async () => {
        const onCheckedChange = vi.fn();
        const sw = createSwitch({ onCheckedChange });
        document.body.append(sw.el);
        await settle();
        sw.el.querySelector('input')!.click();
        await settle();
        expect(onCheckedChange).toHaveBeenCalledWith(true);
        expect(sw.checked).toBe(true);
        expect(sw.el.getAttribute('data-state')).toBe('checked');
    });

    it('only asks when controlled, until setChecked moves it', async () => {
        const onCheckedChange = vi.fn();
        const sw = createSwitch({ checked: false, onCheckedChange });
        document.body.append(sw.el);
        await settle();
        sw.el.querySelector('input')!.click();
        await settle();
        expect(onCheckedChange).toHaveBeenCalledWith(true);
        expect(sw.checked).toBe(false);
        expect(sw.el.getAttribute('data-state')).toBe('unchecked');
        sw.setChecked(true);
        await settle();
        expect(sw.checked).toBe(true);
        expect(sw.el.getAttribute('data-state')).toBe('checked');
    });

    it('submits its value under its name while on', async () => {
        const form = document.createElement('form');
        const sw = createSwitch({ defaultChecked: true, name: 'ask', value: 'yes', required: true });
        form.append(sw.el);
        document.body.append(form);
        await settle();
        const input = sw.el.querySelector('input')!;
        expect(input.required).toBe(true);
        expect(new FormData(form).get('ask')).toBe('yes');
    });

    it('does not move while disabled', async () => {
        const onCheckedChange = vi.fn();
        const sw = createSwitch({ disabled: true, onCheckedChange });
        document.body.append(sw.el);
        await settle();
        sw.el.querySelector('input')!.click();
        await settle();
        expect(sw.checked).toBe(false);
        expect(sw.el.hasAttribute('data-disabled')).toBe(true);
    });

    it('is disabled and enabled again through setDisabled', async () => {
        const onCheckedChange = vi.fn();
        const sw = createSwitch({ onCheckedChange });
        document.body.append(sw.el);
        await settle();
        sw.setDisabled(true);
        await settle();
        expect(sw.el.hasAttribute('data-disabled')).toBe(true);
        sw.el.querySelector('input')!.click();
        await settle();
        expect(sw.checked).toBe(false);
        sw.setDisabled(false);
        await settle();
        expect(sw.el.hasAttribute('data-disabled')).toBe(false);
        sw.el.querySelector('input')!.click();
        await settle();
        expect(sw.checked).toBe(true);
    });
});
