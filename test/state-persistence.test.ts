// The third-party state-persistence registry (src/widget/contributions.ts): handler
// registration semantics and scope filtering. DOM-free — node env; the live serialize/
// restore plumbing (cell + global ext, mute, undo/redo of ctx.addIndicator) is verified
// in the browser (playground probes), like the rest of the shell.
import { describe, it, expect, afterEach } from 'vitest';
import {
    registerStatePersistence,
    unregisterStatePersistence,
    statePersistenceHandlers,
    type StatePersistenceHandler,
} from '../src/widget/contributions';

const cellHandler = (key: string): StatePersistenceHandler => ({
    key,
    scope: 'cell',
    serialize: () => ({ from: key }),
    restore: () => undefined,
});

const globalHandler = (key: string): StatePersistenceHandler => ({
    key,
    scope: 'global',
    serialize: () => ({ from: key }),
    restore: () => undefined,
});

afterEach(() => {
    for (const key of ['t.cell-a', 't.cell-b', 't.global-a', 't.swap']) unregisterStatePersistence(key);
});

describe('registerStatePersistence', () => {
    it('registers, lists by scope in registration order, and unregisters', () => {
        registerStatePersistence(cellHandler('t.cell-a'));
        registerStatePersistence(globalHandler('t.global-a'));
        registerStatePersistence(cellHandler('t.cell-b'));
        expect(statePersistenceHandlers('cell').map((h) => h.key)).toEqual(['t.cell-a', 't.cell-b']);
        expect(statePersistenceHandlers('global').map((h) => h.key)).toEqual(['t.global-a']);
        unregisterStatePersistence('t.cell-a');
        expect(statePersistenceHandlers('cell').map((h) => h.key)).toEqual(['t.cell-b']);
    });

    it('re-registering a key replaces the handler (last wins), across scopes too', () => {
        registerStatePersistence(cellHandler('t.swap'));
        registerStatePersistence(globalHandler('t.swap')); // same key, new scope — replaces
        expect(statePersistenceHandlers('cell').map((h) => h.key)).not.toContain('t.swap');
        expect(statePersistenceHandlers('global').map((h) => h.key)).toContain('t.swap');
    });

    it('the disposer removes ITS registration only — a replacement survives it', () => {
        const first = cellHandler('t.swap');
        const dispose = registerStatePersistence(first);
        const second = cellHandler('t.swap');
        registerStatePersistence(second);
        dispose(); // stale disposer — the key now belongs to `second`
        expect(statePersistenceHandlers('cell').find((h) => h.key === 't.swap')).toBe(second);
    });
});
