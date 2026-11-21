// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import type { VelaTheme } from '../src/core/options';
import { splitColor, combineColor, buildColorPicker } from '@luxalgo/vela-ui/color-picker';

const theme = { textColor: '#fff', fontFamily: 'sans-serif' } as unknown as VelaTheme;
// The slider machine reports a beat after the event.
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => document.body.replaceChildren());

describe('color picker custom "+" input', () => {
    function mount(): { root: HTMLElement; input: HTMLInputElement; recentSwatches: HTMLElement; picked: string[] } {
        const picked: string[] = [];
        const root = buildColorPicker('#089981', theme, (v) => picked.push(v));
        document.body.append(root);
        // root → [grid, recentRow, …]; recentRow → [swatches wrapper, "+" label → [input]].
        const recentRow = root.children[1] as HTMLElement;
        const recentSwatches = recentRow.children[0] as HTMLElement;
        const input = recentRow.children[1]!.children[0] as HTMLInputElement;
        expect(input.type).toBe('color');
        return { root, input, recentSwatches, picked };
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
        expect(recentSwatches.children[0]!.getAttribute('aria-label')).toBe('#cc2222');
    });

    it('syncs the native input to a swatch pick so the chooser opens on the current color', () => {
        const { input, recentSwatches } = mount();
        // Second recent: not the color the picker was opened with.
        const swatch = recentSwatches.children[1] as HTMLElement;
        const expected = swatch.getAttribute('aria-label')!;
        expect(input.value).not.toBe(expected);
        swatch.click();
        expect(input.value).toBe(expected);
    });

    it('names every swatch by its color and marks the current one pressed', () => {
        const { root } = mount();
        const swatches = [...root.children[0]!.children] as HTMLElement[];
        expect(swatches.every((s) => /^#[0-9a-f]{6}$/i.test(s.getAttribute('aria-label') ?? ''))).toBe(true);
        const [a, b] = [swatches[3]!, swatches[17]!];
        a.click();
        expect(swatches.filter((s) => s.getAttribute('aria-pressed') === 'true')).toEqual([a]);
        b.click();
        expect(swatches.filter((s) => s.getAttribute('aria-pressed') === 'true')).toEqual([b]);
    });
});

describe('color picker opacity slider', () => {
    function mount(commit?: 'live' | 'release'): { track: HTMLElement; knob: HTMLElement; pct: HTMLInputElement; emitted: string[] } {
        const emitted: string[] = [];
        const root = buildColorPicker('#089981', theme, (v) => emitted.push(v), commit ? { commit } : {});
        document.body.append(root);
        // root → [grid, recentRow, opacity label, opacity row]; opacity row → [track, "%" box].
        const opRow = root.children[3] as HTMLElement;
        const track = opRow.children[0] as HTMLElement;
        track.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 13, right: 300, bottom: 13, x: 100, y: 0, toJSON: () => ({}) });
        return { track, knob: track.children[0] as HTMLElement, pct: opRow.children[1] as HTMLInputElement, emitted };
    }
    const down = (track: HTMLElement, clientX: number): boolean => track.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', clientX, clientY: 6 }));
    // A mouse move with no button held reads as a release.
    const move = (clientX: number): boolean => document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', buttons: 1, clientX, clientY: 6 }));
    const up = (type: 'pointerup' | 'pointercancel', clientX: number): boolean => document.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse', clientX, clientY: 6 }));

    it("defaults to 'live': every move commits, so a cheap consumer previews the drag on the chart", async () => {
        const { track, pct, emitted } = mount();
        down(track, 120); // 10 %
        await settle();
        move(200); // 50 %
        await settle();
        move(260); // 80 %
        await settle();
        expect(pct.value).toBe('80%');
        expect(emitted).toEqual([combineColor('#089981', 0.1), combineColor('#089981', 0.5), combineColor('#089981', 0.8)]);
        // Release adds nothing: the last move already committed.
        up('pointerup', 260);
        await settle();
        expect(emitted).toHaveLength(3);
    });

    it("'release': previews the opacity while dragging and commits ONCE on release", async () => {
        const { track, pct, emitted } = mount('release');
        down(track, 120); // 10 %
        await settle();
        move(160); // 30 %
        await settle();
        move(200); // 50 %
        await settle();
        move(260); // 80 %
        await settle();
        // The readout previews the drag; nothing is committed yet.
        expect(pct.value).toBe('80%');
        expect(emitted).toEqual([]);
        up('pointerup', 260);
        await settle();
        expect(emitted).toEqual([combineColor('#089981', 0.8)]);
        // A stray move after release changes nothing.
        move(300);
        await settle();
        expect(pct.value).toBe('80%');
        expect(emitted).toHaveLength(1);
    });

    it('a plain click on the track commits once at the clicked opacity, under either policy', async () => {
        for (const commit of ['live', 'release'] as const) {
            const { track, emitted } = mount(commit);
            down(track, 150); // 25 %
            await settle();
            up('pointerup', 150);
            await settle();
            expect(emitted).toEqual([combineColor('#089981', 0.25)]);
        }
    });

    it('the knob is a labelled slider the keyboard steps, one commit per key under either policy', async () => {
        for (const commit of ['live', 'release'] as const) {
            const { knob, emitted } = mount(commit);
            expect(knob.getAttribute('role')).toBe('slider');
            expect(knob.getAttribute('aria-label')).toBe('Opacity');
            expect(knob.getAttribute('aria-valuetext')).toBe('100%');
            knob.focus();
            await settle();
            knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
            await settle();
            expect(emitted).toEqual([combineColor('#089981', 0.99)]);
            expect(knob.getAttribute('aria-valuetext')).toBe('99%');
        }
    });

    it('the percentage readout is a text input that sets the opacity when a value is typed', async () => {
        for (const commit of ['live', 'release'] as const) {
            const { knob, pct, emitted } = mount(commit);
            expect(pct.tagName).toBe('INPUT');
            expect(pct.value).toBe('100%');
            pct.value = '35';
            pct.dispatchEvent(new Event('change'));
            expect(emitted).toEqual([combineColor('#089981', 0.35)]);
            expect(pct.value).toBe('35%');
            await settle();
            // The slider follows the typed value without committing it again.
            expect(knob.getAttribute('aria-valuetext')).toBe('35%');
            expect(emitted).toHaveLength(1);
            // "%" suffix accepted; out-of-range values clamp.
            pct.value = '250%';
            pct.dispatchEvent(new Event('change'));
            expect(emitted).toHaveLength(2);
            expect(emitted[1]).toBe('#089981');
            expect(pct.value).toBe('100%');
        }
    });

    it('typed garbage or an unchanged value restores the readout without committing', () => {
        const { pct, emitted } = mount();
        pct.value = 'abc';
        pct.dispatchEvent(new Event('change'));
        expect(pct.value).toBe('100%');
        pct.value = '100';
        pct.dispatchEvent(new Event('change'));
        expect(emitted).toEqual([]);
    });

    it('Enter commits the typed value and keeps the keystroke away from outer shortcuts', () => {
        const { pct, emitted } = mount();
        let outer = 0;
        document.body.addEventListener('keydown', () => outer++);
        pct.focus();
        pct.value = '20';
        pct.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(emitted).toEqual([combineColor('#089981', 0.2)]);
        expect(outer).toBe(0);
        expect(document.activeElement).not.toBe(pct);
    });

    it("'release': a cancelled drag still commits where the pointer was", async () => {
        const { track, emitted } = mount('release');
        down(track, 120);
        await settle();
        move(200); // 50 %
        await settle();
        up('pointercancel', 200);
        await settle();
        expect(emitted).toEqual([combineColor('#089981', 0.5)]);
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
