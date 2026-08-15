import { describe, expect, it } from 'vitest';
import { clampNumber, numberInputController } from '../src/ui/components/number-input/controller';
import { placePopover, viewportRect, insetRect, intersectRects } from '../src/ui/components/popover/controller';
import { switchController } from '../src/ui/components/switch/controller';
import { selectController } from '../src/ui/components/select/controller';
import { textFieldController } from '../src/ui/components/text-field/controller';

describe('clampNumber', () => {
    it('clamps to min and max', () => {
        expect(clampNumber(3, { min: 5, max: 10 })).toBe(5);
        expect(clampNumber(12, { min: 5, max: 10 })).toBe(10);
        expect(clampNumber(7, { min: 5, max: 10 })).toBe(7);
    });

    it('rounds when integer', () => {
        expect(clampNumber(1.4, { integer: true })).toBe(1);
        expect(clampNumber(1.6, { integer: true })).toBe(2);
    });
});

describe('placePopover', () => {
    const trigger = { left: 100, top: 100, right: 200, bottom: 134, width: 100, height: 34 };

    it('opens below, left-aligned', () => {
        const pos = placePopover({
            trigger,
            pop: { width: 80, height: 40 },
            gap: 4,
            align: 'start',
            clamp: viewportRect(800, 600, 6),
            originX: 0,
            originY: 0,
        });
        expect(pos).toEqual({ left: 100, top: 138 });
    });

    it('right-aligns when align is end', () => {
        const pos = placePopover({
            trigger,
            pop: { width: 80, height: 40 },
            gap: 6,
            align: 'end',
            clamp: viewportRect(800, 600, 6),
            originX: 0,
            originY: 0,
        });
        expect(pos.left).toBe(120); // 200 - 80
        expect(pos.top).toBe(140);
    });

    it('flips above when it would leave the clamp', () => {
        const pos = placePopover({
            trigger: { left: 100, top: 500, right: 200, bottom: 534, width: 100, height: 34 },
            pop: { width: 80, height: 80 },
            gap: 4,
            align: 'start',
            clamp: viewportRect(800, 560, 6),
            originX: 0,
            originY: 0,
        });
        expect(pos.top).toBe(500 - 80 - 4);
    });

    it('subtracts origin for host-relative placement', () => {
        const pos = placePopover({
            trigger,
            pop: { width: 80, height: 40 },
            gap: 4,
            align: 'start',
            clamp: viewportRect(800, 600, 0),
            originX: 40,
            originY: 20,
        });
        expect(pos).toEqual({ left: 60, top: 118 });
    });
});

describe('rect helpers', () => {
    it('insets and intersects', () => {
        const r = viewportRect(100, 100, 0);
        expect(insetRect(r, 8).left).toBe(8);
        const a = { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 };
        const b = { left: 25, top: 25, right: 80, bottom: 80, width: 55, height: 55 };
        expect(intersectRects(a, b)).toEqual({ left: 25, top: 25, right: 50, bottom: 50, width: 25, height: 25 });
    });
});

describe('switchController', () => {
    it('toggle emits; setChecked does not (vela-sync)', () => {
        const seen: boolean[] = [];
        const c = switchController({ checked: false, onChange: (v) => seen.push(v) });
        c.setChecked(true);
        expect(c.checked).toBe(true);
        expect(seen).toEqual([]);
        expect(c.toggle()).toBe(false);
        expect(seen).toEqual([false]);
    });

    it('does not toggle when disabled', () => {
        const c = switchController({ checked: false, disabled: true, onChange: () => { throw new Error('emitted'); } });
        expect(c.toggle()).toBe(false);
    });
});

describe('selectController', () => {
    const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];

    it('pick emits; setValue does not', () => {
        const seen: string[] = [];
        const c = selectController({ options, value: 'a', onChange: (v) => seen.push(v) });
        c.setValue('b');
        expect(c.value).toBe('b');
        expect(seen).toEqual([]);
        expect(c.pick('a')).toEqual({ value: 'a', label: 'Alpha' });
        expect(seen).toEqual(['a']);
    });

    it('sm does not fill; md does', () => {
        expect(selectController({ options, size: 'sm' }).fill).toBe(false);
        expect(selectController({ options, size: 'md' }).fill).toBe(true);
    });
});

describe('numberInputController', () => {
    it('blur commit clamps; live commit does not unless clamp is forced', () => {
        const blur = numberInputController({ value: 5, min: 0, max: 10, commit: 'blur' });
        expect(blur.apply(99)).toBe(10);
        const live = numberInputController({ value: 5, min: 0, max: 10, commit: 'live' });
        expect(live.apply(99)).toBe(99);
        const forced = numberInputController({ value: 5, min: 0, max: 10, commit: 'live', clamp: true });
        expect(forced.apply(99)).toBe(10);
    });

    it('sync writes without emitting', () => {
        let n = 0;
        const c = numberInputController({ value: 5, min: 0, max: 10, onChange: () => { n += 1; } });
        expect(c.sync(8)).toBe(8);
        expect(c.value).toBe(8);
        expect(n).toBe(0);
    });
});

describe('textFieldController', () => {
    it('commit emits on change; sync does not', () => {
        const seen: string[] = [];
        const c = textFieldController({ value: 'a', onChange: (v) => seen.push(v) });
        expect(c.commit('a')).toBeNull();
        expect(c.commit('b')).toBe('b');
        expect(seen).toEqual(['b']);
        c.sync('c');
        expect(c.value).toBe('c');
        expect(seen).toEqual(['b']);
    });
});
