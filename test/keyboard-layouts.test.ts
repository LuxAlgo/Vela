// @vitest-environment jsdom
// Shortcuts and type-to-search work whatever keyboard layout and script the user types in:
// a layout of another script still reaches the Latin-letter shortcuts through the physical
// key, any letter opens symbol search, and an input method's keystrokes stay its own.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { KeymapManager } from '../src/ui/keymap';
import { createTranslator, registerLocale } from '../src/plugin';
import { VelaWorkspace, resolveTyping } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

const disposers: Array<() => void> = [];
afterEach(() => {
    while (disposers.length) disposers.pop()!();
    document.body.replaceChildren();
});

/** A keystroke as a layout reports it: the character typed (`key`) and the physical key (`code`). */
function press(key: string, code: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}): KeyboardEvent {
    return { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods } as unknown as KeyboardEvent;
}

describe('shortcuts on any keyboard layout', () => {
    it('Ctrl+Z still undoes on a Cyrillic keyboard layout', () => {
        const km = new KeymapManager({ platform: 'other' });
        const undo = vi.fn();
        km.register({ id: 'undo', keys: 'mod+z', label: 'Undo', run: undo });
        expect(km.handleKeydown(press('я', 'KeyZ', { ctrlKey: true }))).toBe(true);
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('letter shortcuts reach Greek, Hebrew and Arabic layouts too', () => {
        const km = new KeymapManager({ platform: 'other' });
        const arm = vi.fn();
        km.register({ id: 'trend', keys: 'alt+t', label: 'Trend line', run: arm });
        km.handleKeydown(press('τ', 'KeyT', { altKey: true }));
        km.handleKeydown(press('א', 'KeyT', { altKey: true }));
        km.handleKeydown(press('ف', 'KeyT', { altKey: true }));
        expect(arm).toHaveBeenCalledTimes(3);
    });

    it('a Latin layout keeps its own letters wherever they sit on the keyboard', () => {
        const km = new KeymapManager({ platform: 'other' });
        const undo = vi.fn();
        km.register({ id: 'undo', keys: 'mod+z', label: 'Undo', run: undo });
        // On AZERTY the Z sits where QWERTY has W, and the reverse.
        expect(km.handleKeydown(press('z', 'KeyW', { ctrlKey: true }))).toBe(true);
        expect(km.handleKeydown(press('w', 'KeyZ', { ctrlKey: true }))).toBe(false);
        expect(undo).toHaveBeenCalledTimes(1);
    });

    it("the shortcuts panel names the keys in the shell's language", () => {
        disposers.push(registerLocale({ locale: 'de', messages: { 'ui.keys.ctrl': 'Strg', 'ui.keys.shift': 'Umschalt', 'ui.keys.space': 'Leertaste' } }));
        const km = new KeymapManager({ platform: 'other' });
        km.register({ id: 'redo', keys: 'mod+shift+z', label: 'Redo', run: () => {} });
        km.register({ id: 'play', keys: 'space', label: 'Play', run: () => {} });
        expect(km.bindings().map((b) => b.display[0])).toEqual(['Ctrl+Shift+Z', 'Space']);
        expect(km.bindings(createTranslator({ locale: 'de' })).map((b) => b.display[0])).toEqual(['Strg+Umschalt+Z', 'Leertaste']);
    });
});

describe('typing on the chart', () => {
    const idle = { dialogs: 0, symbolSearch: false, timeframeEntry: false };

    it('a letter of any script opens symbol search with it', () => {
        expect(resolveTyping('ж', idle)).toEqual({ target: 'symbol', text: 'Ж' });
        expect(resolveTyping('ü', idle)).toEqual({ target: 'symbol', text: 'Ü' });
        expect(resolveTyping('あ', idle)).toEqual({ target: 'symbol', text: 'あ' });
        expect(resolveTyping('ب', idle)).toEqual({ target: 'symbol', text: 'ب' });
    });

    it('a key an input method is composing never opens symbol search', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false } as never);
        disposers.push(() => ws.destroy());
        const composing = new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true, cancelable: true });
        ws.root.dispatchEvent(composing);
        expect(composing.defaultPrevented).toBe(false);
        const process = new KeyboardEvent('keydown', { key: 'Process', bubbles: true, cancelable: true });
        ws.root.dispatchEvent(process);
        expect(process.defaultPrevented).toBe(false);
        const typed = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
        ws.root.dispatchEvent(typed);
        expect(typed.defaultPrevented).toBe(true);
    });
});

describe('the symbolMenuFromKey option', () => {
    const idle = { dialogs: 0, symbolSearch: false, timeframeEntry: false };
    /** What the shell hands its symbol search as typed text. */
    const searchTyped = (ws: VelaWorkspace) => vi.spyOn((ws as unknown as { symbolPicker: { type(text: string): void } }).symbolPicker, 'type');
    const type = (root: HTMLElement, key: string): KeyboardEvent => {
        const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        root.dispatchEvent(e);
        return e;
    };
    const workspace = (opts: Record<string, unknown>): VelaWorkspace => {
        const host = document.createElement('div');
        document.body.append(host);
        const ws = new VelaWorkspace(host, { layout: false, ...opts } as never);
        disposers.push(() => ws.destroy());
        return ws;
    };

    it('off, a letter or 0 opens nothing, while a digit still opens the timeframe entry', () => {
        const off = { ...idle, symbolMenuFromKey: false };
        expect(resolveTyping('n', off)).toBeNull();
        expect(resolveTyping('ж', off)).toBeNull();
        expect(resolveTyping('0', off)).toBeNull();
        expect(resolveTyping('5', off)).toEqual({ target: 'timeframe', text: '5' });
        // On, and left unset, are the same: a letter opens symbol search.
        expect(resolveTyping('n', { ...idle, symbolMenuFromKey: true })).toEqual({ target: 'symbol', text: 'N' });
        expect(resolveTyping('n', idle)).toEqual({ target: 'symbol', text: 'N' });
    });

    it('off, a symbol search opened another way still takes what is typed next', () => {
        const open = { dialogs: 1, symbolSearch: true, timeframeEntry: false, symbolMenuFromKey: false };
        expect(resolveTyping('q', open)).toEqual({ target: 'symbol', text: 'Q' });
    });

    it('a shell built with it off leaves a typed letter to the page and opens no symbol search', () => {
        const ws = workspace({ symbolMenuFromKey: false });
        const typed = searchTyped(ws);
        const letter = type(ws.root, 'n');
        expect(letter.defaultPrevented).toBe(false);
        expect(type(ws.root, '0').defaultPrevented).toBe(false);
        expect(typed).not.toHaveBeenCalled();
        // The timeframe entry is another route, and keeps its digit.
        expect(type(ws.root, '5').defaultPrevented).toBe(true);
        expect(typed).not.toHaveBeenCalled();
    });

    it('a shell built without it opens symbol search on a typed letter, as before', () => {
        const ws = workspace({});
        const typed = searchTyped(ws);
        expect(type(ws.root, 'n').defaultPrevented).toBe(true);
        expect(typed).toHaveBeenCalledWith('N');
    });
});
