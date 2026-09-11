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

/** A booted workspace, settled: the boot schedules its own dirty burst, so wait it out
 *  and start each case from a genuinely clean slate. */
async function mountWorkspace() {
    const host = document.createElement('div');
    document.body.append(host);
    const ws = new VelaWorkspace(host, { layout: '1' });
    await new Promise((resolve) => setTimeout(resolve, 800));
    return ws;
}

describe('tearing down a workspace with an unsaved edit', () => {
    it('the host is told about an edit made just before destroy, not left to lose it', async () => {
        const ws = await mountWorkspace();
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        // An edit arrives; the debounce means nothing has been emitted yet.
        ws.setTimezone('Europe/Paris');
        expect(onStateChanged).not.toHaveBeenCalled();

        ws.destroy();

        expect(onStateChanged).toHaveBeenCalled();
    });

    it('a teardown with nothing pending stays quiet', async () => {
        const ws = await mountWorkspace();
        const onStateChanged = vi.fn();
        ws.on('state:changed', onStateChanged);

        ws.destroy();

        expect(onStateChanged).not.toHaveBeenCalled();
    });

    it('the state a host reads while tearing down still describes what was on screen', async () => {
        const ws = await mountWorkspace();
        const before = ws.getState();
        expect(before.charts.length).toBeGreaterThan(0);

        ws.destroy();

        // `charts` is rebuilt from the pool once the cells are gone, so the cells must
        // be dehydrated into it — otherwise a host reading here sees a stale document
        // and concludes, wrongly, that nothing changed.
        const after = ws.getState();
        expect(after.charts.map((c) => c.id)).toEqual(before.charts.map((c) => c.id));
    });
});
