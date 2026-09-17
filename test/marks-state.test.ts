// The `marks` renderer feature's display state (src/renderers/shared/marks-state):
// the validated partial merge and the group-visibility precedence.
import { describe, it, expect } from 'vitest';
import { defaultMarksState, markGroupOwnVisible, markGroupRows, markGroupVisible, mergeMarksState } from '../src/renderers/shared/marks-state';

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

describe('marks · nested groups', () => {
    const groups = [
        { id: 'news', label: 'News', visible: false },
        { id: 'news-latest', label: 'Latest', parent: 'news' },
        { id: 'news-all', label: 'All', parent: 'news', visible: false },
        { id: 'economic', label: 'Economic' },
        { id: 'economic-high', label: 'High', parent: 'economic' },
        { id: 'economic-low', label: 'Low', parent: 'economic', visible: false },
    ];

    it('a child paints only while its parent does — the parent is the master switch', () => {
        const off = { visible: true, groups: {} };
        expect(markGroupVisible(off, 'news-latest', groups)).toBe(false); // own default on, parent off
        expect(markGroupVisible(off, 'economic-high', groups)).toBe(true);
        expect(markGroupVisible(off, 'economic-low', groups)).toBe(false); // own default off
        const newsOn = { visible: true, groups: { news: true } };
        expect(markGroupVisible(newsOn, 'news-latest', groups)).toBe(true);
        expect(markGroupVisible(newsOn, 'news-all', groups)).toBe(false); // still its own choice
    });

    it('a child keeps its own choice while the parent is off, and it counts again when the parent returns', () => {
        const state = { visible: true, groups: { economic: false, 'economic-low': true } };
        expect(markGroupOwnVisible(state.groups, 'economic-low', groups)).toBe(true);
        expect(markGroupVisible(state, 'economic-low', groups)).toBe(false);
        expect(markGroupVisible({ ...state, groups: { ...state.groups, economic: true } }, 'economic-low', groups)).toBe(true);
    });

    it('the Events tab lists each parent followed by its children, indented one level', () => {
        expect(markGroupRows(groups).map((r) => `${'  '.repeat(r.depth)}${r.group.id}`)).toEqual([
            'news',
            '  news-latest',
            '  news-all',
            'economic',
            '  economic-high',
            '  economic-low',
        ]);
    });

    it('an unknown parent, a self-parent or a cycle can never make a group disappear from the tab', () => {
        const odd = [
            { id: 'a', label: 'A', parent: 'ghost' },
            { id: 'b', label: 'B', parent: 'b' },
            { id: 'c', label: 'C', parent: 'd' },
            { id: 'd', label: 'D', parent: 'c' },
        ];
        expect(markGroupRows(odd).map((r) => r.group.id).sort()).toEqual(['a', 'b', 'c', 'd']);
        expect(markGroupVisible({ visible: true, groups: {} }, 'a', odd)).toBe(true);
        expect(markGroupVisible({ visible: true, groups: {} }, 'c', odd)).toBe(true); // cycle stops, no hang
    });
});
