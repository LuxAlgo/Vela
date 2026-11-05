// @vitest-environment jsdom
// The kit renamed components after shadcn (Switch is a checkbox, TextField an input, Menu a
// dropdown menu); Vela's UI entry keeps the earlier names working for one release.
import { describe, expect, it, vi } from 'vitest';
import {
    BADGE_CSS,
    BUTTON_CSS,
    BUTTON_STYLE_ID,
    Badge,
    Button,
    TABS_CSS,
    TOGGLE_GROUP_CSS,
    Tabs,
    ToggleGroup,
    badgeController,
    buttonController,
    tabAvailable,
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

const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('the classes the button, badge, tabs and toggle group had in 0.9', () => {
    it('build a button and a badge that behave as before', () => {
        const onClick = vi.fn();
        const button = new Button({ text: 'Save', variant: 'secondary', size: 'sm', onClick });
        expect(button.el.classList.contains('vela-btn')).toBe(true);
        expect(button.el.dataset.variant).toBe('secondary');
        button.el.click();
        expect(onClick).toHaveBeenCalledTimes(1);
        button.setText('Saved');
        expect(button.el.textContent).toBe('Saved');
        expect(button.pressed).toBeUndefined();
        button.setPressed(true);
        expect(button.el.getAttribute('aria-pressed')).toBe('true');
        button.setDisabled(true);
        expect(button.el.disabled).toBe(true);

        const badge = new Badge({ text: '3', count: true });
        expect(badge.el.classList.contains('vela-badge')).toBe(true);
        badge.setText('4');
        badge.setVariant('up');
        expect(badge.el.textContent).toBe('4');
        expect(badge.el.dataset.variant).toBe('up');
    });

    it('keep the headless button and badge controllers', () => {
        const ctrl = buttonController({ size: 'icon', label: 'Close' });
        expect(ctrl.iconOnly).toBe(true);
        ctrl.setPressed(false);
        expect(ctrl.rootProps()).toMatchObject({ type: 'button', 'data-slot': 'button', 'data-size': 'icon', 'aria-pressed': 'false', 'aria-label': 'Close', disabled: false });
        const badge = badgeController({ count: true });
        badge.setVariant('down');
        expect(badge.rootProps()).toEqual({ 'data-slot': 'badge', 'data-variant': 'down', 'data-count': true });
    });

    it('take tabs keyed by id, report a pick by id, and link panels', async () => {
        const onChange = vi.fn();
        const tabs = new Tabs({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], value: 'b', onChange });
        document.body.append(tabs.el);
        expect(tabs.value).toBe('b');
        tabs.tab('c')!.click();
        await settle();
        expect(onChange).toHaveBeenCalledWith('c');
        tabs.setValue('a');
        await settle();
        expect(tabs.value).toBe('a');
        expect(onChange).toHaveBeenCalledTimes(1);
        const panel = document.createElement('div');
        tabs.attachPanel('b', panel);
        expect(panel.getAttribute('role')).toBe('tabpanel');
        expect(panel.hidden).toBe(true);
        tabs.setItems([{ id: 'x', label: 'X' }, { value: 'y', label: 'Y' }]);
        expect(tabs.tab('x')).not.toBeNull();
        expect(tabs.tab('y')).not.toBeNull();
        const hiddenTab = { id: 'x', label: 'X', hidden: true };
        expect(tabAvailable(hiddenTab)).toBe(false);
        tabs.destroy();
        tabs.el.remove();
    });

    it('take toggle options keyed by id, single and multiple', async () => {
        const onChange = vi.fn();
        const single = new ToggleGroup({ items: [{ id: 'l', label: 'Left' }, { id: 'r', label: 'Right' }], value: 'r', onChange });
        document.body.append(single.el);
        expect(single.values).toEqual(['r']);
        single.setValue('l');
        await settle();
        expect(single.values).toEqual(['l']);
        expect(onChange).not.toHaveBeenCalled();
        const multiple = new ToggleGroup({ type: 'multiple', items: [{ id: 'b', label: 'Bold' }, { id: 'i', label: 'Italic' }], value: ['b', 'i'] });
        expect(multiple.values).toEqual(['b', 'i']);
        single.destroy();
        multiple.destroy();
        single.el.remove();
    });

    it('keep their stylesheets, now the kit components', () => {
        expect(BUTTON_STYLE_ID).toBe('vela-ui-button');
        for (const sheet of [BUTTON_CSS, BADGE_CSS, TABS_CSS, TOGGLE_GROUP_CSS]) expect(sheet).toContain('@layer vela.ui');
    });
});
