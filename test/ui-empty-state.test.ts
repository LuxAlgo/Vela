// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createEmptyState } from '@luxalgo/vela-ui/empty-state';

describe('empty-state', () => {
    it('shows its icon, title, description and action, in that order', () => {
        const action = document.createElement('button');
        const { el } = createEmptyState({ icon: 'close', title: 'No alerts yet', description: 'Create one from the chart.', action });
        expect(el.getAttribute('data-slot')).toBe('empty-state');
        expect([...el.children].map((c) => c.getAttribute('data-slot') ?? c.tagName)).toEqual(['empty-state-icon', 'empty-state-title', 'empty-state-description', 'BUTTON']);
    });

    it('leaves out what it is not given', () => {
        const { el } = createEmptyState({ title: 'Nothing here' });
        expect(el.children).toHaveLength(1);
    });
});
