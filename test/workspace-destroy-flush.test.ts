// @vitest-environment jsdom
// `destroy()` must not silently discard the user's last edit. The dirty signal is
// debounced (`markStateDirty`, ~500ms) and carries BOTH halves — the `state:changed`
// event and the storage write — so a teardown inside that window used to drop the edit
// for every host that saves from `state:changed`. Reported downstream: a user changed
// the symbol, navigated away within the window, and came back to the previous symbol.
import { describe, it, expect, beforeAll, vi } from 'vitest';

// This jsdom build ships no `CSS` global; the style injector only needs `escape`.
(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
// jsdom has no ResizeObserver and no Web Animations — the chrome uses both decoratively.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { VelaWorkspace } from '../src/workspace/VelaWorkspace';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

/** A booted workspace on a detached host. No settling wait: building one is not an edit,
 *  so a fresh workspace starts clean and a teardown has nothing to flush. */
function mountWorkspace(opts: Record<string, unknown> = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    return new VelaWorkspace(host, { layout: '1', ...opts } as never);
}

describe('tearing down a workspace with an unsaved edit', () => {
    it('the host is told about an edit made just before destroy, not left to lose it', () => {
        const ws = mountWorkspace();
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        // An edit arrives; the debounce means nothing has been emitted yet.
        ws.setTimezone('Europe/Paris');
        expect(onStateChanged).not.toHaveBeenCalled();

        ws.destroy();

        expect(onStateChanged).toHaveBeenCalled();
    });

    it('a teardown with nothing pending stays quiet', () => {
        const ws = mountWorkspace();
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        ws.destroy();

        expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('opening a workspace and leaving without touching it reports no edit', () => {
        // Building the shell marks state dirty internally (seeding the sync settings).
        // That is setup, not the user's work: a workspace mounted and torn down inside
        // the debounce window — a redirect, a double-mount — must not tell the host to
        // save, or it saves an untouched default over whatever was stored.
        const ws = mountWorkspace();
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        ws.destroy();

        expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('the state a host reads while tearing down still describes what was on screen', () => {
        const ws = mountWorkspace();
        const before = ws.getState();
        expect(before.charts.length).toBeGreaterThan(0);

        ws.destroy();

        // `charts` is rebuilt from the pool once the cells are gone, so the cells must
        // be dehydrated into it — otherwise a host reading here sees a stale document
        // and concludes, wrongly, that nothing changed.
        const after = ws.getState();
        expect(after.charts.map((c) => c.id)).toEqual(before.charts.map((c) => c.id));
    });

    it('a host that tears down from its own save handler does not recurse', () => {
        // "State changed → save it → now unmount" is an ordinary host reaction, and it
        // lands back inside the very flush that called it.
        const ws = mountWorkspace();
        let depth = 0;
        let maxDepth = 0;
        ws.on('state:changed', () => {
            depth += 1;
            maxDepth = Math.max(maxDepth, depth);
            ws.destroy();
            depth -= 1;
        });

        ws.setTimezone('Europe/Paris');
        ws.destroy();

        expect(maxDepth).toBe(1);
    });

    it('what gets stored is what the host was told, even if a handler keeps editing', () => {
        const writes: string[] = [];
        const ws = mountWorkspace({
            persist: 'test-destroy-flush',
            storage: { get: () => null, set: (_key: string, value: string) => void writes.push(value) },
        });
        let reportedToHost = '';
        ws.on('state:changed', () => {
            reportedToHost = ws.getState().timezone ?? '';
            ws.setTimezone('Asia/Tokyo'); // a handler that keeps working after being told
        });

        ws.setTimezone('Europe/Paris');
        ws.destroy();

        expect(reportedToHost).toBe('Europe/Paris');
        // Storage must agree with the host rather than with whatever the handler did
        // afterwards, or the two copies diverge on the next boot.
        const lastWrite = writes[writes.length - 1] ?? '';
        expect(lastWrite).toContain('Europe/Paris');
        expect(lastWrite).not.toContain('Asia/Tokyo');
    });

    it('a page unload saves the pending edit once, and a teardown after it adds nothing', () => {
        const writes: string[] = [];
        const ws = mountWorkspace({
            persist: 'test-destroy-flush-unload',
            storage: { get: () => null, set: (_key: string, value: string) => void writes.push(value) },
        });
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        ws.setTimezone('Europe/Paris');
        window.dispatchEvent(new Event('beforeunload'));
        const writesAfterUnload = writes.length;

        ws.destroy();

        expect(onStateChanged).toHaveBeenCalledTimes(1);
        expect(writes.length).toBe(writesAfterUnload);
    });
});
