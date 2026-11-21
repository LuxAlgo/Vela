// Where a floating part opens, in shadcn's words: the side, the alignment along it, the two
// offsets and the collision handling, for the popover family (placePopover) and for the parts
// Zag positions (zagPositioning).
import { describe, expect, it } from 'vitest';
import { placePopover, viewportRect } from '@luxalgo/vela-ui/popover';
import { splitPlacement, zagPositioning } from '../packages/vela-ui/src/lib/placement';

// A 100×34 trigger in the middle of an 800×600 viewport (6px of air kept at its edges).
const trigger = { left: 300, top: 280, right: 400, bottom: 314, width: 100, height: 34 };
const pop = { width: 80, height: 40 };
const clamp = viewportRect(800, 600, 6);
const place = (extra: Partial<Parameters<typeof placePopover>[0]>) => placePopover({ trigger, pop, gap: 4, align: 'start', clamp, originX: 0, originY: 0, ...extra });

describe('placePopover on each side', () => {
    it('opens on the side it is given', () => {
        expect(place({ side: 'bottom' })).toEqual({ left: 300, top: 318, side: 'bottom' });
        expect(place({ side: 'top' })).toEqual({ left: 300, top: 236, side: 'top' });
        expect(place({ side: 'right' })).toEqual({ left: 404, top: 280, side: 'right' });
        expect(place({ side: 'left' })).toEqual({ left: 216, top: 280, side: 'left' });
    });

    it('aligns along the side, and shifts by alignOffset away from the aligned edge', () => {
        expect(place({ side: 'right', align: 'center' })).toMatchObject({ top: 277 }); // 280 + 17 − 20
        expect(place({ side: 'right', align: 'end' })).toMatchObject({ top: 274 }); // 314 − 40
        expect(place({ side: 'bottom', align: 'start', alignOffset: 10 })).toMatchObject({ left: 310 });
        expect(place({ side: 'bottom', align: 'end', alignOffset: 10 })).toMatchObject({ left: 310 }); // 400 − 80 − 10
        expect(place({ side: 'bottom', align: 'center', alignOffset: 10 })).toMatchObject({ left: 320 });
    });

    it('keeps its distance from the trigger (sideOffset)', () => {
        expect(place({ side: 'left', gap: 12 })).toMatchObject({ left: 208 });
    });

    it('flips to the opposite side when its own lacks room', () => {
        const nearTop = { ...trigger, top: 10, bottom: 44 };
        expect(placePopover({ trigger: nearTop, pop, gap: 4, align: 'start', side: 'top', clamp, originX: 0, originY: 0 })).toMatchObject({ side: 'bottom', top: 48 });
        const nearRight = { ...trigger, left: 700, right: 790 };
        expect(placePopover({ trigger: nearRight, pop, gap: 4, align: 'start', side: 'right', clamp, originX: 0, originY: 0 })).toMatchObject({ side: 'left', left: 616 });
    });

    it('keeps its side and skips the clamp when avoidCollisions is off', () => {
        const nearTop = { ...trigger, top: 10, bottom: 44 };
        expect(placePopover({ trigger: nearTop, pop, gap: 4, align: 'start', side: 'top', avoidCollisions: false, clamp, originX: 0, originY: 0 })).toEqual({ left: 300, top: -34, side: 'top' });
    });
});

describe('zagPositioning', () => {
    it('keeps the part default when nothing is set', () => {
        expect(zagPositioning({}, { side: 'bottom', align: 'start' })).toEqual({ placement: 'bottom-start' });
        expect(zagPositioning({}, { side: 'top', align: 'center' })).toEqual({ placement: 'top' });
    });

    it('maps the shadcn props onto Zag', () => {
        const el = { nodeType: 1 } as unknown as HTMLElement;
        const p = zagPositioning({ side: 'right', align: 'end', sideOffset: 8, alignOffset: 4, avoidCollisions: false, collisionPadding: 10, collisionBoundary: el }, { side: 'bottom', align: 'start' });
        expect(p).toMatchObject({ placement: 'right-end', gutter: 8, shift: -4, flip: false, slide: false, overflowPadding: 10 });
        expect(p.boundary?.()).toBe(el);
    });

    it('reads a Zag placement as a side and an alignment', () => {
        expect(splitPlacement('bottom-start')).toEqual({ side: 'bottom', align: 'start' });
        expect(splitPlacement('left')).toEqual({ side: 'left', align: 'center' });
    });
});
