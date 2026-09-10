// The `marks` renderer feature's display state (src/renderers/shared/marks-state):
// the validated partial merge and the group-visibility precedence.
import { describe, it, expect } from 'vitest';
import { defaultMarksState, mergeMarksState, markGroupVisible } from '../src/renderers/shared/marks-state';

describe('marks · mergeMarksState', () => {
    it('a bare boolean toggles the lane and keeps the groups', () => {
        const base = { visible: true, groups: { a: false } };
        expect(mergeMarksState(base, false)).toEqual({ visible: false, groups: { a: false } });
        expect(mergeMarksState(base, true).groups).toEqual({ a: false });
    });

    it('an object patches `visible` and merges `groups` additively', () => {
        const base = { visible: true, groups: { a: false, b: true } };
        const out = mergeMarksState(base, { groups: { b: false, c: false } });
        expect(out).toEqual({ visible: true, groups: { a: false, b: false, c: false } });
        expect(mergeMarksState(base, { visible: false }).groups).toEqual(base.groups);
    });

    it('drops malformed values and never mutates the base', () => {
        const base = defaultMarksState();
        const out = mergeMarksState(base, { visible: 'no', groups: { a: 'off', b: 0, c: true } });
        expect(out).toEqual({ visible: true, groups: { c: true } });
        expect(base).toEqual({ visible: true, groups: {} });
        expect(mergeMarksState(base, null)).toEqual(base);
        expect(mergeMarksState(base, 'x')).toEqual(base);
    });
});

describe('marks · markGroupVisible', () => {
    const groups = [
        { id: 'shown', label: 'Shown' },
        { id: 'quiet', label: 'Quiet', visible: false },
    ];

    it('the stored choice wins, else the group’s declared default, else visible; ungrouped marks always show', () => {
        const state = { visible: true, groups: { shown: false, quiet: true } };
        expect(markGroupVisible(state, 'shown', groups)).toBe(false);
        expect(markGroupVisible(state, 'quiet', groups)).toBe(true);
        expect(markGroupVisible(defaultMarksState(), 'quiet', groups)).toBe(false);
        expect(markGroupVisible(defaultMarksState(), 'shown', groups)).toBe(true);
        expect(markGroupVisible(defaultMarksState(), 'unknown', groups)).toBe(true);
        expect(markGroupVisible({ visible: true, groups: { x: false } }, undefined, groups)).toBe(true);
    });
});
