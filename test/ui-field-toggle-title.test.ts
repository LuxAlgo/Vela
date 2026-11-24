// @vitest-environment jsdom
// A checkbox row's title is part of the option: clicking the words toggles the box, the
// same as clicking the box itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFieldControl, fieldRow } from '../packages/vela-ui/src/components/field';

const settle = () => new Promise((r) => setTimeout(r, 0));

function titleOf(row: HTMLElement, text: string): HTMLElement {
    const title = [...row.querySelectorAll<HTMLElement>("[data-slot~='field-label']")].find((el) => el.textContent === text);
    if (!title) throw new Error(`no title "${text}"`);
    return title;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('checkbox titles in settings rows', () => {
    it('clicking the title of a checkbox setting turns it on, and again turns it off', async () => {
        const onChange = vi.fn();
        const row = fieldRow({ label: 'Show Session Anchor', id: 'anchor', bool: true, toggle: { id: 'anchor', checked: false, onChange } });
        document.body.append(row);

        titleOf(row, 'Show Session Anchor').click();
        await settle();
        expect(onChange).toHaveBeenLastCalledWith(true);
        expect((document.getElementById('anchor') as HTMLInputElement).checked).toBe(true);

        titleOf(row, 'Show Session Anchor').click();
        await settle();
        expect(onChange).toHaveBeenLastCalledWith(false);
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it('clicking the box itself still toggles it exactly once', async () => {
        const onChange = vi.fn();
        const row = fieldRow({ label: 'Show Session Anchor', bool: true, toggle: { checked: false, onChange } });
        document.body.append(row);

        row.querySelector<HTMLElement>('.vela-switch')!.click();
        await settle();
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('clicking the title of an enable toggle switches it and dims its controls', async () => {
        const onChange = vi.fn();
        const control = document.createElement('input');
        const row = fieldRow({ label: 'Extend lines', toggle: { checked: true, onChange }, control });
        document.body.append(row);

        titleOf(row, 'Extend lines').click();
        await settle();
        expect(onChange).toHaveBeenCalledWith(false);
        expect(control.classList.contains('vela-field-dim')).toBe(true);
    });

    it('clicking the title of a checkbox sharing a row with other inputs toggles that checkbox', async () => {
        const onChange = vi.fn();
        const sw = buildFieldControl({ kind: 'switch', id: 'show-band', checked: false, onChange });
        const width = buildFieldControl({ kind: 'number', id: 'band-width', value: 2, onChange: () => {} });
        const row = fieldRow({
            label: '',
            inline: [
                { label: 'Show band', id: 'show-band', control: sw.el, toggleFirst: true, fit: true },
                { label: 'Width', id: 'band-width', control: width.el },
            ],
        });
        document.body.append(row);

        titleOf(row, 'Show band').click();
        await settle();
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('clicking the title of a number input does not change anything', () => {
        const onChange = vi.fn();
        const width = buildFieldControl({ kind: 'number', id: 'band-width', value: 2, onChange });
        const row = fieldRow({ label: 'Width', id: 'band-width', control: width.el });
        document.body.append(row);

        titleOf(row, 'Width').click();
        expect(onChange).not.toHaveBeenCalled();
        expect(titleOf(row, 'Width').hasAttribute('data-toggles')).toBe(false);
    });

    it('clicking the title of a disabled checkbox leaves it as it was', async () => {
        const onChange = vi.fn();
        const sw = buildFieldControl({ kind: 'switch', id: 'locked', checked: false, onChange });
        const row = fieldRow({ label: '', inline: [{ label: 'Locked', id: 'locked', control: sw.el, toggleFirst: true, fit: true }] });
        document.body.append(row);
        (document.getElementById('locked') as HTMLInputElement).disabled = true;

        titleOf(row, 'Locked').click();
        await settle();
        expect(onChange).not.toHaveBeenCalled();
    });
});
