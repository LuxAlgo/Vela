// A stand-in 2D canvas for jsdom, which paints nothing. It lets the real renderer run and
// records every text it paints, with the direction a browser would lay that text out in:
// a context's `direction` starts at 'inherit', which takes the canvas element's direction
// (its nearest `dir`, so the page's when nothing closer says otherwise; a detached canvas
// reads left to right), and resizing the canvas resets it. Elements measure 800 × 400.

export type Direction = 'ltr' | 'rtl';

export interface PaintedText {
    text: string;
    direction: Direction;
    canvas: HTMLCanvasElement;
    /** Where the text was painted, in the canvas's own coordinates. */
    x: number;
    y: number;
}

/** Every text painted since the last reset (empty it between tests). */
export const painted: PaintedText[] = [];

const contexts = new WeakMap<HTMLCanvasElement, { reset(): void; ctx: CanvasRenderingContext2D }>();

/** The direction a context set to 'inherit' lays text out in. */
function inheritedDirection(canvas: HTMLCanvasElement): Direction {
    if (!canvas.isConnected) return 'ltr';
    return canvas.closest('[dir]')?.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
}

/** A 2D context that accepts every call the renderer makes and records each text it paints. */
function standInContext(canvas: HTMLCanvasElement): { reset(): void; ctx: CanvasRenderingContext2D } {
    const fresh = (): Record<string, unknown> => ({
        direction: 'inherit',
        font: '10px sans-serif',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        fillStyle: '#000000',
        strokeStyle: '#000000',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        lineDashOffset: 0,
        miterLimit: 10,
        shadowBlur: 0,
        shadowColor: 'rgba(0, 0, 0, 0)',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        imageSmoothingEnabled: true,
        filter: 'none',
        letterSpacing: '0px',
    });
    let state = fresh();
    const saved: Array<Record<string, unknown>> = [];
    const paint = (text: unknown, x: unknown, y: unknown): void => {
        const direction = state.direction === 'inherit' ? inheritedDirection(canvas) : (state.direction as Direction);
        painted.push({ text: String(text), direction, canvas, x: Number(x), y: Number(y) });
    };
    const methods: Record<string, unknown> = {
        save: () => saved.push({ ...state }),
        restore: () => {
            const s = saved.pop();
            if (s) state = s;
        },
        fillText: paint,
        strokeText: paint,
        measureText: (text: string) => {
            const width = String(text).length * 6;
            return {
                width,
                actualBoundingBoxLeft: 0,
                actualBoundingBoxRight: width,
                actualBoundingBoxAscent: 7,
                actualBoundingBoxDescent: 2,
                fontBoundingBoxAscent: 8,
                fontBoundingBoxDescent: 2,
            };
        },
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createConicGradient: () => ({ addColorStop() {} }),
        createPattern: () => null,
        getLineDash: () => [],
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
        isPointInPath: () => false,
        isPointInStroke: () => false,
    };
    const ctx = new Proxy(
        {},
        {
            get: (_t, key) => {
                if (key === 'canvas') return canvas;
                if (typeof key === 'string' && key in state) return state[key];
                if (typeof key === 'string' && key in methods) return methods[key];
                return () => undefined;
            },
            set: (_t, key, value) => {
                if (typeof key === 'string') state[key] = value;
                return true;
            },
        },
    ) as CanvasRenderingContext2D;
    return {
        ctx,
        reset: () => {
            state = fresh();
            saved.length = 0;
        },
    };
}

/** Resizing a canvas resets its context's state, `direction` included. */
function resettingOnResize(original: PropertyDescriptor): PropertyDescriptor {
    return {
        ...original,
        set(this: HTMLCanvasElement, v: number) {
            original.set!.call(this, v);
            contexts.get(this)?.reset();
        },
    };
}

/**
 * Give every canvas the stand-in 2D context (and no WebGL, so the renderer takes its canvas2d
 * backend), and lay every element out at 800 × 400. Returns the function that restores jsdom.
 */
export function installCanvasStandIn(): () => void {
    const canvasProto = HTMLCanvasElement.prototype;
    const originalGetContext = canvasProto.getContext;
    const originalWidth = Object.getOwnPropertyDescriptor(canvasProto, 'width')!;
    const originalHeight = Object.getOwnPropertyDescriptor(canvasProto, 'height')!;
    const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
    const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')!;
    const originalRect = Element.prototype.getBoundingClientRect;

    canvasProto.getContext = function (this: HTMLCanvasElement, kind: string) {
        if (kind !== '2d') return null;
        let entry = contexts.get(this);
        if (!entry) {
            entry = standInContext(this);
            contexts.set(this, entry);
        }
        return entry.ctx;
    } as typeof canvasProto.getContext;
    Object.defineProperty(canvasProto, 'width', resettingOnResize(originalWidth));
    Object.defineProperty(canvasProto, 'height', resettingOnResize(originalHeight));
    // jsdom has no layout of its own.
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    Element.prototype.getBoundingClientRect = () =>
        ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, toJSON: () => ({}) }) as DOMRect;
    Element.prototype.animate ??= (() => ({ cancel() {}, finish() {}, addEventListener() {} })) as unknown as Element['animate'];

    return () => {
        canvasProto.getContext = originalGetContext;
        Object.defineProperty(canvasProto, 'width', originalWidth);
        Object.defineProperty(canvasProto, 'height', originalHeight);
        Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
        Object.defineProperty(Element.prototype, 'clientHeight', originalClientHeight);
        Element.prototype.getBoundingClientRect = originalRect;
    };
}
