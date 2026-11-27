// @vitest-environment jsdom
// Host-contributed drawing actions: the registry, the provider the shells hand the renderer, and
// the surfaces that show them — the selection toolbar, its overflow menu and the settings dialog.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

(globalThis as { CSS?: unknown }).CSS ??= { escape: (v: string) => v };
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
};

import { createDrawing, type Drawing, type SerializedDrawing } from '../src/core/drawings';
import { DARK_THEME } from '../src/core/theme';
import type { DrawingActionView } from '../src/core/ports/IChartRenderer';
import { DrawingSettingsPopup, type SettingsActions } from '../src/renderers/native/drawings/DrawingSettingsPopup';
import { registerDrawingAction, unregisterDrawingAction, drawingActions, drawingActionsProviderFor } from '../src/widget/contributions';

beforeAll(() => {
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];
});

afterEach(() => {
    document.body.replaceChildren();
    for (const d of drawingActions()) unregisterDrawingAction(d.id);
});

const settled = () => new Promise<void>((r) => setTimeout(r, 50));

const doc = (id: string, type: string, price = 100): SerializedDrawing =>
    ({
        id,
        type,
        paneId: 'price',
        anchors: [
            { time: 0, price },
            { time: 10, price },
        ],
    }) as unknown as SerializedDrawing;

/** A chart stand-in: just the drawings surface the provider reads. */
function fakeChart(drawings: SerializedDrawing[], supported = true) {
    return { drawings: { supported, all: () => drawings.map((d) => ({ ...d })) }, i18n: undefined } as never;
}

describe('drawing actions: the registry', () => {
    it('sorts by order, replaces on re-register, and a stale disposer leaves the replacement', () => {
        const dispose = registerDrawingAction({ id: 'a', icon: 'i', label: 'A', order: 2, run: () => {} });
        registerDrawingAction({ id: 'b', icon: 'i', label: 'B', order: 1, run: () => {} });
        expect(drawingActions().map((d) => d.id)).toEqual(['b', 'a']);
        registerDrawingAction({ id: 'a', icon: 'i', label: 'A2', run: () => {} });
        dispose(); // the first registration's disposer: no longer the live one
        expect(drawingActions().map((d) => d.label)).toEqual(['A2', 'B']);
        unregisterDrawingAction('a');
        expect(drawingActions().map((d) => d.id)).toEqual(['b']);
    });
});

describe('drawing actions: the shell provider', () => {
    it('resolves the drawing, gates on when(), and binds a fresh context per click', () => {
        const seen: SerializedDrawing[] = [];
        const ctxs: unknown[] = [];
        registerDrawingAction({
            id: 'alert',
            icon: 'bell',
            label: 'Add alert',
            when: (d) => d.type === 'hline',
            run: (ctx, d) => {
                ctxs.push(ctx);
                seen.push(d);
            },
        });
        let builds = 0;
        const provider = drawingActionsProviderFor(fakeChart([doc('h1', 'hline'), doc('b1', 'box')]), () => ({ built: ++builds }) as never);

        expect(provider('missing')).toEqual([]);
        expect(provider('b1')).toEqual([]); // when() gate
        const views = provider('h1');
        expect(views).toHaveLength(1);
        // No `surfaces`: the toolbar and the settings dialog, and no menu row.
        expect(views[0]).toMatchObject({ id: 'alert', icon: 'bell', label: 'Add alert', toolbar: true, settings: true, menu: false });
        views[0]!.run();
        views[0]!.run();
        expect(seen[0]?.id).toBe('h1');
        expect(ctxs).toEqual([{ built: 1 }, { built: 2 }]);
    });

    it('reads the drawing again at click time — a drag since the toolbar opened shows through', () => {
        const seen: SerializedDrawing[] = [];
        registerDrawingAction({ id: 'live', icon: 'bell', label: 'Live', run: (_ctx, d) => void seen.push(d) });
        const drawings = [doc('h1', 'hline', 100)];
        const [view] = drawingActionsProviderFor(fakeChart(drawings), () => ({}) as never)('h1');
        drawings[0] = doc('h1', 'hline', 150); // moved after the toolbar opened
        view!.run();
        expect(seen[0]?.anchors[0]?.price).toBe(150);
    });

    it('honours surfaces, and contributes nothing on a chart without drawings', () => {
        registerDrawingAction({ id: 'bar-only', icon: 'i', label: 'Bar', surfaces: ['toolbar'], run: () => {} });
        registerDrawingAction({ id: 'dialog-only', icon: 'i', label: 'Dialog', surfaces: ['settings'], run: () => {} });
        registerDrawingAction({ id: 'menu-only', icon: 'i', label: 'Menu', surfaces: ['menu'], run: () => {} });
        registerDrawingAction({ id: 'bar-and-menu', icon: 'i', label: 'Both', surfaces: ['toolbar', 'menu'], run: () => {} });
        const views = drawingActionsProviderFor(fakeChart([doc('h1', 'hline')]), () => ({}) as never)('h1');
        expect(views.map((v) => [v.id, v.toolbar, v.settings, v.menu])).toEqual([
            ['bar-only', true, false, false],
            ['dialog-only', false, true, false],
            ['menu-only', false, false, true],
            ['bar-and-menu', true, false, true],
        ]);
        expect(drawingActionsProviderFor(fakeChart([doc('h1', 'hline')], false), () => ({}) as never)('h1')).toEqual([]);
    });
});

describe('drawing actions: the toolbar and the settings dialog', () => {
    const line = (): Drawing => createDrawing('hline', { id: 'h', paneId: 'price', anchors: [{ time: 0, price: 100 }] })!;

    function actionsWith(extras: DrawingActionView[], drawing: Drawing): SettingsActions {
        return {
            resolve: () => drawing,
            patch: () => {},
            setLocked: () => {},
            reorder: () => {},
            duplicate: () => {},
            resetSettings: () => {},
            remove: () => {},
            extras: () => extras,
        };
    }

    const view = (over: Partial<DrawingActionView>, runs: string[]): DrawingActionView => ({
        id: 'alert',
        icon: 'bell',
        label: 'Add alert',
        toolbar: true,
        settings: true,
        menu: false,
        run: () => void runs.push(over.id ?? 'alert'),
        ...over,
    });

    /** The rows of the toolbar's overflow menu, opened afresh. */
    const overflowRows = (host: HTMLElement): HTMLButtonElement[] => {
        host.querySelector<HTMLButtonElement>('.vela-dpop [data-tip="More"]')!.click();
        return [...host.querySelectorAll<HTMLButtonElement>('.vela-dpop-item')];
    };

    it('the overflow menu lists the menu actions after its own four rows, read each time it opens', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const runs: string[] = [];
        const d = line();
        const extras = [view({ id: 'export', label: 'Export', toolbar: false, settings: false, menu: true }, runs), view({ id: 'bar-only' }, runs)];
        new DrawingSettingsPopup(host, DARK_THEME).open([d], null, actionsWith(extras, d));
        // A menu-only action is no toolbar button.
        expect(host.querySelector('.vela-dpop [data-drawing-action="export"]')).toBeNull();

        const rows = overflowRows(host);
        expect(rows.map((r) => r.textContent)).toEqual(['Duplicate', 'Bring to front', 'Send to back', 'Reset settings', 'Export']);
        expect(rows.map((r) => r.dataset.drawingAction)).toEqual([undefined, undefined, undefined, undefined, 'export']);
        expect(rows[4]!.querySelector('svg')).not.toBeNull();
        rows[4]!.click();
        expect(runs).toEqual(['export']);

        // Registered after the toolbar opened: the next open shows it.
        extras.push(view({ id: 'share', label: 'Share', menu: true }, runs));
        expect(overflowRows(host).map((r) => r.textContent)).toEqual(['Duplicate', 'Bring to front', 'Send to back', 'Reset settings', 'Export', 'Share']);
    });

    it('the overflow menu of a multi-selection keeps to its own rows', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const a = line();
        const b = createDrawing('hline', { id: 'h2', paneId: 'price', anchors: [{ time: 0, price: 120 }] })!;
        new DrawingSettingsPopup(host, DARK_THEME).open([a, b], null, actionsWith([view({ menu: true }, [])], a));
        expect(overflowRows(host).map((r) => r.textContent)).toEqual(['Duplicate', 'Bring to front', 'Send to back', 'Reset settings']);
    });

    it('the toolbar shows the action before the settings wheel, and a click runs it', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const runs: string[] = [];
        const d = line();
        new DrawingSettingsPopup(host, DARK_THEME).open([d], null, actionsWith([view({}, runs), view({ id: 'dialog-only', toolbar: false }, runs)], d));
        const btn = host.querySelector<HTMLButtonElement>('.vela-dpop [data-drawing-action="alert"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Add alert');
        expect(btn!.dataset.tip).toBe('Add alert');
        expect(host.querySelector('.vela-dpop [data-drawing-action="dialog-only"]')).toBeNull();
        const gear = host.querySelector<HTMLButtonElement>('.vela-dpop [data-tip="Settings"]')!;
        expect(btn!.compareDocumentPosition(gear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        btn!.click();
        expect(runs).toEqual(['alert']);
    });

    it('a multi-selection toolbar leaves the actions out', () => {
        const host = document.createElement('div');
        document.body.append(host);
        const a = line();
        const b = createDrawing('hline', { id: 'h2', paneId: 'price', anchors: [{ time: 0, price: 120 }] })!;
        new DrawingSettingsPopup(host, DARK_THEME).open([a, b], null, actionsWith([view({}, [])], a));
        expect(host.querySelector('.vela-dpop')).not.toBeNull();
        expect(host.querySelector('[data-drawing-action]')).toBeNull();
    });

    it('the settings dialog shows the action in its footer, ahead of Cancel', async () => {
        const host = document.createElement('div');
        document.body.append(host);
        const runs: string[] = [];
        const d = line();
        const popup = new DrawingSettingsPopup(host, DARK_THEME);
        popup.open([d], null, actionsWith([view({}, runs), view({ id: 'bar-only', settings: false }, runs)], d));
        expect(popup.openPanel()).toBe(true);
        await settled();
        const footer = host.querySelector<HTMLElement>('.vela-dsp .vela-dialog-footer')!;
        const btn = footer.querySelector<HTMLButtonElement>('[data-drawing-action="alert"]');
        expect(btn?.textContent).toContain('Add alert');
        expect(footer.querySelector('[data-drawing-action="bar-only"]')).toBeNull();
        expect(footer.firstElementChild).toBe(btn);
        btn!.click();
        expect(runs).toEqual(['alert']);
    });
});
