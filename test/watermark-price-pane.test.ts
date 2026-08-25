import { describe, it, expect } from 'vitest';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';

// TIME_AXIS_H in NativeRenderer — the overlay bottom inset includes this strip so the
// mark stays in the price pane's data area, not the time axis.
const TIME_AXIS_H = 22;
const DATA_H = 400;

type OverlayHost = {
    style: {
        setProperty: (k: string, v: string) => void;
        getPropertyValue: (k: string) => string;
        removeProperty: (k: string) => void;
    };
};

function fakeHost(): OverlayHost {
    const props = new Map<string, string>();
    return {
        style: {
            setProperty: (k, v) => { props.set(k, v); },
            getPropertyValue: (k) => props.get(k) ?? '',
            removeProperty: (k) => { props.delete(k); },
        },
    };
}

type LayoutPriv = {
    scene: SceneGraph;
    coords: CoordinateSystem;
    mountContainer: OverlayHost | null;
    maximizedPaneId: string | null;
    layoutPanes: () => void;
};

function primed(extra?: (scene: SceneGraph) => void): { r: LayoutPriv; host: OverlayHost } {
    const renderer = new NativeRenderer();
    const r = renderer as unknown as LayoutPriv;
    const host = fakeHost();
    r.mountContainer = host;
    r.coords.setSize(800, DATA_H, 1);
    r.scene.ensurePane('price', 'price', 0, 3);
    extra?.(r.scene);
    r.layoutPanes();
    return { r, host };
}

describe('price-pane overlay insets (symbol watermark clip)', () => {
    it('with only the price pane, the bottom inset is just the time axis', () => {
        const { host } = primed();
        expect(host.style.getPropertyValue('--vela-price-pane-top')).toBe('0px');
        expect(host.style.getPropertyValue('--vela-price-pane-bottom')).toBe(`${TIME_AXIS_H}px`);
    });

    it('with a study pane below, the bottom inset covers the study plus the time axis', () => {
        // Weights 3 + 1 on a 400px data area → price 300, study 100.
        const { host } = primed((scene) => {
            scene.ensurePane('rsi', 'study', 1, 1);
        });
        expect(host.style.getPropertyValue('--vela-price-pane-top')).toBe('0px');
        expect(host.style.getPropertyValue('--vela-price-pane-bottom')).toBe(`${100 + TIME_AXIS_H}px`);
    });

    it('a maximized study pane collapses the overlay to zero height', () => {
        const { r, host } = primed((scene) => {
            scene.ensurePane('rsi', 'study', 1, 1);
        });
        r.maximizedPaneId = 'rsi';
        r.layoutPanes();
        const top = Number.parseFloat(host.style.getPropertyValue('--vela-price-pane-top'));
        const bottom = Number.parseFloat(host.style.getPropertyValue('--vela-price-pane-bottom'));
        // Overlay height = plotH − top − bottom. plotH = data + time axis.
        expect(DATA_H + TIME_AXIS_H - top - bottom).toBe(0);
    });
});

// COLLAPSED_PANE_H in NativeRenderer — the strip a collapsed pane keeps (legend + expand chip).
const COLLAPSED_PANE_H = 26;

describe('bottom-gutter inset (host overlays above the bottom chrome)', () => {
    it('with every pane open, the gutter is just the time axis', () => {
        const { host } = primed((scene) => {
            scene.ensurePane('rsi', 'study', 1, 1);
        });
        expect(host.style.getPropertyValue('--vela-bottom-gutter')).toBe(`${TIME_AXIS_H}px`);
    });

    it('a collapsed bottom pane pushes the gutter up by its strip', () => {
        // The regression case: the ONLY study pane collapses — an overlay anchored to
        // the gutter (the workspace attribution mark) must climb above the strip
        // instead of overlapping its legend row.
        const { r, host } = primed((scene) => {
            scene.ensurePane('rsi', 'study', 1, 1);
        });
        r.scene.panes.get('rsi')!.collapsed = true;
        r.layoutPanes();
        expect(host.style.getPropertyValue('--vela-bottom-gutter')).toBe(`${TIME_AXIS_H + COLLAPSED_PANE_H}px`);
    });

    it('a maximized pane fills the plot — the gutter drops back to the time axis', () => {
        const { r, host } = primed((scene) => {
            scene.ensurePane('rsi', 'study', 1, 1);
        });
        r.scene.panes.get('rsi')!.collapsed = true;
        r.layoutPanes();
        r.maximizedPaneId = 'price';
        r.layoutPanes();
        expect(host.style.getPropertyValue('--vela-bottom-gutter')).toBe(`${TIME_AXIS_H}px`);
    });
});
