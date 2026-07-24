import { describe, it, expect } from 'vitest';
import type { OHLCV } from '../src/core/model/ohlcv';
import type { VelaTheme } from '../src/core/options';
import { CoordinateSystem } from '../src/renderers/native/core/CoordinateSystem';
import { VolumeRenderer } from '../src/renderers/native/volume/VolumeRenderer';
import { VpvrRenderer } from '../src/renderers/native/vpvr/VpvrRenderer';
import { VOLUME_FILL_ALPHA } from '../src/renderers/native/volume/paintVolume';

/**
 * The bespoke volume layers (bottom-anchored volume columns + the visible-range volume
 * profile) paint on their own canvases with their OWN scales — these tests drive each
 * layer with a recording 2d context and assert the geometry/colors, in particular that
 * neither ever consults the pane's PRICE scale for its volume axis.
 */

const THEME: VelaTheme = {
    background: '#000000',
    textColor: '#cccccc',
    gridColor: '#222222',
    borderColor: '#333333',
    upColor: '#00AA00',
    downColor: '#AA0000',
    fontFamily: 'sans-serif',
};

interface Rect { op: 'fill' | 'stroke'; style: string; x: number; y: number; w: number; h: number; alpha: number }

/** A minimal recording CanvasRenderingContext2D: rect ops with their style/alpha/coords. */
function recordingCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[] } {
    const rects: Rect[] = [];
    const state = { fillStyle: '', strokeStyle: '', alpha: 1 };
    const noop = (): void => undefined;
    const ctx = {
        set fillStyle(v: string) { state.fillStyle = v; },
        get fillStyle() { return state.fillStyle; },
        set strokeStyle(v: string) { state.strokeStyle = v; },
        get strokeStyle() { return state.strokeStyle; },
        set globalAlpha(v: number) { state.alpha = v; },
        get globalAlpha() { return state.alpha; },
        lineWidth: 1,
        setTransform: noop, clearRect: noop, save: noop, restore: noop,
        beginPath: noop, rect: noop, clip: noop,
        fillRect: (x: number, y: number, w: number, h: number) => rects.push({ op: 'fill', style: state.fillStyle, x, y, w, h, alpha: state.alpha }),
        strokeRect: (x: number, y: number, w: number, h: number) => rects.push({ op: 'stroke', style: state.strokeStyle, x, y, w, h, alpha: state.alpha }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, rects };
}

const W = 300;
const H = 200;

function makeCoords(n: number): CoordinateSystem {
    const coords = new CoordinateSystem();
    coords.setSize(W, H, 1);
    coords.setBars(Array.from({ length: n }, (_, i) => i * 60_000));
    coords.setViewport({ barSpacing: 20, rightOffset: 2 });
    return coords;
}

function upBar(i: number, volume?: number): OHLCV {
    return { time: i * 60_000, open: 100, high: 106, low: 99, close: 105, ...(volume != null ? { volume } : {}) };
}

function downBar(i: number, volume: number): OHLCV {
    return { time: i * 60_000, open: 105, high: 106, low: 99, close: 100, volume };
}

describe('VolumeRenderer (bottom-anchored volume columns)', () => {
    const BOUNDS = { top: 0, height: H };
    const DATA = { upColor: '#11AA11', downColor: '#AA1111', heightFrac: 0.2 };

    function render(bars: OHLCV[], data = DATA, visible = true, fillPane = false): Rect[] {
        const layer = new VolumeRenderer();
        const { ctx, rects } = recordingCtx();
        layer.mount({ width: W, height: H, getContext: () => ctx } as unknown as HTMLCanvasElement);
        layer.render({ bars, data, visible, coords: makeCoords(bars.length), bounds: BOUNDS, fillPane });
        return rects;
    }

    it('anchors every column to the pane bottom, tallest = heightFrac of the pane', () => {
        const rects = render([upBar(0, 50), upBar(1, 100), upBar(2, 25)]);
        expect(rects).toHaveLength(3);
        for (const r of rects) expect(r.y + r.h).toBeCloseTo(H, 6); // bottom-anchored
        const tallest = Math.max(...rects.map((r) => r.h));
        expect(tallest).toBeCloseTo(H * DATA.heightFrac, 6); // the layer's OWN scale: visible max → heightFrac
        // Heights are proportional to volume, NOT mapped through any price scale.
        const sorted = rects.map((r) => r.h).sort((a, b) => a - b);
        expect(sorted[0]).toBeCloseTo(tallest / 4, 6);
        expect(sorted[1]).toBeCloseTo(tallest / 2, 6);
    });

    it('colors columns by bar direction and paints translucent', () => {
        const rects = render([upBar(0, 50), downBar(1, 50)]);
        expect(rects.map((r) => r.style)).toEqual(['#11AA11', '#AA1111']);
        for (const r of rects) expect(r.alpha).toBeCloseTo(VOLUME_FILL_ALPHA, 6);
    });

    it('skips bars without volume and paints nothing when hidden or unconfigured', () => {
        expect(render([upBar(0), upBar(1, 80)])).toHaveLength(1); // volume is optional on OHLCV
        expect(render([upBar(0, 80)], DATA, false)).toHaveLength(0); // hidden via the legend eye
        expect(render([upBar(0, 80)], null as unknown as typeof DATA)).toHaveLength(0); // layer off
    });

    it('fills the pane (heightFrac ignored) when the indicator sits in its own pane', () => {
        const rects = render([upBar(0, 50), upBar(1, 100)], DATA, true, true);
        const tallest = Math.max(...rects.map((r) => r.h));
        expect(tallest).toBeCloseTo(H * 0.96, 6); // near-full pane height in a dedicated pane
    });
});

describe('VpvrRenderer (visible-range volume profile)', () => {
    const BOUNDS = { top: 0, height: H };
    const SCALE = { min: 95, max: 110 };
    const DATA = { rows: 10, widthFrac: 0.3, upColor: '#2962FF', downColor: '#F7525F', showPoc: true, valueAreaFrac: 0.7 };

    function render(bars: OHLCV[], data = DATA, visible = true): Rect[] {
        const layer = new VpvrRenderer();
        const { ctx, rects } = recordingCtx();
        layer.mount({ width: W, height: H, getContext: () => ctx } as unknown as HTMLCanvasElement);
        layer.render({ bars, data, visible, coords: makeCoords(bars.length), scale: SCALE, bounds: BOUNDS, theme: THEME });
        return rects;
    }

    it('anchors rows to the right edge with widths on the profile’s own horizontal scale', () => {
        const rects = render([upBar(0, 100), upBar(1, 100)]);
        const fills = rects.filter((r) => r.op === 'fill');
        expect(fills.length).toBeGreaterThan(0);
        const maxW = W * DATA.widthFrac;
        for (const r of fills) {
            expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-6); // never past the right edge
            expect(r.w).toBeLessThanOrEqual(maxW + 1e-6); // capped at widthFrac of the pane
        }
        expect(Math.max(...fills.map((r) => r.x + r.w))).toBeCloseTo(W, 6); // rows hug the edge
    });

    it('outlines the POC row across the full profile width (and omits it when off)', () => {
        const bars = [upBar(0, 100), upBar(1, 100)];
        const strokes = render(bars).filter((r) => r.op === 'stroke');
        expect(strokes).toHaveLength(1);
        expect(strokes[0]!.style).toBe(THEME.textColor);
        expect(strokes[0]!.w).toBeCloseTo(W * DATA.widthFrac - 1, 6);
        expect(render(bars, { ...DATA, showPoc: false }).filter((r) => r.op === 'stroke')).toHaveLength(0);
    });

    it('splits each row into up (left) and down (right, against the axis) segments', () => {
        // Equal up/down volume over one flat price range → each row = two half-width segments.
        const rects = render([upBar(0, 100), downBar(1, 100)]).filter((r) => r.op === 'fill');
        const upSegs = rects.filter((r) => r.style === DATA.upColor);
        const downSegs = rects.filter((r) => r.style === DATA.downColor);
        expect(upSegs.length).toBeGreaterThan(0);
        expect(upSegs.length).toBe(downSegs.length);
        for (const d of downSegs) expect(d.x + d.w).toBeCloseTo(W, 6); // down hugs the axis
        for (const u of upSegs) {
            const mate = downSegs.find((d) => Math.abs(d.y - u.y) < 1e-6)!;
            expect(u.x + u.w).toBeCloseTo(mate.x, 6); // up sits immediately left of down
            expect(u.w).toBeCloseTo(mate.w, 6); // equal volume → equal halves
        }
    });

    it('paints nothing when hidden, unconfigured, or volumeless', () => {
        expect(render([upBar(0, 80)], DATA, false)).toHaveLength(0);
        expect(render([upBar(0, 80)], null as unknown as typeof DATA)).toHaveLength(0);
        expect(render([upBar(0)])).toHaveLength(0); // no volume anywhere → no profile
    });
});
