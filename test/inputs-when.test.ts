import { describe, it, expect } from 'vitest';
import { inputVisible, type InputWhen, type InputValue } from '../src/core/model/inputs';

const bag: Record<string, InputValue> = {
    enabled: true,
    mode: 'Manual',
    level: 3,
};

describe('inputVisible — settings-dialog `when` gate', () => {
    it('shows an input with no gate', () => {
        expect(inputVisible(undefined, bag)).toBe(true);
    });

    it('matches a toggle with `equals`', () => {
        expect(inputVisible({ key: 'enabled', equals: true }, bag)).toBe(true);
        expect(inputVisible({ key: 'enabled', equals: false }, bag)).toBe(false);
    });

    it('matches one dropdown choice with `equals`', () => {
        expect(inputVisible({ key: 'mode', equals: 'Manual' }, bag)).toBe(true);
        expect(inputVisible({ key: 'mode', equals: 'Auto' }, bag)).toBe(false);
    });

    it('matches a set of dropdown choices with `anyOf`', () => {
        expect(inputVisible({ key: 'mode', anyOf: ['Manual', 'Hybrid'] }, bag)).toBe(true);
        expect(inputVisible({ key: 'mode', anyOf: ['Auto', 'Off'] }, bag)).toBe(false);
    });

    it('ANDs several conditions together', () => {
        const both: InputWhen = [
            { key: 'enabled', equals: true },
            { key: 'mode', equals: 'Manual' },
        ];
        expect(inputVisible(both, bag)).toBe(true);
        expect(inputVisible(both, { ...bag, mode: 'Auto' })).toBe(false);
    });

    it('compares strictly — a numeric value never matches its string twin', () => {
        expect(inputVisible({ key: 'level', equals: 3 }, bag)).toBe(true);
        expect(inputVisible({ key: 'level', equals: '3' }, bag)).toBe(false);
    });

    it('fails a condition on a key absent from the values', () => {
        expect(inputVisible({ key: 'missing', equals: true }, bag)).toBe(false);
        expect(inputVisible({ key: 'missing', anyOf: [true, false] }, bag)).toBe(false);
    });
});
