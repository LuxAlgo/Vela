// @vitest-environment jsdom
// Every edit rebuilds the drawing instances (the store re-syncs the renderer), so a panel opened
// from the drawing toolbar must show — and on Cancel restore — the drawing as it is now, not as it
// was when the toolbar opened.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { createDrawing, deserializeDrawing, type Drawing, type FibRetracement } from '../src/core/drawings';
import { DARK_THEME } from '../src/core/theme';
import { DrawingSettingsPopup, type SettingsActions } from '../src/renderers/native/drawings/DrawingSettingsPopup';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
});

/** The dialog machine opens and closes on its own tick; wait for it. */
const settled = () => new Promise<void>((r) => setTimeout(r, 50));

/** A chart stand-in that, like the renderer, replaces the drawing with a fresh copy after every edit. */
function chart(initial: Drawing): { actions: SettingsActions; live: () => Drawing } {
    let live = initial;
    const sync = (): void => {
        live = deserializeDrawing(live.serialize())!;
    };
    const actions: SettingsActions = {
        resolve: () => live,
        patch: (p) => {
            live.applySettings(p);
            sync();
        },
        restore: (doc) => {
            if (doc.style) live.style = { ...doc.style };
            if (doc.text !== undefined) live.text = doc.text ? { ...doc.text } : undefined;
            if (doc.props !== undefined) live.applyProps(doc.props);
            sync();
        },
        setLocked: () => {},
        reorder: () => {},
        duplicate: () => {},
        resetSettings: () => {},
        remove: () => {},
    };
    return { actions, live: () => live };
}

function setup(drawing: Drawing) {
    const host = document.createElement('div');
    document.body.append(host);
    const popup = new DrawingSettingsPopup(host, DARK_THEME);
    const c = chart(drawing);
    popup.open([drawing], null, c.actions);
    const barButton = (tip: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`.vela-dpop [data-tip="${tip}"]`)!;
    const dialogButton = (label: string): HTMLButtonElement =>
        [...host.querySelectorAll<HTMLButtonElement>('.vela-dialog--form button')].find((b) => b.textContent === label)!;
    const ratioInputs = (): HTMLInputElement[] => [...host.querySelectorAll<HTMLInputElement>('.vela-dialog--form input[type="number"]')];
    return { host, popup, live: c.live, barButton, dialogButton, ratioInputs };
}

/** Type a value into a ratio field and leave it — the field commits on blur. */
function commit(input: HTMLInputElement, value: number): void {
    input.value = String(value);
    input.dispatchEvent(new Event('blur'));
}

const fib = (): Drawing =>
    createDrawing('fibretracement', { id: 'f', paneId: 'price', anchors: [{ time: 0, price: 100 }, { time: 10, price: 200 }] })!;
const ratios = (d: Drawing): number[] => (d as FibRetracement).levels.map((l) => l.ratio);

describe('drawing settings reopened from the same toolbar', () => {
    it('the levels dialog shows every ratio edited in an earlier session', async () => {
        const s = setup(fib());
        s.barButton('Levels').click();
        await settled();
        commit(s.ratioInputs()[1]!, 0.25);
        commit(s.ratioInputs()[2]!, 0.4);
        s.dialogButton('Ok').click();
        await settled();
        expect(ratios(s.live()).slice(0, 3)).toEqual([0, 0.25, 0.4]);

        s.barButton('Levels').click();
        await settled();
        expect(s.ratioInputs().slice(0, 3).map((i) => Number(i.value))).toEqual([0, 0.25, 0.4]);
        s.popup.destroy();
    });

    it('cancelling a reopened levels dialog keeps the edits made before it opened', async () => {
        const s = setup(fib());
        s.barButton('Levels').click();
        await settled();
        commit(s.ratioInputs()[1]!, 0.25);
        commit(s.ratioInputs()[2]!, 0.4);
        s.dialogButton('Ok').click();
        await settled();

        s.barButton('Levels').click();
        await settled();
        commit(s.ratioInputs()[3]!, 0.55);
        s.dialogButton('Cancel').click();
        await settled();
        expect(ratios(s.live()).slice(0, 4)).toEqual([0, 0.25, 0.4, 0.5]);
        s.popup.destroy();
    });

    it('the text panel shows the whole label typed before it was closed', () => {
        const line = createDrawing('trendline', { id: 't', paneId: 'price', anchors: [{ time: 0, price: 100 }, { time: 10, price: 200 }] })!;
        const s = setup(line);
        s.barButton('Text').click();
        const field = (): HTMLTextAreaElement => s.host.querySelector<HTMLTextAreaElement>('.vela-dpop textarea')!;
        for (const v of ['H', 'He', 'Hello']) {
            field().value = v;
            field().dispatchEvent(new Event('input'));
        }
        expect(s.live().text?.value).toBe('Hello');

        s.barButton('Text').click();
        s.barButton('Text').click();
        expect(field().value).toBe('Hello');
        s.popup.destroy();
    });
});
