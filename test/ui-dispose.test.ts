// @vitest-environment jsdom
// Kit controls run state machines, and some machines register page-wide listeners that stay
// behind until the machine stops. Whoever discards a subtree releases every control in it,
// even without their handles: the settings dialogs build dozens of controls per open and keep
// none of them. Two copies of the kit on one page share what must be shared.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };

import { disposeWithin, ownTeardown } from '../packages/vela-ui/src/lib/dispose';
import { createCheckbox } from '../packages/vela-ui/src/components/checkbox';
import { createSwitch } from '../packages/vela-ui/src/components/switch';
import { createDialog } from '../packages/vela-ui/src/components/dialog';
import { createTooltip } from '../packages/vela-ui/src/components/tooltip';
import { buildFieldControl, fieldRow } from '../packages/vela-ui/src/components/field';
import { IndicatorInputsDialog } from '../src/renderers/shared/IndicatorInputsDialog';
import { DARK_THEME } from '../src/core/theme';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => document.body.replaceChildren());

/** Whether the control's machine still answers: a running one reflects a press in `data-state`. */
async function answers(root: Element): Promise<boolean> {
    const before = root.getAttribute('data-state');
    root.querySelector('input')!.click();
    await settle();
    return root.getAttribute('data-state') !== before;
}

describe('releasing kit controls', () => {
    it('a discarded subtree releases every control in it, handles kept or not', async () => {
        const box = document.createElement('div');
        document.body.append(box);
        box.append(createCheckbox({}).el, createSwitch({}).el);
        await settle();
        const [checkbox, sw] = [...box.children];
        expect(await answers(checkbox!)).toBe(true);

        disposeWithin(box);
        expect(await answers(checkbox!)).toBe(false);
        expect(await answers(sw!)).toBe(false);
    });

    it('a release runs once, whether destroy or the subtree comes first', () => {
        const el = document.createElement('div');
        const teardown = vi.fn();
        const release = ownTeardown(el, teardown);
        disposeWithin(el);
        release();
        disposeWithin(el);
        expect(teardown).toHaveBeenCalledTimes(1);

        const sw = createSwitch({});
        sw.destroy();
        expect(() => disposeWithin(sw.el)).not.toThrow();
    });

    it('a destroyed dialog releases the controls in its panel', async () => {
        const dialog = createDialog({ title: 'Settings' });
        const toggle = fieldRow({ label: 'Grid', bool: true, toggle: { checked: false, onChange: () => {} } });
        const field = buildFieldControl({ kind: 'switch', checked: false, onChange: () => {} });
        dialog.body.append(toggle, field.el);
        dialog.show();
        await settle();
        const roots = [toggle.querySelector('[data-scope="switch"]')!, field.el];
        expect(await answers(roots[0]!)).toBe(true);

        dialog.destroy();
        for (const root of roots) expect(await answers(root)).toBe(false);
    });

    it('a field control releases on its own destroy too', async () => {
        const field = buildFieldControl({ kind: 'switch', checked: false, onChange: () => {} });
        document.body.append(field.el);
        await settle();
        field.destroy();
        expect(await answers(field.el)).toBe(false);
    });

    it("discarding a tooltip's trigger takes the layer it mounted elsewhere", () => {
        const row = document.createElement('div');
        const trigger = document.createElement('button');
        row.append(trigger);
        document.body.append(row);
        createTooltip({ trigger, content: 'Hint' });
        expect(document.querySelectorAll('[data-slot="tooltip-positioner"]').length).toBe(1);

        disposeWithin(row);
        expect(document.querySelectorAll('[data-slot="tooltip-positioner"]').length).toBe(0);
    });

    it("closing an indicator's settings releases the controls it built", async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const dialog = new IndicatorInputsDialog({
            container: host,
            theme: () => DARK_THEME,
            mobile: () => false,
            dialogHost: () => host,
            symbolPicker: () => null,
            onChange: () => {},
            onBackdropClose: () => {},
        });
        dialog.open({ id: 'ind', title: 'Test', inputs: [{ key: 'show', title: 'Show', type: 'bool', defval: true }], values: { show: true }, props: [], propValues: {} });
        await settle();
        const control = host.querySelector('[data-scope="switch"]')!;
        expect(await answers(control)).toBe(true);

        dialog.close();
        expect(await answers(control)).toBe(false);
    });
});

describe('two copies of the kit on one page', () => {
    async function freshCopy() {
        vi.resetModules();
        const [icons, zag, dispose, checkbox] = await Promise.all([
            import('../packages/vela-ui/src/lib/icons'),
            import('../packages/vela-ui/src/lib/zag'),
            import('../packages/vela-ui/src/lib/dispose'),
            import('../packages/vela-ui/src/components/checkbox'),
        ]);
        return { icons, zag, dispose, checkbox };
    }

    it('an icon registered through one copy draws through the other', async () => {
        const a = await freshCopy();
        const b = await freshCopy();
        expect(a.icons).not.toBe(b.icons);
        a.icons.registerIcon('host-logo', '<svg data-host></svg>');
        expect(b.icons.iconMarkup('host-logo')).toBe('<svg data-host></svg>');
    });

    it('the copies never hand out the same element id', async () => {
        const a = await freshCopy();
        const b = await freshCopy();
        const ids = [a.zag.nextUid('vela-x'), b.zag.nextUid('vela-x'), a.zag.nextUid('vela-x')];
        expect(new Set(ids).size).toBe(3);
    });

    it("one copy releases the other's controls", async () => {
        const a = await freshCopy();
        const b = await freshCopy();
        const box = document.createElement('div');
        document.body.append(box);
        box.append(a.checkbox.createCheckbox({}).el);
        await settle();
        b.dispose.disposeWithin(box);
        expect(await answers(box.firstElementChild!)).toBe(false);
    });
});
