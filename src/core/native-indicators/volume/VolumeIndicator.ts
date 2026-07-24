import type { InputSchema, InputValue } from '../../model/inputs';
import type { VolumeLayerData } from '../../model/volume-layers';
import type { NativeIndicator, NativeIndicatorContext, NativeIndicatorDescriptor } from '../NativeIndicator';
import { registerNativeIndicator } from '../NativeIndicator';

const DEFAULT_UP = '#089981';
const DEFAULT_DOWN = '#F23645';
const DEFAULT_HEIGHT_PCT = 20;

function num(v: InputValue | undefined, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: InputValue | undefined, fallback: string): string {
    return typeof v === 'string' && v !== '' ? v : fallback;
}

/** Resolve the input record into the layer payload (clamped, fraction-normalized). */
export function volumeLayerData(inputs: Record<string, InputValue>): VolumeLayerData {
    return {
        upColor: str(inputs.upColor, DEFAULT_UP),
        downColor: str(inputs.downColor, DEFAULT_DOWN),
        heightFrac: Math.min(0.5, Math.max(0.05, num(inputs.heightPct, DEFAULT_HEIGHT_PCT) / 100)),
    };
}

/**
 * The built-in VOLUME indicator: per-bar volume columns anchored to the BOTTOM of the
 * price pane, colored by bar direction. The columns use their OWN scale (the tallest
 * visible bar spans `heightPct` of the pane) so volume units never touch the price
 * autoscale — which is why this is a bespoke renderer layer, not a model series. All
 * geometry lives in the renderer's volume layer (it reads the chart's bars each frame);
 * this instance only carries lifecycle + settings.
 */
class VolumeIndicator implements NativeIndicator {
    private ctx!: NativeIndicatorContext;
    private inputs: Record<string, InputValue> = {};

    start(ctx: NativeIndicatorContext, inputs: Record<string, InputValue>): void {
        this.ctx = ctx;
        this.inputs = inputs;
        ctx.emit({}); // mount the legend row (the layer draws outside the model)
        ctx.pushData(volumeLayerData(inputs));
    }

    /** The layer reads the live bar array directly — nothing to recompute here. */
    onBars(): void {}

    /** Visible-range normalization happens per frame in the layer. */
    onViewport(): void {}

    setInputs(inputs: Record<string, InputValue>): void {
        this.inputs = inputs;
        this.ctx.pushData(volumeLayerData(inputs));
    }

    /** Hiding is a renderer-layer flag (set via `setIndicatorVisible`); no resources to free. */
    suspend(): void {}

    resume(): void {
        this.ctx.pushData(volumeLayerData(this.inputs));
    }

    stop(): void {}
}

/** Descriptor for the built-in volume indicator. Bar volume needs no capability probe. */
export const volumeDescriptor: NativeIndicatorDescriptor = {
    type: 'volume',
    title: 'Volume',
    paneHint: 'price',
    overlay: true,
    inputsSchema: (): InputSchema[] => [
        { key: 'upColor', title: 'Up color', type: 'color', defval: DEFAULT_UP },
        { key: 'downColor', title: 'Down color', type: 'color', defval: DEFAULT_DOWN },
        { key: 'heightPct', title: 'Height %', type: 'int', defval: DEFAULT_HEIGHT_PCT, min: 5, max: 50, step: 1, tooltip: 'Pane height the tallest visible bar occupies' },
    ],
    defaultInputs: (): Record<string, InputValue> => ({ upColor: DEFAULT_UP, downColor: DEFAULT_DOWN, heightPct: DEFAULT_HEIGHT_PCT }),
    create: () => new VolumeIndicator(),
};

/** Register the built-in volume native indicator (idempotent). Called by the composition root. */
export function registerVolume(): void {
    registerNativeIndicator(volumeDescriptor);
}
