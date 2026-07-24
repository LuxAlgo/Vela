import type { InputSchema, InputValue } from '../../model/inputs';
import type { VpvrLayerData } from '../../model/volume-layers';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../NativeIndicator';
import { registerNativeIndicator } from '../NativeIndicator';

const DEFAULT_ROWS = 24;
const DEFAULT_WIDTH_PCT = 30;
const DEFAULT_UP = '#2962FF';
const DEFAULT_DOWN = '#F7525F';
const DEFAULT_VALUE_AREA_PCT = 70;

function num(v: InputValue | undefined, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: InputValue | undefined, fallback: string): string {
    return typeof v === 'string' && v !== '' ? v : fallback;
}

/** Resolve the input record into the layer payload (clamped, fraction-normalized). */
export function vpvrLayerData(inputs: Record<string, InputValue>): VpvrLayerData {
    return {
        rows: Math.round(Math.min(400, Math.max(2, num(inputs.rows, DEFAULT_ROWS)))),
        widthFrac: Math.min(0.9, Math.max(0.05, num(inputs.widthPct, DEFAULT_WIDTH_PCT) / 100)),
        upColor: str(inputs.upColor, DEFAULT_UP),
        downColor: str(inputs.downColor, DEFAULT_DOWN),
        showPoc: inputs.showPoc !== false,
        valueAreaFrac: Math.min(1, Math.max(0, num(inputs.valueAreaPct, DEFAULT_VALUE_AREA_PCT) / 100)),
    };
}

/**
 * The built-in VPVR (visible-range volume profile) indicator: horizontal volume-by-price
 * rows anchored to the RIGHT edge of the price pane, aggregating every visible bar. Row
 * y-positions are real prices (the shared price scale); row WIDTHS are screen fractions
 * (the profile's own horizontal scale) — so the profile never touches the price
 * autoscale, which is why it's a bespoke renderer layer rather than model series. The
 * layer re-buckets per frame from the chart's bars (memoized on the visible range), so
 * the profile tracks pan/zoom without any orchestrator round-trip; this instance only
 * carries lifecycle + settings.
 */
class VpvrIndicator implements NativeIndicator {
    private ctx!: NativeIndicatorContext;
    private inputs: Record<string, InputValue> = {};

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = inputs;
        ctx.emit({}); // mount the legend row (the layer draws outside the model)
        ctx.pushData(vpvrLayerData(inputs));
    }

    /** The layer reads the live bar array directly — nothing to recompute here. */
    onBars(): void {}

    /** The layer re-buckets from the visible range per frame — no poke needed. */
    onViewport(): void {}

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = inputs;
        this.ctx.pushData(vpvrLayerData(inputs));
    }

    /** Hiding is a renderer-layer flag (set via `setIndicatorVisible`); no resources to free. */
    suspend(): void {}

    resume(): void {
        this.ctx.pushData(vpvrLayerData(this.inputs));
    }

    stop(): void {}
}

/** Descriptor for the built-in VPVR indicator. Bar volume needs no capability probe. */
export const vpvrDescriptor: NativeIndicatorDescriptor = {
    type: 'vpvr',
    title: 'VPVR',
    paneHint: 'price',
    overlay: true,
    inputsSchema: (): InputSchema[] => [
        { key: 'rows', title: 'Rows', type: 'int', defval: DEFAULT_ROWS, min: 2, max: 400, step: 1 },
        { key: 'widthPct', title: 'Width %', type: 'int', defval: DEFAULT_WIDTH_PCT, min: 5, max: 90, step: 1, tooltip: 'Pane width the largest row occupies' },
        { key: 'upColor', title: 'Up color', type: 'color', defval: DEFAULT_UP },
        { key: 'downColor', title: 'Down color', type: 'color', defval: DEFAULT_DOWN },
        { key: 'showPoc', title: 'Point of control', type: 'bool', defval: true },
        { key: 'valueAreaPct', title: 'Value area %', type: 'int', defval: DEFAULT_VALUE_AREA_PCT, min: 0, max: 100, step: 1 },
    ],
    defaultInputs: (): Record<string, InputValue> => ({
        rows: DEFAULT_ROWS,
        widthPct: DEFAULT_WIDTH_PCT,
        upColor: DEFAULT_UP,
        downColor: DEFAULT_DOWN,
        showPoc: true,
        valueAreaPct: DEFAULT_VALUE_AREA_PCT,
    }),
    create: () => new VpvrIndicator(),
};

/** Register the built-in VPVR native indicator (idempotent). Called by the composition root. */
export function registerVpvr(): void {
    registerNativeIndicator(vpvrDescriptor);
}
