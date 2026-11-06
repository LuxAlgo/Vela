// @vitest-environment jsdom
// The kit's Slider: a value on a track over Zag's slider machine. Every move reports through
// onValueChange; a settled move (a key, the pointer lifted) through onValueCommit; setValue
// moves it from code and reports nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlider } from '@luxalgo/vela-ui/slider';

const settle = () => new Promise((r) => setTimeout(r, 0));
const thumbOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-slot="slider-thumb"]')!;
/** A key on the thumb, focused first as a user's Tab would. */
const key = (el: HTMLElement, k: string) => {
    if (document.activeElement !== el) el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};

afterEach(() => document.body.replaceChildren());

describe('slider', () => {
    it('draws a track, its range and a thumb that is a named slider', async () => {
        const slider = createSlider({ defaultValue: 30, min: 0, max: 200, label: 'Replay position' });
        document.body.append(slider.el);
        await settle();
        expect(slider.el.getAttribute('data-slot')).toBe('slider');
        expect(slider.el.querySelector('[data-slot="slider-control"] [data-slot="slider-track"] [data-slot="slider-range"]')).not.toBeNull();
        const thumb = thumbOf(slider.el);
        expect(thumb.getAttribute('role')).toBe('slider');
        expect(thumb.getAttribute('aria-label')).toBe('Replay position');
        expect(thumb.getAttribute('aria-valuemin')).toBe('0');
        expect(thumb.getAttribute('aria-valuemax')).toBe('200');
        expect(thumb.getAttribute('aria-valuenow')).toBe('30');
        expect(slider.value).toBe(30);
    });

    it('moves with the keys, reporting the move and its commit', async () => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        const slider = createSlider({ defaultValue: 10, step: 5, onValueChange, onValueCommit });
        document.body.append(slider.el);
        await settle();
        key(thumbOf(slider.el), 'ArrowRight');
        await settle();
        expect(onValueChange).toHaveBeenLastCalledWith(15);
        expect(onValueCommit).toHaveBeenLastCalledWith(15);
        key(thumbOf(slider.el), 'End');
        await settle();
        expect(onValueChange).toHaveBeenLastCalledWith(100);
        expect(slider.value).toBe(100);
        expect(thumbOf(slider.el).getAttribute('aria-valuenow')).toBe('100');
    });

    it('moves from code without reporting, inside its bounds', async () => {
        const onValueChange = vi.fn();
        const onValueCommit = vi.fn();
        const slider = createSlider({ min: 0, max: 50, onValueChange, onValueCommit });
        document.body.append(slider.el);
        await settle();
        slider.setValue(20);
        await settle();
        expect(slider.value).toBe(20);
        expect(thumbOf(slider.el).getAttribute('aria-valuenow')).toBe('20');
        slider.setValue(80);
        await settle();
        expect(slider.value).toBe(50);
        expect(onValueChange).not.toHaveBeenCalled();
        expect(onValueCommit).not.toHaveBeenCalled();
        // The next move is the user's again.
        key(thumbOf(slider.el), 'ArrowLeft');
        await settle();
        expect(onValueChange).toHaveBeenCalledWith(49);
        expect(onValueCommit).toHaveBeenCalledWith(49);
    });

    it('says what a value means, and submits it under its name', async () => {
        const form = document.createElement('form');
        const slider = createSlider({ defaultValue: 35, name: 'opacity', valueText: (v) => `${v}%` });
        form.append(slider.el);
        document.body.append(form);
        await settle();
        expect(thumbOf(slider.el).getAttribute('aria-valuetext')).toBe('35%');
        expect(new FormData(form).get('opacity')).toBe('35');
    });

    it('ignores the keys while disabled', async () => {
        const onValueChange = vi.fn();
        const slider = createSlider({ defaultValue: 5, onValueChange });
        document.body.append(slider.el);
        await settle();
        slider.setDisabled(true);
        await settle();
        expect(slider.el.hasAttribute('data-disabled')).toBe(true);
        key(thumbOf(slider.el), 'ArrowRight');
        await settle();
        expect(onValueChange).not.toHaveBeenCalled();
        expect(slider.value).toBe(5);
    });

    it('stops its machine when it leaves the page', async () => {
        const slider = createSlider();
        document.body.append(slider.el);
        await settle();
        slider.destroy();
        expect(slider.dragging).toBe(false);
    });
});
