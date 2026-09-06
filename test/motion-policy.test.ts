import { describe, expect, it, vi } from 'vitest';
import { Vela } from '../src/Vela';
import { resolveMotionPolicy } from '../src/core/options';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { applyMotionScope, ensureMotionStyles, MotionPreferenceController } from '../src/renderers/shared/motion';
import { mirrorPopoverMotionScope } from '../src/ui/components/popover/view';
import type { IChartRenderer } from '../src/core/ports/IChartRenderer';
import type { MotionPreferenceSource } from '../src/renderers/shared/motion';

function recordingRenderer() {
    const policies: unknown[] = [];
    const renderer = {
        name: 'motion-probe',
        features: [] as readonly string[],
        capabilities: {
            panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
            barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, inputsUI: true,
        },
        applyMotionPolicy: (policy: unknown) => policies.push(policy),
        applyFeature() {}, readFeature: () => undefined,
        mount() {}, setTheme() {}, resize() {}, destroy() {},
        setBars() {}, updateBar() {}, ensurePane() {}, removePane() {},
        mountIndicator: (model: { id: string }) => ({ id: model.id }),
        updateIndicator() {}, removeIndicator() {}, setIndicatorInputs() {},
        onInputChange: () => () => {}, onRemoveIndicator: () => () => {},
        onCrosshairMove: () => () => {}, onClick: () => () => {},
        getVisibleRange: () => null, setVisibleRange() {}, onViewportChange: () => () => {},
    } as unknown as IChartRenderer;
    return { renderer, policies };
}

describe('motion policy', () => {
    it('uses the system preference only when animations is omitted', () => {
        expect(resolveMotionPolicy(undefined, false)).toEqual({ reduced: false, animZoom: true, animPan: true, animLiveBar: 0, intro: true });
        expect(resolveMotionPolicy(undefined, true)).toEqual({ reduced: true, animZoom: false, animPan: false, animLiveBar: 0, intro: false });
        expect(resolveMotionPolicy(false, false).reduced).toBe(true);
        expect(resolveMotionPolicy(false, true).reduced).toBe(true);
        expect(resolveMotionPolicy(true, true)).toEqual({ reduced: false, animZoom: true, animPan: true, animLiveBar: 0, intro: true });
    });

    it('treats an object, including a partial one, as a whole host override', () => {
        expect(resolveMotionPolicy({}, true)).toEqual({ reduced: false, animZoom: true, animPan: true, animLiveBar: 0, intro: true });
        expect(resolveMotionPolicy({ pan: false, liveBar: 250 }, true)).toEqual({
            reduced: false,
            animZoom: true,
            animPan: false,
            animLiveBar: 250,
            intro: true,
        });
    });
});

describe('MotionPreferenceController', () => {
    it('observes live changes exactly once and removes the listener on destroy', () => {
        let listener: ((event: MediaQueryListEvent) => void) | null = null;
        const add = vi.fn((_type: string, cb: (event: MediaQueryListEvent) => void) => {
            listener = cb;
        });
        const remove = vi.fn();
        const mql = { matches: true, addEventListener: add, removeEventListener: remove } as unknown as MediaQueryList;
        const host = { ownerDocument: { defaultView: { matchMedia: vi.fn(() => mql) } } } as unknown as HTMLElement;
        const controller = new MotionPreferenceController(host);
        const seen: boolean[] = [];
        controller.onChange((value) => seen.push(value));

        expect(controller.reduced).toBe(true);
        listener!({ matches: false } as MediaQueryListEvent);
        listener!({ matches: false } as MediaQueryListEvent);
        expect(seen).toEqual([false]);

        controller.destroy();
        expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('does not touch matchMedia for an explicit host policy', () => {
        const matchMedia = vi.fn();
        const host = { ownerDocument: { defaultView: { matchMedia } } } as unknown as HTMLElement;
        const controller = new MotionPreferenceController(host, false);
        expect(controller.reduced).toBe(false);
        expect(matchMedia).not.toHaveBeenCalled();
    });
});

describe('portaled motion scope', () => {
    it('installs the scoped rule in both a trigger ShadowRoot and the document portal root', () => {
        const shadowStyles: Array<{ id?: string; textContent?: string }> = [];
        const documentStyles: Array<{ id?: string; textContent?: string }> = [];
        const shadow = {
            querySelector: () => shadowStyles[0] ?? null,
            appendChild: vi.fn((style: { id?: string; textContent?: string }) => { shadowStyles.push(style); }),
        };
        const doc = {
            head: {
                appendChild: vi.fn((style: { id?: string; textContent?: string }) => { documentStyles.push(style); }),
            },
            querySelector: () => documentStyles[0] ?? null,
            createElement: () => ({}),
        } as unknown as Document;
        const host = {
            ownerDocument: doc,
            getRootNode: () => shadow,
        } as unknown as HTMLElement;

        ensureMotionStyles(host);
        ensureMotionStyles(host);

        expect(shadowStyles).toHaveLength(1);
        expect(documentStyles).toHaveLength(1);
        expect(shadowStyles[0]?.textContent).toContain("[data-vela-motion='reduced']");
        expect(documentStyles[0]?.textContent).toContain("[data-vela-motion='reduced']");
    });

    it('installs CSS and projects reduced motion onto external dialog roots without marking the host', () => {
        const styles: Array<{ id?: string; textContent?: string }> = [];
        const appendChild = vi.fn((next: { id?: string; textContent?: string }) => { styles.push(next); });
        const doc = {
            head: { appendChild },
            querySelector: () => styles[0] ?? null,
            createElement: () => ({}),
        } as unknown as Document;
        const host = {
            ownerDocument: doc,
            getRootNode: () => doc,
        } as unknown as HTMLElement;
        const backdrop = { dataset: {} } as unknown as HTMLElement;
        const positioner = { dataset: {} } as unknown as HTMLElement;

        applyMotionScope(host, true, backdrop, positioner);
        expect(appendChild).toHaveBeenCalledOnce();
        expect(styles[0]).toMatchObject({ id: 'vela-reduced-motion' });
        expect(styles[0]?.textContent).toContain("[data-vela-motion='reduced']");
        expect(backdrop.dataset.velaMotion).toBe('reduced');
        expect(positioner.dataset.velaMotion).toBe('reduced');
        expect(host.dataset).toBeUndefined();

        applyMotionScope(host, false, backdrop, positioner);
        expect(appendChild).toHaveBeenCalledOnce();
        expect(backdrop.dataset.velaMotion).toBe('full');
        expect(positioner.dataset.velaMotion).toBe('full');
    });

    it('projects live reduced and full modes onto an open nested popover', () => {
        let notify: (() => void) | null = null;
        const observe = vi.fn();
        const disconnect = vi.fn();
        class FakeMutationObserver {
            constructor(cb: () => void) { notify = cb; }
            observe = observe;
            disconnect = disconnect;
        }
        const externalHost = { dataset: {} };
        const scope = {
            dataset: { velaMotion: 'full' },
            ownerDocument: { defaultView: { MutationObserver: FakeMutationObserver } },
        };
        const trigger = { closest: vi.fn(() => scope) };
        const popup = {
            dataset: {} as Record<string, string>,
            removeAttribute: vi.fn((name: string) => {
                if (name === 'data-vela-motion') delete popup.dataset.velaMotion;
            }),
        };

        const stop = mirrorPopoverMotionScope(
            trigger as unknown as HTMLElement,
            popup as unknown as HTMLElement,
        );

        expect(trigger.closest).toHaveBeenCalledWith('[data-vela-motion]');
        expect(observe).toHaveBeenCalledWith(scope, {
            attributes: true,
            attributeFilter: ['data-vela-motion'],
        });
        expect(popup.dataset.velaMotion).toBe('full');
        expect(externalHost.dataset).toEqual({});

        scope.dataset.velaMotion = 'reduced';
        notify!();
        expect(popup.dataset.velaMotion).toBe('reduced');

        scope.dataset.velaMotion = 'full';
        notify!();
        expect(popup.dataset.velaMotion).toBe('full');

        stop();
        expect(disconnect).toHaveBeenCalledOnce();
    });
});

describe('Vela motion preference lifecycle', () => {
    it('applies live changes and unsubscribes from an injected host-owned source', async () => {
        let reduced = true;
        let listener: ((value: boolean) => void) | null = null;
        const unsubscribe = vi.fn(() => { listener = null; });
        const emit = (value: boolean) => listener?.(value);
        const preference: MotionPreferenceSource = {
            get reduced() { return reduced; },
            onChange(cb) {
                listener = cb;
                return unsubscribe;
            },
        };
        const { renderer, policies } = recordingRenderer();
        const removeAttribute = vi.fn();
        const host = { dataset: {}, removeAttribute } as unknown as HTMLElement;
        const chart = new Vela(host, { volume: false }, {
            renderer,
            engines: [],
            dataFeed: {
                load: () => Promise.resolve([]),
                subscribe: () => () => {},
            },
            motionPreference: preference,
        });
        await chart.ready();

        expect(chart.reducedMotion).toBe(true);
        expect(policies).toEqual([resolveMotionPolicy(undefined, true)]);
        reduced = false;
        emit(false);
        expect(chart.reducedMotion).toBe(false);
        expect(policies).toEqual([
            resolveMotionPolicy(undefined, true),
            resolveMotionPolicy(undefined, false),
        ]);

        chart.destroy();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(removeAttribute).toHaveBeenCalledWith('data-vela-motion');
        emit(true);
        expect(policies).toHaveLength(2);
    });
});

type AnyNativeRenderer = Record<string, any>;

function nativeMotionHarness(): {
    renderer: NativeRenderer;
    native: AnyNativeRenderer;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
} {
    const renderer = new NativeRenderer();
    // Apply the policy before installing mount-owned collaborators. This is the same
    // ordering as Vela's constructor and keeps the harness free of DOM dependencies.
    renderer.applyMotionPolicy(resolveMotionPolicy(false, false));
    const native = renderer as unknown as AnyNativeRenderer;
    native.coords.setSize(800, 200, 1);
    native.coords.setBars(Array.from({ length: 100 }, (_, index) => (index + 1) * 1_000));
    native.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
    const start = vi.fn();
    const stop = vi.fn();
    const invalidate = vi.fn();
    native.animator = { active: false, start, stop };
    native.scheduler = { invalidate, flushNow: vi.fn() };
    native.emitViewportChange = vi.fn();
    return { renderer, native, start, stop, invalidate };
}

describe('NativeRenderer reduced-motion gates', () => {
    it('forwards live policy changes to both dialog controllers', () => {
        const renderer = new NativeRenderer();
        const native = renderer as unknown as AnyNativeRenderer;
        const setSettingsReduced = vi.fn();
        const setInputsReduced = vi.fn();
        native.settingsDialog = { setReducedMotion: setSettingsReduced };
        native.inputsUI = { setReducedMotion: setInputsReduced };

        renderer.applyMotionPolicy(resolveMotionPolicy(false, false));

        expect(setSettingsReduced).toHaveBeenCalledWith(true);
        expect(setInputsReduced).toHaveBeenCalledWith(true);
    });

    it('makes zoom, pan glides, fling, and intro immediate while preserving configured animation values', () => {
        const { renderer, native, start, invalidate } = nativeMotionHarness();
        const playIntro = vi.fn();
        native.playIntro = playIntro;
        const configured = renderer.getConfig();

        renderer.applyFeature('intro', 'wave');
        renderer.setBars(Array.from({ length: 100 }, (_, index) => ({
            time: (index + 1) * 1_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        })));
        native.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        native.zoomTo(20, 99, 800);
        expect(native.coords.getViewport()).toEqual({ barSpacing: 20, rightOffset: 0 });
        native.fling(0.5);
        native.glideRightOffset(6);
        expect(native.coords.getViewport()).toEqual({ barSpacing: 20, rightOffset: 6 });

        expect(start).not.toHaveBeenCalled();
        expect(invalidate).toHaveBeenCalledTimes(3);
        expect(playIntro).not.toHaveBeenCalled();
        expect(renderer.readFeature('animZoom')).toBe(true);
        expect(renderer.readFeature('animPan')).toBe(true);
        expect(renderer.readFeature('intro')).toBe('wave');
        expect(renderer.getConfig()).toEqual(configured);

        renderer.applyMotionPolicy(resolveMotionPolicy(true, true));
        native.zoomTo(30, 99, 800);
        native.fling(0.5);
        native.glideRightOffset(4);
        renderer.applyFeature('intro', 'wave');

        expect(start).toHaveBeenCalledTimes(3);
        expect(playIntro).toHaveBeenCalledOnce();
        expect(renderer.getConfig()).toEqual(configured);
    });

    it('settles active viewport targets and recomputes scales with the animator stopped', () => {
        const renderer = new NativeRenderer();
        const native = renderer as unknown as AnyNativeRenderer;
        native.coords.setSize(800, 200, 1);
        native.coords.setBars(Array.from({ length: 100 }, (_, index) => (index + 1) * 1_000));
        native.coords.setViewport({ barSpacing: 10, rightOffset: 5 });
        native.targetBarSpacing = 20;
        native.zoomAnchorLogical = 99;
        native.zoomAnchorX = 800;
        native.scrollTargetRO = 6;
        native.panVelocity = 0.5;
        const animator = { active: true, start: vi.fn(), stop: vi.fn() };
        animator.stop.mockImplementation(() => { animator.active = false; });
        const flushNow = vi.fn();
        const computeScales = vi.fn(() => expect(animator.active).toBe(false));
        native.animator = animator;
        native.scheduler = { invalidate: vi.fn(), flushNow };
        native.computeScales = computeScales;
        native.emitViewportChange = vi.fn();

        renderer.applyMotionPolicy(resolveMotionPolicy(undefined, true));

        expect(native.coords.getViewport()).toEqual({ barSpacing: 20, rightOffset: 6 });
        expect(native.targetBarSpacing).toBe(20);
        expect(native.scrollTargetRO).toBeNull();
        expect(native.panVelocity).toBe(0);
        expect(animator.stop).toHaveBeenCalledOnce();
        expect(computeScales).toHaveBeenCalledOnce();
        expect(flushNow).toHaveBeenCalledOnce();
    });

    it('marks SDK layer frames reduced and does not let an animating layer restart the animator', () => {
        const renderer = new NativeRenderer();
        renderer.applyMotionPolicy(resolveMotionPolicy(false, false));
        const native = renderer as unknown as AnyNativeRenderer;
        const pane = native.scene.ensurePane('price', 'price', 0, 3);
        pane.bounds = { top: 0, height: 200 };
        const reducedFlags: boolean[] = [];
        const start = vi.fn();
        native.extLayers = [{
            def: { id: 'motion-probe', repaintOnCursor: true },
            instance: {
                render: (args: { reducedMotion: boolean }) => reducedFlags.push(args.reducedMotion),
                animating: () => true,
            },
            canvas: {},
        }];
        native.animator = { active: false, start, stop: vi.fn() };
        native.syncLayerCanvasOrder = () => undefined;
        native.stampScaleInvert = () => undefined;
        native.backend = {
            modelAlpha: 1,
            candleBodyAlpha: 1,
            candleStructureAlpha: 1,
            candleBodyScale: 1,
            render: vi.fn(),
        };
        native.volumeRenderer = { render: vi.fn() };
        native.vpvrRenderer = { render: vi.fn() };
        native.indicatorSlices = { prepare: () => new Map() };
        native.dataCanvas = {};
        native.backdropRenderer = { render: vi.fn() };
        native.chrome = { render: vi.fn() };
        native.axisSurface = () => ({});

        native.paintData();
        native.repaintCursorLayers();
        expect(reducedFlags).toEqual([true, true]);
        expect(start).not.toHaveBeenCalled();

        renderer.applyMotionPolicy(resolveMotionPolicy(true, true));
        native.paintData();
        native.repaintCursorLayers();
        expect(reducedFlags).toEqual([true, true, false, false]);
        expect(start).toHaveBeenCalledTimes(2);
    });
});
