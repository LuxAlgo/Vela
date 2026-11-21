import { describe, expect, it } from 'vitest';
import { joinMultiValue, parseMultiValue, type InputSchema } from '../src/core/model/inputs';

/** The strategy property an engine sends for its execution modes. */
const EXECUTION: InputSchema = {
    key: 'script_execution',
    title: 'Script execution',
    type: 'string',
    defval: 'On bar close',
    options: ['On bar close', 'On order fill', 'On realtime bar tick'],
    multiple: { separator: ', ', locked: ['On bar close'] },
    group: 'Detalization and execution',
};

const FREE: InputSchema = { key: 'k', title: 'K', type: 'string', defval: '', options: ['A', 'B', 'C'], multiple: { separator: '|' } };

describe('parseMultiValue — the options a stored value checks', () => {
    it('reads the joined value back in options order, whatever order it was stored in', () => {
        expect(parseMultiValue(FREE, 'C|A')).toEqual(['A', 'C']);
        expect(parseMultiValue(EXECUTION, 'On realtime bar tick, On order fill')).toEqual(['On bar close', 'On order fill', 'On realtime bar tick']);
    });

    it('always checks the locked options, even when the value leaves them out', () => {
        expect(parseMultiValue(EXECUTION, 'On order fill')).toEqual(['On bar close', 'On order fill']);
        expect(parseMultiValue(EXECUTION, 'On bar close')).toEqual(['On bar close']);
    });

    it('drops fragments that name no option', () => {
        expect(parseMultiValue(FREE, 'A|Z|B|')).toEqual(['A', 'B']);
        expect(parseMultiValue(EXECUTION, 'On bar close, On history bar tick')).toEqual(['On bar close']);
    });

    it('checks only the locked options for an empty value', () => {
        expect(parseMultiValue(FREE, '')).toEqual([]);
        expect(parseMultiValue(EXECUTION, '')).toEqual(['On bar close']);
    });

    it('matches a fragment with stray spaces around it', () => {
        expect(parseMultiValue({ ...FREE, multiple: { separator: ',' } }, 'A , B')).toEqual(['A', 'B']);
    });
});

describe('joinMultiValue — the value stored for a set of checked options', () => {
    it('joins in options order with the separator', () => {
        expect(joinMultiValue(FREE, ['C', 'A'])).toBe('A|C');
        expect(joinMultiValue(EXECUTION, ['On order fill', 'On bar close'])).toBe('On bar close, On order fill');
    });

    it('adds the locked options and drops unknown ones', () => {
        expect(joinMultiValue(EXECUTION, ['On order fill', 'Elsewhere'])).toBe('On bar close, On order fill');
        expect(joinMultiValue(EXECUTION, [])).toBe('On bar close');
        expect(joinMultiValue(FREE, [])).toBe('');
    });

    it('round-trips through parseMultiValue', () => {
        const value = joinMultiValue(EXECUTION, ['On realtime bar tick']);
        expect(value).toBe('On bar close, On realtime bar tick');
        expect(joinMultiValue(EXECUTION, parseMultiValue(EXECUTION, value))).toBe(value);
    });
});
