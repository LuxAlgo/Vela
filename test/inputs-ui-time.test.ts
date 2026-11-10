// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { DARK_THEME } from '../src/core/theme';
import { IndicatorInputsDialog } from '../src/renderers/shared/IndicatorInputsDialog';
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

describe('IndicatorInputsDialog — inline time and session controls', () => {
    let dialog: IndicatorInputsDialog | null = null;

    beforeEach(() => {
        if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
            (globalThis as { CSS?: unknown }).CSS = { ...(globalThis as { CSS?: object }).CSS, escape: (s: string) => s };
        }
    });

    afterEach(() => {
        dialog?.close();
        dialog = null;
        document.body.replaceChildren();
    });

    it('lets inline time and session pickers size themselves instead of squeezing into 100px', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        dialog = new IndicatorInputsDialog({
            container: host,
            theme: () => DARK_THEME,
            mobile: () => false,
            dialogHost: () => host,
            symbolPicker: () => null,
            onChange: null,
            onBackdropClose: () => {},
        });
        const ts = Date.parse('2024-01-01T01:00:00');
        dialog.open({
            id: 'ind',
            title: 'Test',
            inputs: [
                { key: 'start', title: 'Start', type: 'time', defval: ts },
                { key: 'useEnd', title: '', type: 'bool', defval: false, inline: 'end' },
                { key: 'end', title: 'End', type: 'time', defval: ts, inline: 'end' },
                { key: 'useSession', title: 'Session', type: 'bool', defval: false, inline: 'sess' },
                { key: 'session', title: '', type: 'session', defval: '0930-1600', inline: 'sess' },
                { key: 'fast', title: 'Fast', type: 'int', defval: 10, inline: 'len' },
                { key: 'slow', title: 'Slow', type: 'int', defval: 20, inline: 'len' },
            ],
            values: {},
            props: [],
            propValues: {},
        });

        const startDate = document.getElementById('vela-inp-ind-start')!.parentElement!;
        const startTime = document.getElementById('vela-inp-ind-start-time')!.parentElement!;
        const endDate = document.getElementById('vela-inp-ind-end')!.parentElement!;
        const endTime = document.getElementById('vela-inp-ind-end-time')!.parentElement!;
        const endGroup = endDate.parentElement!;

        // The inline time control mounts directly in its inline-item, never inside a 100px box.
        expect(endGroup.parentElement?.classList.contains('vela-field-inline-item')).toBe(true);
        expect(endDate.style.width).toBe(startDate.style.width);
        expect(endDate.style.width).toBe('128px');
        expect(endTime.style.width).toBe(startTime.style.width);
        expect(endTime.style.width).toBe('86px');
        expect(endDate.style.flex).toContain('0');
        expect(endTime.style.flex).toContain('0');

        // Inline session controls get their full two-combobox width too.
        const sessFrom = document.getElementById('vela-inp-ind-session')!.parentElement!;
        const sessTo = document.getElementById('vela-inp-ind-session-end')!.parentElement!;
        expect(sessFrom.parentElement?.parentElement?.classList.contains('vela-field-inline-item')).toBe(true);
        expect(sessFrom.style.width).toBe('86px');
        expect(sessTo.style.width).toBe('86px');

        // Ordinary inline controls still keep their 100px wrapper.
        const fastEl = document.getElementById('vela-inp-ind-fast')!.closest('[data-slot="number-input"]') as HTMLElement;
        expect(fastEl.parentElement?.style.width).toBe('100px');
    });
});
