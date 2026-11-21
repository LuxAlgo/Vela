// @vitest-environment jsdom
// The kit's SortButton: a column header outside a table. A press steps the sort through its
// directions; the arrow and the words a screen reader hears follow it.
import { describe, expect, it, vi } from 'vitest';
import { createSortButton } from '@luxalgo/vela-ui/sort-button';

const state = (el: HTMLElement) => el.querySelector('[data-slot="sort-button-state"]')!.textContent;
const arrow = (el: HTMLElement) => el.querySelector('[data-slot="sort-button-icon"] svg')?.parentElement?.innerHTML ?? null;

describe('sort-button', () => {
    it('steps through the largest first, the smallest first, then unsorted', () => {
        const onSortChange = vi.fn();
        const sort = createSortButton({ label: 'Day %', align: 'end', title: 'Sort by Day %', onSortChange });
        const el = sort.el;
        expect(el.getAttribute('data-slot')).toBe('sort-button');
        expect(el.getAttribute('data-align')).toBe('end');
        expect(el.title).toBe('Sort by Day %');
        expect(el.getAttribute('aria-label')).toBe('Day %');
        expect(el.getAttribute('aria-describedby')).toBe(el.querySelector('[data-slot="sort-button-state"]')!.id);
        expect(sort.direction).toBeNull();
        expect(arrow(el)).toBeNull();

        el.click();
        expect(onSortChange).toHaveBeenLastCalledWith('desc');
        expect(el.getAttribute('data-direction')).toBe('desc');
        expect(state(el)).toBe('sorted descending');
        const down = arrow(el);
        expect(down).not.toBeNull();

        el.click();
        expect(onSortChange).toHaveBeenLastCalledWith('asc');
        expect(state(el)).toBe('sorted ascending');
        expect(arrow(el)).not.toBe(down);

        el.click();
        expect(onSortChange).toHaveBeenLastCalledWith(null);
        expect(el.hasAttribute('data-direction')).toBe(false);
        expect(state(el)).toBe('');
        expect(arrow(el)).toBeNull();
        expect(el.textContent).toBe('Day %');
    });

    it('can start ascending and never clear', () => {
        const onSortChange = vi.fn();
        const sort = createSortButton({ label: 'Symbol', firstDirection: 'asc', clearable: false, onSortChange });
        for (let i = 0; i < 3; i++) sort.el.click();
        expect(onSortChange.mock.calls.map((c) => c[0])).toEqual(['asc', 'desc', 'asc']);
    });

    it('shows a sort from code without reporting it', () => {
        const onSortChange = vi.fn();
        const sort = createSortButton({ label: 'Last', direction: 'asc', onSortChange });
        expect(sort.el.getAttribute('data-direction')).toBe('asc');
        sort.setDirection(null);
        expect(sort.direction).toBeNull();
        sort.setDirection('desc');
        expect(state(sort.el)).toBe('sorted descending');
        expect(onSortChange).not.toHaveBeenCalled();
        sort.setDisabled(true);
        expect(sort.el.disabled).toBe(true);
    });

    it("speaks a translator's language", () => {
        const i18n = { t: (m: { id: string; defaultMessage: string } | string) => (typeof m === 'string' ? m : m.id === 'ui.sortButton.descending' ? 'tri décroissant' : m.defaultMessage) };
        const sort = createSortButton({ label: 'Dernier', direction: 'desc', i18n });
        expect(state(sort.el)).toBe('tri décroissant');
    });
});
