// KeymapManager (src/ui/keymap.ts) — chord parsing/matching, platform normalization,
// scope stacking, input guards, rebinding, and the help-panel snapshot. Events are plain
// objects (the matcher only reads key/modifiers/target), so this runs in the node env.
import { describe, it, expect, vi } from 'vitest';
import { KeymapManager } from '../src/ui/keymap';

interface EvInit {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    target?: unknown;
}

function ev(init: EvInit): KeyboardEvent {
    return {
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...init,
    } as unknown as KeyboardEvent;
}

describe('KeymapManager', () => {
    it('matches chords with order-insensitive modifiers and key aliases', () => {
        const km = new KeymapManager({ platform: 'other' });
        const run = vi.fn();
        km.register({ id: 't', keys: 'shift+ctrl+k', label: 'T', run });
        expect(km.handleKeydown(ev({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe(true);
        expect(km.handleKeydown(ev({ key: 'k', ctrlKey: true }))).toBe(false); // shift required
        km.register({ id: 'esc', keys: 'esc', label: 'E', run });
        expect(km.handleKeydown(ev({ key: 'Escape' }))).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });

    it("'mod' resolves to meta on mac and ctrl elsewhere", () => {
        const run = vi.fn();
        const mac = new KeymapManager({ platform: 'mac' });
        mac.register({ id: 'z', keys: 'mod+z', label: 'Undo', run });
        expect(mac.handleKeydown(ev({ key: 'z', metaKey: true }))).toBe(true);
        expect(mac.handleKeydown(ev({ key: 'z', ctrlKey: true }))).toBe(false);

        const win = new KeymapManager({ platform: 'other' });
        win.register({ id: 'z', keys: 'mod+z', label: 'Undo', run });
        expect(win.handleKeydown(ev({ key: 'z', ctrlKey: true }))).toBe(true);
        expect(win.handleKeydown(ev({ key: 'z', metaKey: true }))).toBe(false);
    });

    it('shift is tolerated for printable punctuation keys (e.g. "?" chords)', () => {
        const km = new KeymapManager({ platform: 'other' });
        const run = vi.fn();
        km.register({ id: 'help', keys: '?', label: 'Help', run });
        // A US layout produces '?' WITH shift held; the chord must still match.
        expect(km.handleKeydown(ev({ key: '?', shiftKey: true }))).toBe(true);
    });

    it('scope stack: top scope mutes lower scopes; global always fires; pop restores', () => {
        const km = new KeymapManager({ platform: 'other' });
        const chart = vi.fn();
        const dlg = vi.fn();
        const glob = vi.fn();
        km.register({ id: 'c', keys: 'x', label: 'C', run: chart }); // default scope 'chart'
        km.register({ id: 'd', keys: 'x', label: 'D', scope: 'dialog', run: dlg });
        km.register({ id: 'g', keys: 'g', label: 'G', scope: 'global', run: glob });

        km.handleKeydown(ev({ key: 'x' }));
        expect(chart).toHaveBeenCalledTimes(1);
        expect(dlg).not.toHaveBeenCalled();

        const pop = km.pushScope('dialog');
        km.handleKeydown(ev({ key: 'x' }));
        km.handleKeydown(ev({ key: 'g' }));
        expect(chart).toHaveBeenCalledTimes(1); // muted under 'dialog'
        expect(dlg).toHaveBeenCalledTimes(1);
        expect(glob).toHaveBeenCalledTimes(1);

        pop();
        km.handleKeydown(ev({ key: 'x' }));
        expect(chart).toHaveBeenCalledTimes(2);
    });

    it('skips editable targets unless allowInInput', () => {
        const km = new KeymapManager({ platform: 'other' });
        const run = vi.fn();
        const runInput = vi.fn();
        km.register({ id: 'a', keys: 'a', label: 'A', run });
        km.register({ id: 'b', keys: 'b', label: 'B', allowInInput: true, run: runInput });
        const input = { tagName: 'INPUT' };
        expect(km.handleKeydown(ev({ key: 'a', target: input }))).toBe(false);
        expect(km.handleKeydown(ev({ key: 'b', target: input }))).toBe(true);
    });

    it('rebind overrides descriptor keys and bindings() reflects it with display strings', () => {
        const km = new KeymapManager({ platform: 'other' });
        const run = vi.fn();
        km.register({ id: 'save', keys: 'mod+s', label: 'Save layout', category: 'Chart', run });
        km.rebind('save', 'mod+shift+s');
        expect(km.handleKeydown(ev({ key: 's', ctrlKey: true }))).toBe(false);
        expect(km.handleKeydown(ev({ key: 's', ctrlKey: true, shiftKey: true }))).toBe(true);

        const b = km.bindings().find((x) => x.id === 'save')!;
        expect(b.keys).toEqual(['mod+shift+s']);
        expect(b.display).toEqual(['Ctrl+Shift+S']);
        expect(b.category).toBe('Chart');

        km.rebind('save', null); // reset to descriptor default
        expect(km.handleKeydown(ev({ key: 's', ctrlKey: true }))).toBe(true);
    });

    it('mac display uses glyphs', () => {
        const km = new KeymapManager({ platform: 'mac' });
        km.register({ id: 'k', keys: 'mod+shift+k', label: 'K', run: vi.fn() });
        expect(km.bindings()[0]!.display[0]).toBe('⇧⌘K');
    });

    it('preventDefault defaults on and can be opted out; when() gates', () => {
        const km = new KeymapManager({ platform: 'other' });
        let enabled = false;
        const run = vi.fn();
        km.register({ id: 'w', keys: 'w', label: 'W', when: () => enabled, run });
        const e1 = ev({ key: 'w' });
        expect(km.handleKeydown(e1)).toBe(false);
        enabled = true;
        expect(km.handleKeydown(e1)).toBe(true);
        expect(e1.preventDefault).toHaveBeenCalled();

        km.register({ id: 'p', keys: 'p', label: 'P', preventDefault: false, run });
        const e2 = ev({ key: 'p' });
        km.handleKeydown(e2);
        expect(e2.preventDefault).not.toHaveBeenCalled();
    });

    it('re-registering an id replaces it; the returned disposer only removes its own registration', () => {
        const km = new KeymapManager({ platform: 'other' });
        const first = vi.fn();
        const second = vi.fn();
        const dispose1 = km.register({ id: 'x', keys: 'x', label: '1', run: first });
        km.register({ id: 'x', keys: 'x', label: '2', run: second });
        dispose1(); // stale disposer — must NOT remove the second registration
        expect(km.handleKeydown(ev({ key: 'x' }))).toBe(true);
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });
});
