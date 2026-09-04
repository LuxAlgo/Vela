import { describe, expect, it } from 'vitest';
import { normalizeSession, normalizeSessionDefinitions, resolveMarketSession } from '../src/core/options';

describe('explicit market session definitions', () => {
    it('keeps valid definitions in order, copies windows, and lets the first duplicate id win', () => {
        const windows = ['0930-1130', '1230-1600'];
        const definitions = normalizeSessionDefinitions([
            { id: 'day', label: 'Day', windows, color: ' rgba(41, 98, 255, 0.12) ' },
            { id: 'night', label: 'Night', windows: ['1700-1600'], color: '#123456' },
            { id: 'day', label: 'Duplicate', windows: ['0000-0100'], color: '#fff' },
        ]);

        windows.push('1800-1900');
        expect(definitions).toEqual([
            { id: 'day', label: 'Day', windows: ['0930-1130', '1230-1600'], color: 'rgba(41, 98, 255, 0.12)' },
            { id: 'night', label: 'Night', windows: ['1700-1600'], color: '#123456' },
        ]);
    });

    it('drops a whole malformed definition deterministically', () => {
        expect(normalizeSessionDefinitions([
            null,
            { id: '', label: 'Empty id', windows: ['0900-1000'], color: '#fff' },
            { id: 'empty-label', label: ' ', windows: ['0900-1000'], color: '#fff' },
            { id: 'no-window', label: 'No window', windows: [], color: '#fff' },
            { id: 'bad-hour', label: 'Bad hour', windows: ['2500-2600'], color: '#fff' },
            { id: 'bad-minute', label: 'Bad minute', windows: ['0960-1000'], color: '#fff' },
            { id: 'empty-window', label: 'Empty window', windows: ['0900-0900'], color: '#fff' },
            { id: 'bad-2400', label: 'Bad midnight', windows: ['2400-0100'], color: '#fff' },
            { id: 'empty-color', label: 'Empty color', windows: ['0900-1000'], color: ' ' },
            { id: 'valid', label: 'Valid', windows: ['0000-2400'], color: 'red' },
        ])).toEqual([{ id: 'valid', label: 'Valid', windows: ['0000-2400'], color: 'red' }]);
    });

    it('preserves exact case, resolves a known id, and falls back to the first choice', () => {
        const definitions = normalizeSessionDefinitions([
            { id: 'Asia-AM', label: 'Asia AM', windows: ['0900-1200'], color: '#111' },
            { id: 'Asia-PM', label: 'Asia PM', windows: ['1300-1600'], color: '#222' },
        ]);
        expect(normalizeSession('  Asia-AM  ')).toBe('Asia-AM');
        expect(resolveMarketSession('Asia-PM', definitions)).toBe('Asia-PM');
        expect(resolveMarketSession('asia-pm', definitions)).toBe('Asia-AM');
        expect(resolveMarketSession(undefined, definitions)).toBe('Asia-AM');
        expect(resolveMarketSession('anything', [])).toBeUndefined();
    });
});
