// The workspace state codec (src/workspace/persist.ts): encode/decode round-trip, the
// field-by-field sanitizer that guards `applyState` against untrusted documents, and
// the in-memory default storage adapter. DOM-free — node env; the live getState /
// applyState / persist plumbing is verified in the browser (playground probes).
import { describe, it, expect } from 'vitest';
import { encodeState, decodeState, sanitizeState, memoryStorageAdapter, type WorkspaceState } from '../src/workspace/persist';
import { localStorageAdapter } from '../src/widget/persist';
import { ensureLayout, registerBuiltinLayouts } from '../src/workspace/layouts';

const fullDoc: WorkspaceState = {
    version: 1,
    layout: '4',
    activeCellId: 'c2',
    timezone: 'Europe/Paris',
    favorites: ['trendline', 'hline'],
    timeframeFavorites: ['15', '60', 'D'],
    sync: { viewport: true, symbol: { c1: 'a', c2: 'a' }, crosshair: true, drawings: true, style: true },
    trackSizes: { '4': { cols: [1.4, 0.6], rows: [1, 1] } },
    charts: [
        {
            id: 'c1',
            symbol: 'BTCUSDT',
            provider: 'binance',
            timeframe: '60',
            priceStyle: 'candles',
            bars: 500,
            watermark: false,
            indicatorTitles: false,
            indicatorValues: false,
            rendererConfig: { theme: 'dark', nested: { any: ['shape'] } },
            drawings: { version: 1, items: [{ type: 'trendline' }] },
            indicators: { manifest: ['EMA 20'], natives: ['volume'] },
            ext: { 'velapro.indicators': [{ slug: 'smart-money', inputs: { len: 20 } }] },
        },
        { id: 'c2', symbol: 'ETHUSDT', timeframe: '15' },
    ],
    ext: { 'velapro.favorites': { starred: ['smart-money'] } },
};

describe('state codec round-trip', () => {
    it('decodeState(encodeState(doc)) preserves a full valid document', () => {
        expect(decodeState(encodeState(fullDoc))).toEqual(fullDoc);
    });

    it('a dynamic picker layout id survives the round-trip and resolves at boot', () => {
        registerBuiltinLayouts();
        // The picker's ids are never registered — the boot path re-synthesizes them
        // (ensureLayout), so a persisted custom grid restores across sessions.
        const grid: WorkspaceState = { ...fullDoc, layout: 'g3x3' };
        const restored = decodeState(encodeState(grid));
        expect(restored!.layout).toBe('g3x3');
        expect(ensureLayout(restored!.layout)?.cells).toHaveLength(9);
    });

    it('rejects unusable payloads with null, never throws', () => {
        expect(decodeState('not json {')).toBeNull();
        expect(decodeState('"a string"')).toBeNull();
        expect(decodeState('42')).toBeNull();
        expect(decodeState('null')).toBeNull();
        expect(decodeState(JSON.stringify({ version: 2, layout: '4', charts: [] }))).toBeNull(); // future version
        expect(decodeState(JSON.stringify({ version: 1, charts: [] }))).toBeNull(); // no layout id
    });
});

describe('sanitizeState (the applyState gate)', () => {
    it('drops malformed fields but keeps the healthy remainder', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '2h',
            activeCellId: 7, // wrong type → dropped
            timezone: '', // empty → dropped
            sync: { viewport: 'yes', crosshair: true }, // bad value dropped; crosshair is a REAL kind
            trackSizes: { '2h': { cols: [1, -1] }, '4': { cols: [2, 1] } }, // negative weight kills the axis
            charts: [
                { id: 'c1', symbol: 'BTCUSDT', bars: -5, rendererConfig: 'oops' }, // bad bars/config dropped
                null, // unusable entry → dropped
                { symbol: 'GHOST' }, // ID-LESS entry → dropped
                { id: 'c3', indicators: { manifest: ['EMA', 42], natives: 'volume' } }, // non-strings filtered
                ,
                {
                    id: 'c4', // VALUE-carrying entries: name required, value bags must be plain objects
                    indicators: { manifest: [{ name: 'RSI', inputs: { len: 21 }, props: 'oops' }, { name: 'MACD', inputs: [1, 2] }, { inputs: { x: 1 } }], natives: [] },
                },
            ],
        });
        expect(doc).toEqual({
            version: 1,
            layout: '2h',
            sync: { crosshair: true },
            trackSizes: { '4': { cols: [2, 1] } },
            charts: [
                { id: 'c1', symbol: 'BTCUSDT' },
                { id: 'c3', indicators: { manifest: ['EMA'], natives: [] } },
                // bad bags dropped (an all-default entry collapses to the bare name); nameless entries vanish
                { id: 'c4', indicators: { manifest: [{ name: 'RSI', inputs: { len: 21 } }, 'MACD'], natives: [] } },
            ],
        });
    });

    it('keeps a valid session value and drops anything else', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '1',
            charts: [
                { id: 'c1', symbol: 'NASDAQ:AAPL', session: 'extended' },
                { id: 'c2', symbol: 'BTCUSDT', session: 'after-hours' }, // not a session → dropped
            ],
        });
        expect(doc?.charts).toEqual([
            { id: 'c1', symbol: 'NASDAQ:AAPL', session: 'extended' },
            { id: 'c2', symbol: 'BTCUSDT' },
        ]);
    });

    it('filters non-string favorite entries, dropping empty sets entirely', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '1',
            favorites: ['trendline', 7],
            timeframeFavorites: ['60', null, 'D'],
            charts: [],
        });
        expect(doc!.favorites).toEqual(['trendline']);
        expect(doc!.timeframeFavorites).toEqual(['60', 'D']);
        const empty = sanitizeState({ version: 1, layout: '1', timeframeFavorites: [42], charts: [] });
        expect(empty!.timeframeFavorites).toBeUndefined();
    });

    it('dedupes chart entries by id — the LAST duplicate wins', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '2h',
            charts: [
                { id: 'c1', symbol: 'OLD' },
                { id: 'c2', symbol: 'ETHUSDT' },
                { id: 'c1', symbol: 'NEW' },
            ],
        });
        expect(doc!.charts).toEqual([
            { id: 'c1', symbol: 'NEW' },
            { id: 'c2', symbol: 'ETHUSDT' },
        ]);
    });

    it('passes ext bags through opaquely — unknown keys and arbitrary payloads survive', () => {
        // The third-party seam: entries are validated by their OWN handler at restore
        // time; the codec only rejects non-object bags. A key whose plugin is absent
        // this session must round-trip verbatim (no data loss on a plugin-less reload).
        const doc = sanitizeState({
            version: 1,
            layout: '1',
            ext: { 'vendor.prefs': { any: ['shape', 42] }, 'unknown.plugin': 'a bare string payload', '': 'dropped (empty key)' },
            charts: [
                { id: 'c1', ext: { 'vendor.indicators': [1, 2, 3] } },
                { id: 'c2', ext: ['not', 'an', 'object'] }, // array bag → dropped
                { id: 'c3', ext: 'nope' }, // primitive bag → dropped
            ],
        });
        expect(doc!.ext).toEqual({ 'vendor.prefs': { any: ['shape', 42] }, 'unknown.plugin': 'a bare string payload' });
        expect(doc!.charts[0]!.ext).toEqual({ 'vendor.indicators': [1, 2, 3] });
        expect(doc!.charts[1]!.ext).toBeUndefined();
        expect(doc!.charts[2]!.ext).toBeUndefined();
        // an emptied bag disappears entirely rather than persisting `{}`
        expect(sanitizeState({ version: 1, layout: '1', ext: {}, charts: [] })!.ext).toBeUndefined();
    });

    it('passes renderer-config and drawings documents through opaquely', () => {
        const config = { anything: { the: ['renderer', 'owns'] } };
        const doc = sanitizeState({ version: 1, layout: '1', charts: [{ id: 'c1', rendererConfig: config, drawings: config }] });
        // Downstream consumers (applyConfig / fromJSON) validate these — the codec only
        // requires object-ness so JSON primitives cannot masquerade as documents.
        expect(doc!.charts[0]!.rendererConfig).toEqual(config);
        expect(doc!.charts[0]!.drawings).toEqual(config);
    });

    it('keeps sync group records only when at least one valid member remains', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '4',
            charts: [],
            sync: { symbol: { c1: 'a', c2: 9 }, timeframe: { c1: 3 } },
        });
        expect(doc!.sync).toEqual({ symbol: { c1: 'a' } }); // timeframe record emptied → dropped
    });

    it('filters shared favorites and per-chart display toggles by type', () => {
        const doc = sanitizeState({
            version: 1,
            layout: '1',
            favorites: ['trendline', 7, null, 'hline'],
            charts: [{ id: 'c1', watermark: 'yes', indicatorTitles: 0 }, { id: 'c2', watermark: false, indicatorTitles: false }],
        });
        expect(doc!.favorites).toEqual(['trendline', 'hline']); // non-strings dropped
        expect(doc!.charts[0]).toEqual({ id: 'c1' }); // non-boolean toggles dropped
        expect(doc!.charts[1]).toEqual({ id: 'c2', watermark: false, indicatorTitles: false });
        // an all-junk favorites array disappears entirely
        expect(sanitizeState({ version: 1, layout: '1', favorites: [1, 2], charts: [] })!.favorites).toBeUndefined();
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

describe('localStorageAdapter (pinned-key mode)', () => {
    it('pins every read/write to the given entry, whatever logical key the shell passes', () => {
        const store = new Map<string, string>();
        const g = globalThis as { localStorage?: unknown };
        const prev = g.localStorage;
        g.localStorage = {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        };
        try {
            const pinned = localStorageAdapter('my-app-state');
            pinned.set('vela-widget', 'DOC');
            expect(store.get('my-app-state')).toBe('DOC'); // landed on the pinned entry
            expect(store.has('vela-widget')).toBe(false);
            expect(pinned.get('anything-at-all')).toBe('DOC');
            void pinned.remove?.('whatever');
            expect(store.size).toBe(0);
            // omitted → the logical key is used as-is (historical behavior)
            const plain = localStorageAdapter();
            plain.set('vela-widget', 'X');
            expect(store.get('vela-widget')).toBe('X');
        } finally {
            g.localStorage = prev;
        }
    });
});
