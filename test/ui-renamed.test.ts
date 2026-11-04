// @vitest-environment jsdom
// The kit renamed two components after shadcn (Switch is a checkbox, TextField an input);
// Vela's UI entry keeps the earlier names working for one release.
import { describe, expect, it } from 'vitest';
import { Checkbox, Input, Switch, TextField, createCheckbox, createInput, createSwitch, createTextField, checkboxController, switchController, inputController, textFieldController } from '../src/ui';

describe('the renamed components', () => {
    it('answer to their earlier names', () => {
        expect(Switch).toBe(Checkbox);
        expect(createSwitch).toBe(createCheckbox);
        expect(switchController).toBe(checkboxController);
        expect(TextField).toBe(Input);
        expect(createTextField).toBe(createInput);
        expect(textFieldController).toBe(inputController);
        const box = new Switch({ checked: true });
        expect(box).toBeInstanceOf(Checkbox);
        expect(box.el.getAttribute('data-slot')).toBe('checkbox');
        expect(new TextField({ value: 'a' }).el.querySelector('input')?.getAttribute('data-slot')).toBe('input-control');
    });
});
