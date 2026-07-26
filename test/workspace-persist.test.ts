// The workspace state codec (src/workspace/persist.ts): encode/decode round-trip, the
// field-by-field sanitizer that guards `applyState` against untrusted documents, and
// the in-memory default storage adapter. DOM-free — node env; the live getState /
// applyState / persist plumbing is verified in the browser (playground probes).
import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, sanitizeState, memoryStorageAdapter, type WorkspaceState } from '../src/workspace/persist';

const fullDoc: WorkspaceState = {
    version: 1,
    layout: '4',
    activeCellId: 'c2',
    timezone: 'Europe/Paris',
    favorites: ['trendline', 'hline'],
    sync: { viewport: true, symbol: { c1: 'a', c2: 'a' }, crosshair: true },
    trackSizes: { '4': { cols: [1.4, 0.6], rows: [1, 1] } },
    cells: {
        c1: {
            symbol: 'BTCUSDT',
            provider: 'binance',
            timeframe: '60',
            priceStyle: 'candles',
            bars: 500,
            watermark: false,
            rendererConfig: { theme: 'dark', nested: { any: ['shape'] } },
            drawings: { version: 1, items: [{ type: 'trendline' }] },
            indicators: { manifest: ['EMA 20'], natives: ['volume'] },
        },
        c2: { symbol: 'ETHUSDT', timeframe: '15' },
    },
};

describe('state codec round-trip', () => {
    it('decodeState(encodeState(doc)) preserves a full valid document', () => {
        expect(decodeState(encodeState(fullDoc))).toEqual(fullDoc);
    });

    it('rejects unusable payloads with null, never throws', () => {
        expect(decodeState('not json {')).toBeNull();
        expect(decodeState('"a string"')).toBeNull();
        expect(decodeState('42')).toBeNull();
        expect(decodeState('null')).toBeNull();
        expect(decodeState(JSON.stringify({ version: 2, layout: '4', cells: {} }))).toBeNull(); // future version
        expect(decodeState(JSON.stringify({ version: 1, cells: {} }))).toBeNull(); // no layout id
    });
});

describe('sanitizeState (the applyState gate)', () => {
    it('drops malformed fields but keeps the healthy remainder', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '2h',
            activeCellId: 7, // wrong type → dropped
            timezone: '', // empty → dropped
            sync: { viewport: 'yes', crosshair: true }, // bad value dropped; crosshair is a REAL kind now
            trackSizes: { '2h': { cols: [1, -1] }, '4': { cols: [2, 1] } }, // negative weight kills the axis
            cells: {
                c1: { symbol: 'BTCUSDT', bars: -5, rendererConfig: 'oops' }, // bad bars/config dropped
                c2: null, // unusable cell → dropped
                c3: { indicators: { manifest: ['EMA', 42], natives: 'volume' } }, // non-strings filtered
            },
        });
        expect(doc).toEqual({
            version: 1,
            layout: '2h',
            sync: { crosshair: true }, // ghost-crosshair link — persisted like every kind
            trackSizes: { '4': { cols: [2, 1] } },
            cells: {
                c1: { symbol: 'BTCUSDT' },
                c3: { indicators: { manifest: ['EMA'], natives: [] } },
            },
        });
    });

    it('passes renderer-config and drawings documents through opaquely', () => {
        const config = { anything: { the: ['renderer', 'owns'] } };
        const doc = sanitizeState({ version: 1, layout: '1', cells: { c1: { rendererConfig: config, drawings: config } } });
        // Downstream consumers (applyConfig / fromJSON) validate these — the codec only
        // requires object-ness so JSON primitives cannot masquerade as documents.
        expect(doc!.cells.c1!.rendererConfig).toEqual(config);
        expect(doc!.cells.c1!.drawings).toEqual(config);
    });

    it('keeps sync group records only when at least one valid member remains', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '4',
            cells: {},
            sync: { symbol: { c1: 'a', c2: 9 }, timeframe: { c1: 3 } },
        });
        expect(doc!.sync).toEqual({ symbol: { c1: 'a' } }); // timeframe record emptied → dropped
    });

    it('filters shared favorites and per-cell watermark by type', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '1',
            favorites: ['trendline', 7, null, 'hline'],
            cells: { c1: { watermark: 'yes' }, c2: { watermark: false } },
        });
        expect(doc!.favorites).toEqual(['trendline', 'hline']); // non-strings dropped
        expect(doc!.cells.c1).toEqual({}); // non-boolean watermark dropped
        expect(doc!.cells.c2).toEqual({ watermark: false });
        // an all-junk favorites array disappears entirely
        expect(sanitizeState({ version: 1, layout: '1', favorites: [1, 2], cells: {} })!.favorites).toBeUndefined();
    });
});

describe('memoryStorageAdapter (default, session-lived)', () => {
    it('shares one module-level store across adapter instances (SPA recreate restores)', () => {
        const a = memoryStorageAdapter();
        const b = memoryStorageAdapter();
        expect(a.get('ws-test-key')).toBeNull();
        a.set('ws-test-key', 'payload');
        expect(b.get('ws-test-key')).toBe('payload'); // a NEW workspace's fresh adapter still sees it
        b.remove!('ws-test-key');
        expect(a.get('ws-test-key')).toBeNull();
    });
});
