// @vitest-environment jsdom
// A drawer slides in from the edge `direction` names, and a pull toward that edge dismisses
// it; a side drawer's right is the inline end, so it mirrors in right-to-left layouts.
import { describe, expect, it } from 'vitest';
import { Drawer, classifyGesture, dismissAxis } from '@luxalgo/vela-ui/drawer';

const at = { canSwipe: true, scrolled: false, hScrollable: false };

describe('drawer directions', () => {
    it('measures a pull toward each edge', () => {
        expect(dismissAxis(0, 40, 'bottom').toward).toBe(40);
        expect(dismissAxis(0, -40, 'top').toward).toBe(40);
        expect(dismissAxis(40, 0, 'right').toward).toBe(40);
        expect(dismissAxis(-40, 0, 'left').toward).toBe(40);
        expect(dismissAxis(-40, 0, 'right', true).toward).toBe(40);
    });

    it('dismisses on a pull toward its edge, and leaves the other way to native scrolling', () => {
        expect(classifyGesture(0, -30, at, 'top')).toBe('drag');
        expect(classifyGesture(0, 30, at, 'top')).toBe('scroll');
        expect(classifyGesture(30, 2, at, 'right')).toBe('drag');
        expect(classifyGesture(-30, 2, at, 'right')).toBe('scroll');
        expect(classifyGesture(-30, 2, at, 'left')).toBe('drag');
        expect(classifyGesture(-30, 2, at, 'right', true)).toBe('drag');
    });

    it('keeps the tab swipe for top and bottom sheets only', () => {
        expect(classifyGesture(30, 2, at, 'top')).toBe('hswipe');
        expect(classifyGesture(2, 30, at, 'right')).toBe('scroll');
    });

    it('stamps its direction for the styles, and leaves a bottom sheet as it was', () => {
        const right = new Drawer({ direction: 'right', title: 'Side' });
        const panel = document.querySelector<HTMLElement>('[data-slot~="drawer-content"][data-direction="right"]');
        expect(panel).not.toBeNull();
        expect(document.querySelector('[data-slot~="drawer-positioner"][data-direction="right"]')).not.toBeNull();
        const bottom = new Drawer({ title: 'Sheet' });
        expect(document.querySelectorAll('[data-slot~="drawer-content"]:not([data-direction])').length).toBe(1);
        right.destroy();
        bottom.destroy();
    });
});
