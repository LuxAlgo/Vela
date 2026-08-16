import { describe, it, expect } from 'vitest';
import { normalizeDateInput, normalizeTimeInput } from '../src/renderers/shared/InputsUI';

describe('normalizeTimeInput — session/time combobox typing', () => {
    it('accepts padded HH:MM', () => {
        expect(normalizeTimeInput('09:30')).toBe('09:30');
        expect(normalizeTimeInput('23:59')).toBe('23:59');
    });

    it('pads a single-digit hour', () => {
        expect(normalizeTimeInput('9:30')).toBe('09:30');
    });

    it('accepts HHMM without a colon', () => {
        expect(normalizeTimeInput('0930')).toBe('09:30');
        expect(normalizeTimeInput('0000')).toBe('00:00');
    });

    it('rejects out-of-range and empty values', () => {
        expect(normalizeTimeInput('24:00')).toBeNull();
        expect(normalizeTimeInput('12:60')).toBeNull();
        expect(normalizeTimeInput('abc')).toBeNull();
        expect(normalizeTimeInput('')).toBeNull();
    });
});

describe('normalizeDateInput — date field typing', () => {
    it('accepts padded YYYY-MM-DD', () => {
        expect(normalizeDateInput('2024-01-01')).toBe('2024-01-01');
        expect(normalizeDateInput('2024-12-31')).toBe('2024-12-31');
    });

    it('pads single-digit month and day', () => {
        expect(normalizeDateInput('2024-1-2')).toBe('2024-01-02');
    });

    it('rejects impossible and empty values', () => {
        expect(normalizeDateInput('2024-13-01')).toBeNull();
        expect(normalizeDateInput('2024-02-30')).toBeNull();
        expect(normalizeDateInput('01/01/2024')).toBeNull();
        expect(normalizeDateInput('')).toBeNull();
    });
});
