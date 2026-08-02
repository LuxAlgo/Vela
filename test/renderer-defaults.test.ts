// Renderer feature DEFAULTS: the registry itself, and the two things that make it useful
// to a plugin — every chart built afterwards picks them up (a bare chart included), and
// they are defaults, not locks. The `attribution` feature's string form rides along, since
// it is the first feature a plugin defaults for a whole app.
import { describe, it, expect, afterEach } from 'vitest';
import { registerRendererDefaults, unregisterRendererDefaults, rendererDefaults } from '../src/core/renderer-defaults';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { Vela } from '../src/index';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';

afterEach(() => unregisterRendererDefaults());

/** Records what the chart pushes through the feature channel. Only the members a bare,
 *  data-less chart touches are real; the rest satisfy the port. */
function recordingRenderer() {
    const applied: Array<[string, unknown]> = [];
    const renderer = {
        name: 'fake',
        features: ['attribution', 'gridlines'] as readonly string[],
        capabilities: {
            panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
            barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
        },
        applyFeature: (key: string, value: unknown) => void applied.push([key, value]),
        readFeature: () => undefined,
        mount() {}, setTheme() {}, resize() {}, destroy() {},
        setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
        mountIndicator: (m: { id: string }) => ({ id: m.id }),
        updateIndicator() {}, removeIndicator() {}, setIndicatorInputs() {},
        onInputChange: () => () => {}, onRemoveIndicator: () => () => {},
        onCrosshairMove: () => () => {}, onClick: () => () => {},
        getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
    } as unknown as IChartRenderer;
    return { renderer, applied };
}

describe('defaults reach the charts built afterwards', () => {
    it('a chart applies every registered default at construction', () => {
        registerRendererDefaults({ attribution: false, gridlines: false });
        const { renderer, applied } = recordingRenderer();
        new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [] });
        expect(applied).toEqual(expect.arrayContaining([['attribution', false], ['gridlines', false]]));
    });

    it('a chart built BEFORE the registration is untouched, and an empty registry pushes nothing', () => {
        const before = recordingRenderer();
        new Vela({} as unknown as HTMLElement, { live: false }, { renderer: before.renderer, engines: [] });
        expect(before.applied).toEqual([]); // nothing registered yet

        registerRendererDefaults({ attribution: false });
        expect(before.applied).toEqual([]); // …and registering later does not reach back
    });

    it('they are defaults, not locks: an explicit set afterwards wins', () => {
        registerRendererDefaults({ attribution: false });
        const { renderer, applied } = recordingRenderer();
        const chart = new Vela({} as unknown as HTMLElement, { live: false }, { renderer, engines: [] });
        chart.renderer.set('attribution', '<b>ACME</b>');
        expect(applied).toEqual([['attribution', false], ['attribution', '<b>ACME</b>']]);
    });
});

describe('the renderer-defaults registry', () => {
    it('starts empty and collects what is registered', () => {
        expect(rendererDefaults()).toEqual({});
        registerRendererDefaults({ attribution: false, gridlines: false });
        expect(rendererDefaults()).toEqual({ attribution: false, gridlines: false });
    });

    it('merges registrations, last write winning per key', () => {
        registerRendererDefaults({ attribution: false, gridlines: false });
        registerRendererDefaults({ attribution: '<b>ACME</b>' });
        expect(rendererDefaults()).toEqual({ attribution: '<b>ACME</b>', gridlines: false });
    });

    it('the disposer removes exactly what it set, and never a newer value', () => {
        const dispose = registerRendererDefaults({ attribution: false, gridlines: false });
        registerRendererDefaults({ attribution: '<b>ACME</b>' }); // a later, different value
        dispose();
        expect(rendererDefaults()).toEqual({ attribution: '<b>ACME</b>' }); // kept; gridlines dropped
    });

    it('unregister drops by key, or everything when given none', () => {
        registerRendererDefaults({ attribution: false, gridlines: false });
        unregisterRendererDefaults('gridlines');
        expect(rendererDefaults()).toEqual({ attribution: false });
        unregisterRendererDefaults();
        expect(rendererDefaults()).toEqual({});
    });

    it('hands out a snapshot — mutating it cannot poison the registry', () => {
        registerRendererDefaults({ gridlines: false });
        const snapshot = rendererDefaults();
        snapshot.gridlines = true;
        snapshot.injected = 'nope';
        expect(rendererDefaults()).toEqual({ gridlines: false });
    });
});

describe('the attribution feature takes host content', () => {
    it('reads back false / true / the html string', () => {
        const r = new NativeRenderer();
        expect(r.readFeature('attribution')).toBe(true); // the built-in mark, by default

        r.applyFeature('attribution', false);
        expect(r.readFeature('attribution')).toBe(false);

        r.applyFeature('attribution', '<img src="/acme.svg">');
        expect(r.readFeature('attribution')).toBe('<img src="/acme.svg">');

        r.applyFeature('attribution', true); // back to Vela's own mark
        expect(r.readFeature('attribution')).toBe(true);
    });

    it('a blank string is not content — it reads as the boolean it is', () => {
        const r = new NativeRenderer();
        r.applyFeature('attribution', '   ');
        expect(r.readFeature('attribution')).toBe(true); // truthy value, built-in mark
    });

    it('setting content on an unmounted renderer is remembered for mount', () => {
        // The mark element only exists after mount(); a plugin's default lands well before.
        const r = new NativeRenderer();
        expect(() => r.applyFeature('attribution', '<b>ACME</b>')).not.toThrow();
        expect(r.readFeature('attribution')).toBe('<b>ACME</b>');
    });
});
