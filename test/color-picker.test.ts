import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VelaTheme } from '../src/core/options';
import { splitColor, combineColor, buildColorPicker } from '../src/ui/components/color-picker';

// A minimal element stub (this suite runs in the node env — no jsdom). It models just
// enough of the tree for `buildColorPicker`: parent links so `isConnected` can be
// answered, child mutation, and per-element listeners.
interface FakeEl {
    tag: string;
    type: string;
    value: string;
    textContent: string;
    style: { cssText: string } & Record<string, string>;
    dataset: Record<string, string>;
    children: FakeEl[];
    parentNode: FakeEl | null;
    attached: boolean;
    readonly isConnected: boolean;
    addEventListener: (t: string, fn: (e: unknown) => void) => void;
    dispatchEvent: (e: { type: string; stopPropagation?: () => void }) => boolean;
    appendChild: (c: FakeEl) => FakeEl;
    append: (...cs: FakeEl[]) => void;
    replaceChildren: (...cs: FakeEl[]) => void;
}

function fakeEl(tag: string): FakeEl {
    const listeners = new Map<string, Array<(e: unknown) => void>>();
    const el: FakeEl = {
        tag,
        type: '',
        value: '',
        textContent: '',
        style: { cssText: '' },
        dataset: {},
        children: [],
        parentNode: null,
        attached: false,
        get isConnected(): boolean {
            let n: FakeEl | null = el;
            while (n.parentNode) n = n.parentNode;
            return n.attached;
        },
        addEventListener: (t, fn) => { const a = listeners.get(t) ?? []; a.push(fn); listeners.set(t, a); },
        dispatchEvent: (e) => { for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
        appendChild: (c) => { c.parentNode?.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = el; el.children.push(c); return c; },
        append: (...cs) => { for (const c of cs) el.appendChild(c); },
        replaceChildren: (...cs) => { for (const c of el.children) c.parentNode = null; el.children = []; el.append(...cs); },
    };
    return el;
}

describe('color picker custom "+" input', () => {
    const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
    let savedDocument: unknown;

    beforeEach(() => {
        savedDocument = (globalThis as { document?: unknown }).document;
        (globalThis as { document: unknown }).document = { createElement: (tag: string) => fakeEl(tag) };
    });
    afterEach(() => {
        (globalThis as { document?: unknown }).document = savedDocument;
    });

    function mount(): { input: FakeEl; recentSwatches: FakeEl; picked: string[] } {
        const picked: string[] = [];
        const body = fakeEl('body');
        body.attached = true;
        const root = buildColorPicker('#089981', theme, (v) => picked.push(v)) as unknown as FakeEl;
        body.appendChild(root);
        // root → [grid, recentRow, …]; recentRow → [swatches wrapper, "+" label → [input]].
        const recentRow = root.children[1]!;
        const recentSwatches = recentRow.children[0]!;
        const input = recentRow.children[1]!.children[0]!;
        expect(input.type).toBe('color');
        return { input, recentSwatches, picked };
    }

    it('keeps the same native color input in the DOM while the chooser streams values', () => {
        const { input, recentSwatches, picked } = mount();
        const recentsBefore = recentSwatches.children.length;
        for (const v of ['#aa0000', '#bb1111', '#cc2222']) {
            input.value = v;
            input.dispatchEvent(new Event('input'));
            // The browser closes its chooser if the owning input is detached — it must stay put.
            expect(input.isConnected).toBe(true);
        }
        expect(picked).toEqual(['#aa0000', '#bb1111', '#cc2222']);
        expect(recentSwatches.children.length).toBe(recentsBefore);
    });

    it('adds the committed color to the recents only on change, keeping the input attached', () => {
        const { input, recentSwatches } = mount();
        const recentsBefore = recentSwatches.children.length;
        input.value = '#cc2222';
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
        expect(input.isConnected).toBe(true);
        expect(recentSwatches.children.length).toBe(recentsBefore + 1);
        expect(recentSwatches.children[0]!.style.cssText).toContain('background:#cc2222');
    });

    it('syncs the native input to a swatch pick so the chooser opens on the current color', () => {
        const { input, recentSwatches } = mount();
        // Second recent: not the color the picker was opened with.
        const swatch = recentSwatches.children[1]!;
        const expected = /background:(#[0-9a-f]{6})/.exec(swatch.style.cssText)![1]!;
        expect(input.value).not.toBe(expected);
        swatch.dispatchEvent({ type: 'click', stopPropagation: () => {} });
        expect(input.value).toBe(expected);
    });
});

describe('color picker color math', () => {
    it('splitColor parses #RRGGBB, #RRGGBBAA, #RGB and rgba()', () => {
        expect(splitColor('#38c0fd')).toEqual({ hex6: '#38c0fd', alpha: 1 });
        const a = splitColor('#38c0fd80');
        expect(a.hex6).toBe('#38c0fd');
        expect(a.alpha).toBeCloseTo(128 / 255, 3);
        expect(splitColor('#0af')).toEqual({ hex6: '#00aaff', alpha: 1 });
        const r = splitColor('rgba(56, 192, 253, 0.5)');
        expect(r.hex6).toBe('#38c0fd');
        expect(r.alpha).toBeCloseTo(0.5, 3);
    });

    it('combineColor → #RRGGBB when opaque, #RRGGBBAA otherwise', () => {
        expect(combineColor('#38c0fd', 1)).toBe('#38c0fd');
        expect(combineColor('#38c0fd', 0.5)).toBe('#38c0fd80'); // 0.5·255 = 128 = 0x80
        expect(combineColor('#38c0fd', 0.35)).toBe('#38c0fd59'); // 0.35·255 ≈ 89 = 0x59
        expect(combineColor('#38c0fd', 0)).toBe('#38c0fd00');
    });
});
