import { describe, it, expect, vi, afterEach } from 'vitest';
import { classifyGesture, dragDismisses, swipeDirection } from '../src/ui/components/drawer/view';
import { attachChromeTooltip } from '../src/renderers/shared/chrome-tooltip';
import type { VelaTheme } from '../src/core/options';

// ── the drawer's gesture classifier (swipe-down-to-close from anywhere, swipe-to-tab) ──

const rest = { canSwipe: true, scrolled: false, hScrollable: false };

describe('drawer gesture classification', () => {
    it('stays pending inside the slop', () => {
        expect(classifyGesture(3, 5, rest)).toBe('pending');
        expect(classifyGesture(-7, 0, rest)).toBe('pending');
    });

    it('a decidedly vertical downward pull on an at-rest sheet is the dismiss drag', () => {
        expect(classifyGesture(2, 30, rest)).toBe('drag');
    });

    it('a downward pull over a scrolled list keeps native scrolling', () => {
        expect(classifyGesture(2, 30, { ...rest, scrolled: true })).toBe('scroll');
    });

    it('an upward move is always native scrolling', () => {
        expect(classifyGesture(2, -30, rest)).toBe('scroll');
    });

    it('a decidedly horizontal move is a swipe — for sheets that handle one', () => {
        expect(classifyGesture(40, 5, rest)).toBe('hswipe');
        expect(classifyGesture(-40, 5, { ...rest, canSwipe: false })).toBe('scroll');
    });

    it('a horizontal move on a sideways-scrolling strip stays that strip’s scroll', () => {
        expect(classifyGesture(40, 5, { ...rest, hScrollable: true })).toBe('scroll');
    });
});

describe('drawer drag release', () => {
    it('dismisses past min(96px, a third of the sheet)', () => {
        expect(dragDismisses(96, 600)).toBe(true);
        expect(dragDismisses(95, 600)).toBe(false);
        // Short sheet: the fractional bound is the smaller one.
        expect(dragDismisses(40, 120)).toBe(true);
        expect(dragDismisses(39, 120)).toBe(false);
    });
});

describe('drawer swipe release', () => {
    it('fires only past the travel floor, in the finger’s direction', () => {
        expect(swipeDirection(-60, 5)).toBe('left');
        expect(swipeDirection(60, 5)).toBe('right');
        expect(swipeDirection(-40, 5)).toBeNull(); // too short
    });

    it('a release that ended more vertical than horizontal is not a swipe', () => {
        expect(swipeDirection(-60, 70)).toBeNull();
    });
});

// ── chrome tooltip: mouse-only arming (a tap must never leave a stuck tip) ──

/** Bare-bones event-target stand-in (same shape as the InputController test double). */
function fakeAnchor() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    return {
        types: () => [...listeners.keys()],
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
        },
        removeEventListener(type: string, fn: (e: unknown) => void) {
            listeners.get(type)?.delete(fn);
        },
        fire(type: string, e: Record<string, unknown>) {
            for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
        },
    };
}

describe('chrome tooltip arming', () => {
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window;
    });

    it('arms on a mouse pointerenter only — touch taps never open (or strand) a tip', () => {
        const setTimeoutSpy = vi.fn(() => 1);
        (globalThis as { window?: unknown }).window = { setTimeout: setTimeoutSpy };
        const anchor = fakeAnchor();
        const dispose = attachChromeTooltip(anchor as unknown as HTMLElement, {
            host: {} as HTMLElement,
            theme: () => ({}) as VelaTheme,
            text: () => 'Hide indicator legend',
        });

        // The stuck-tip bug came from mouseenter, which mobile browsers synthesize after
        // a tap with no mouseleave to follow — the tip must not listen to it at all.
        expect(anchor.types()).toContain('pointerenter');
        expect(anchor.types()).not.toContain('mouseenter');

        anchor.fire('pointerenter', { pointerType: 'touch' });
        expect(setTimeoutSpy).not.toHaveBeenCalled();

        anchor.fire('pointerenter', { pointerType: 'mouse' });
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        dispose();
    });
});
