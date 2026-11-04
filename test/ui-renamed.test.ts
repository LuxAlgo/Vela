// @vitest-environment jsdom
// The kit renamed components after shadcn (Switch is a checkbox, TextField an input, Menu a
// dropdown menu); Vela's UI entry keeps the earlier names working for one release.
import { describe, expect, it } from 'vitest';
import {
    Checkbox,
    DropdownMenu,
    Input,
    Menu,
    Switch,
    TextField,
    createCheckbox,
    createDropdownMenu,
    createInput,
    createMenu,
    createSwitch,
    createTextField,
    checkboxController,
    dropdownMenuController,
    menuController,
    switchController,
    inputController,
    textFieldController,
} from '../src/ui';

describe('the renamed components', () => {
    it('answer to their earlier names', () => {
        expect(Switch).toBe(Checkbox);
        expect(createSwitch).toBe(createCheckbox);
        expect(switchController).toBe(checkboxController);
        expect(TextField).toBe(Input);
        expect(createTextField).toBe(createInput);
        expect(textFieldController).toBe(inputController);
        expect(Menu).toBe(DropdownMenu);
        expect(createMenu).toBe(createDropdownMenu);
        expect(menuController).toBe(dropdownMenuController);
        const box = new Switch({ checked: true });
        expect(box).toBeInstanceOf(Checkbox);
        expect(box.el.getAttribute('data-slot')).toBe('checkbox');
        expect(new TextField({ value: 'a' }).el.querySelector('input')?.getAttribute('data-slot')).toBe('input-control');
    });

    it('stamp the dropdown menu slots, whichever name opened it', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const menu = new Menu({ host, items: [{ id: 'a', label: 'A' }] });
        const list = document.querySelector('.vela-menu');
        expect(list?.getAttribute('data-slot')).toBe('dropdown-menu-content');
        expect(list?.querySelector('.vela-menu-item')?.getAttribute('data-slot')).toBe('dropdown-menu-item');
        menu.destroy();
        host.remove();
    });
});
