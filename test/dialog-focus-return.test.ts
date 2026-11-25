// @vitest-environment jsdom
// A dialog or drawer hands keyboard focus back to the control that opened it, whether it
// closes through the machine (Escape, the close button, hide()) or is torn down while open.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { Dialog } from '../src/ui/components/dialog/view';
import { Drawer } from '../src/ui/components/drawer/view';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

/** The machine opens and closes on its own tick; wait for it. */
const settled = () => new Promise<void>((r) => setTimeout(r, 50));

function opener(): HTMLButtonElement {
    const b = document.createElement('button');
    document.body.append(b);
    b.focus();
    expect(document.activeElement).toBe(b);
    return b;
}

/** Opens the view and moves focus into it, as a keyboard user tabbing to its first control does. */
async function openAndEnter(view: Dialog | Drawer): Promise<void> {
    view.show();
    await settled();
    const inner = document.createElement('button');
    view.body.append(inner);
    inner.focus();
    expect(document.activeElement).toBe(inner);
}

describe.each([
    ['dialog', () => new Dialog()],
    ['drawer', () => new Drawer()],
])('%s focus return', (_, make) => {
    it('closing through hide() focuses the opener again', async () => {
        const b = opener();
        const view = make();
        await openAndEnter(view);
        view.hide();
        await settled();
        expect(document.activeElement).toBe(b);
        view.destroy();
    });

    it('a teardown while open focuses the opener again', async () => {
        const b = opener();
        const view = make();
        await openAndEnter(view);
        view.destroy();
        expect(document.activeElement).toBe(b);
    });

    it('an opener that left the document is not focused', async () => {
        const b = opener();
        const view = make();
        await openAndEnter(view);
        b.remove();
        view.hide();
        await settled();
        expect(document.activeElement).not.toBe(b);
        view.destroy();
    });
});
