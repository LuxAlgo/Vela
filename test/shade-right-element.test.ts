// @vitest-environment jsdom
// The `.vela-shade-right` element: a host-styleable twin of the `crosshairOverride.shadeRight`
// veil. The crosshair layer reports the area it veiled each frame; the native renderer keeps
// the element on exactly that area, hidden whenever no veil is painted, and writes the DOM
// only when that area changes (the crosshair repaints on every pointer move).
import { describe, it, expect } from 'vitest';
import { CrosshairRenderer } from '../src/renderers/native/chrome/CrosshairRenderer';
import { NativeRenderer } from '../src/renderers/native/NativeRenderer';
import { sanitizeCrosshairOverride } from '../src/renderers/native/core/chartConfig';
import { SceneGraph } from '../src/renderers/native/core/SceneGraph';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { DARK_THEME } from '../src/core/theme';

/** A 2d context that accepts every call the crosshair layer makes. */
function canvas(width = 400, height = 300): HTMLCanvasElement {
    const ctx = {
        font: '',
        textBaseline: '',
        textAlign: '',
        strokeStyle: '',
        fillStyle: '',
        lineWidth: 1,
        globalAlpha: 1,
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        setLineDash() {},
        fillRect() {},
        fillText() {},
        measureText: (t: string) => ({ width: t.length * 6 }),
    };
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

describe('CrosshairRenderer.shadeRightArea', () => {
    type Ghost = { x: number; y: number | null; time: number; price?: number | null; line?: boolean };

    function frame(override: unknown, opts: { local?: { x: number; y: number } | null; ghost?: Ghost } = {}) {
        const cr = new CrosshairRenderer();
        cr.mount(canvas());
        const scene = new SceneGraph();
        scene.crosshair = opts.local === undefined ? { x: 100, y: 120 } : opts.local;
        scene.crosshairOverride = sanitizeCrosshairOverride(override);
        scene.panes.set('price', { id: 'price', kind: 'price', bounds: { top: 0, height: 280 }, scale: { min: 0, max: 100 } } as never);
        const coords = {
            dpr: 1,
            width: 380,
            height: 280,
            barInterval: 3_600_000,
            xToLogical: (x: number) => x / 10,
            logicalToX: (l: number) => l * 10,
            logicalToTime: (l: number) => 1_700_000_000_000 + l * 3_600_000,
            yToPrice: () => 50,
        } as unknown as CoordinateSystem;
        cr.render(scene, coords, DARK_THEME, null, opts.ghost ?? null);
        return cr;
    }

    const veil = { horizontal: false, shadeRight: { color: '#101010', opacity: 0.6 } };

    it('is the veiled area: from the bar right edge to the price scale, full plot height', () => {
        // cursor x=100 → bar 10; its right edge is logical 10.5 → x=105; the plot is 380×280
        expect(frame(veil).shadeRightArea).toEqual({ x: 105, width: 275, height: 280 });
    });

    it('is null when nothing is veiled: no override, no shadeRight, no vertical line, or no crosshair', () => {
        expect(frame(null).shadeRightArea).toBeNull();
        expect(frame({ horizontal: false }).shadeRightArea).toBeNull();
        expect(frame({ ...veil, vertical: false }).shadeRightArea).toBeNull();
        expect(frame(veil, { local: null }).shadeRightArea).toBeNull();
        expect(frame(veil, { local: { x: 379, y: 120 } }).shadeRightArea).toBeNull(); // the last bar's edge is the scale itself
    });

    it('a transparent veil still counts — the element is how a host styles it', () => {
        expect(frame({ shadeRight: { color: 'rgba(0,0,0,0)' } }).shadeRightArea).toEqual({ x: 105, width: 275, height: 280 });
    });

    it('covers the synced ghost path, and the union when both crosshairs veil', () => {
        const ghost = { x: 200, y: 90, time: 1_700_000_000_000, price: 42 };
        expect(frame(veil, { local: null, ghost }).shadeRightArea).toEqual({ x: 205, width: 175, height: 280 });
        expect(frame(veil, { local: null, ghost: { x: -50, y: null, time: 1_700_000_000_000, line: false } }).shadeRightArea).toEqual({ x: 0, width: 380, height: 280 });
        expect(frame(veil, { ghost }).shadeRightArea).toEqual({ x: 105, width: 275, height: 280 });
        expect(frame(veil, { local: { x: 300, y: 120 }, ghost }).shadeRightArea).toEqual({ x: 205, width: 175, height: 280 });
        expect(frame(null, { local: null, ghost }).shadeRightArea).toBeNull();
    });
});

describe('the .vela-shade-right element', () => {
    /** A stand-in element that counts every style/visibility write. */
    function fakeElement() {
        let writes = 0;
        let hidden = true;
        const style = new Proxy({ display: 'none' } as Record<string, string>, {
            set(target, key, value) {
                writes += 1;
                target[key as string] = value;
                return true;
            },
        });
        const el = {
            style,
            get hidden() {
                return hidden;
            },
            set hidden(v: boolean) {
                writes += 1;
                hidden = v;
            },
        };
        return { el, writes: () => writes };
    }

    function setup() {
        const r = new NativeRenderer();
        const internals = r as unknown as {
            coords: CoordinateSystem;
            scene: SceneGraph;
            crosshairLayer: CrosshairRenderer;
            shadeRightEl: unknown;
            externalCross: { time: number; price: number | null } | null;
            renderCrosshairLayer(): void;
        };
        internals.coords.setSize(380, 280, 1);
        internals.coords.setBars(Array.from({ length: 60 }, (_, i) => 1_700_000_000_000 + i * 3_600_000));
        internals.crosshairLayer.mount(canvas());
        const fake = fakeElement();
        internals.shadeRightEl = fake.el;
        return { r, internals, ...fake };
    }

    it('follows shadeRight: on the veiled area while it paints, hidden otherwise, with no DOM write on an unchanged frame', () => {
        const { r, internals, el, writes } = setup();
        const c = internals.coords;
        const edge = (x: number) => Math.round(c.logicalToX(Math.round(c.xToLogical(x)) + 0.5));

        internals.scene.crosshair = { x: 100, y: 120 };
        internals.renderCrosshairLayer();
        expect(el.hidden).toBe(true); // no override yet: nothing veiled
        expect(writes()).toBe(0);

        r.applyFeature('crosshairOverride', { horizontal: false, shadeRight: { color: 'rgba(0,0,0,0.3)' } });
        internals.renderCrosshairLayer();
        const left = edge(100);
        expect(el.hidden).toBe(false);
        expect(el.style).toMatchObject({ left: `${left}px`, width: `${380 - left}px`, height: '280px', display: '' });

        const after = writes();
        internals.scene.crosshair = { x: 101, y: 200 }; // same bar, another level: same veil
        internals.renderCrosshairLayer();
        expect(writes()).toBe(after);

        internals.scene.crosshair = { x: 200, y: 120 }; // another bar: the element follows
        internals.renderCrosshairLayer();
        expect(writes()).toBeGreaterThan(after);
        expect(el.style.left).toBe(`${edge(200)}px`);

        internals.scene.crosshair = null; // pointer left the plot: no veil
        internals.renderCrosshairLayer();
        expect(el.hidden).toBe(true);
        expect(el.style.display).toBe('none');

        internals.scene.crosshair = { x: 200, y: 120 };
        r.applyFeature('crosshairOverride', null);
        const hiddenWrites = writes();
        internals.renderCrosshairLayer();
        expect(el.hidden).toBe(true);
        expect(writes()).toBe(hiddenWrites); // already hidden: untouched
    });

    it('tracks the synced ghost veil too', () => {
        const { r, internals, el } = setup();
        r.applyFeature('crosshairOverride', { shadeRight: { color: '#000', opacity: 0.4 } });
        internals.externalCross = { time: 1_700_000_000_000 + 40 * 3_600_000, price: null };
        internals.renderCrosshairLayer();
        const c = internals.coords;
        const left = Math.round(c.logicalToX(40.5));
        expect(el.hidden).toBe(false);
        expect(el.style).toMatchObject({ left: `${left}px`, width: `${380 - left}px`, height: '280px' });
    });
});
