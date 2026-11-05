// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createEmpty } from '@luxalgo/vela-ui/empty';

describe('empty', () => {
    it('shows its icon, title, description and action, in that order', () => {
        const action = document.createElement('button');
        const { el } = createEmpty({ icon: 'close', title: 'No alerts yet', description: 'Create one from the chart.', action });
        expect(el.getAttribute('data-slot')).toBe('empty');
        expect([...el.children].map((c) => c.getAttribute('data-slot') ?? c.tagName)).toEqual(['empty-icon', 'empty-title', 'empty-description', 'BUTTON']);
    });

    it('leaves out what it is not given', () => {
        const { el } = createEmpty({ title: 'Nothing here' });
        expect(el.children).toHaveLength(1);
    });
});
